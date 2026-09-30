import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { PHOTO_CONSENT_VERSION } from '../../constants/auth.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarBody, AvatarJob } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { InvalidImageError, normalizeBodyPhoto, normalizeSelfie } from '../../utils/images.js'
import { serializeAvatar } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations, remainingGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { PaywallError, hasColorReport, sendPaywall, useAvatarRun } from '../billing/entitlements.js'
import { deleteHairstyles } from '../hair/service.js'
import { BOARD_KINDS, STYLE_BOARDS, boardKeys, unsetBoards } from '../report/boards.js'
import { orphanHairKeys } from './hair.js'
import { AVATAR_ADJUSTMENTS } from './prompts.js'
import { startAvatarJob, startColorsJob } from './service.js'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

const bodySchema = z.object({
  heightCm: z.coerce.number().min(120).max(230),
  weightKg: z.coerce.number().min(30).max(250),
  build: z.enum(['slim', 'athletic', 'average', 'broad', 'curvy', 'plus']),
  presentation: z.enum(['menswear', 'womenswear', 'unisex']),
})

const regenerateSchema = z.object({
  body: bodySchema.optional(),
})

const adjustmentKeys = Object.keys(AVATAR_ADJUSTMENTS) as [
  keyof typeof AVATAR_ADJUSTMENTS,
  ...(keyof typeof AVATAR_ADJUSTMENTS)[],
]

const refineSchema = z
  .object({
    adjustments: z.array(z.enum(adjustmentKeys)).max(adjustmentKeys.length).default([]),
    notes: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.adjustments.length > 0 || Boolean(value.notes), {
    message: 'Pick at least one change or describe what to fix.',
  })

function roundBody(body: AvatarBody): AvatarBody {
  return {
    ...body,
    heightCm: Math.round(body.heightCm),
    weightKg: Math.round(body.weightKg),
  }
}

function newJob(kind: AvatarJob['kind']): AvatarJob {
  return { kind, startedAt: new Date(), previewKey: null, previewCount: 0 }
}

// What a busy avatar is doing, for the 409 while it's at it.
function busyMessage(job: AvatarJob | null | undefined) {
  return job?.kind === 'colors' ? 'We are still reading your colors. One moment.' : 'Your avatar is still being created.'
}

function limitReached(reply: FastifyReply) {
  return reply.code(429).send({
    message: `You can create or adjust your avatar ${env.DAILY_AVATAR_LIMIT} times a day. Try again tomorrow.`,
  })
}

const avatarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId })

    return {
      avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null,
      remaining: await remainingGenerations(app, userId, 'avatar'),
    }
  })

  // Multipart: body fields plus a `selfie` (required the first time) and an
  // optional `bodyPhoto`. New photos need `consent=true`.
  app.post(
    '/',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const fields: Record<string, string> = {}
      const uploads: Partial<Record<'selfie' | 'bodyPhoto', Buffer>> = {}

      try {
        for await (const part of request.parts({
          limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 12 },
        })) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer()

            if (part.fieldname === 'selfie' || part.fieldname === 'bodyPhoto') {
              uploads[part.fieldname] = buffer
            }
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Avatar upload rejected')
        return reply.code(413).send({ message: 'Each photo must be an image under 12 MB.' })
      }

      const existing = await app.collections.avatars.findOne({ userId })

      if (existing?.status === 'processing') {
        return reply.code(409).send({ message: busyMessage(existing.job) })
      }

      if (!uploads.selfie && !existing?.selfieKey) {
        return reply.code(400).send({ message: 'Add a selfie to continue.' })
      }

      if ((uploads.selfie || uploads.bodyPhoto) && fields.consent !== 'true') {
        return reply.code(400).send({ message: 'Please agree to how we use your photos first.' })
      }

      const parsedBody = parseBody(bodySchema, fields)

      if (!parsedBody.ok) {
        return reply.code(400).send({ message: parsedBody.message })
      }

      let selfie: Buffer | null = null
      let bodyPhoto: Buffer | null = null

      try {
        selfie = uploads.selfie ? await normalizeSelfie(uploads.selfie) : null
        bodyPhoto = uploads.bodyPhoto ? await normalizeBodyPhoto(uploads.bodyPhoto) : null
      } catch (error) {
        if (error instanceof InvalidImageError) {
          return reply.code(400).send({ message: error.message })
        }

        throw error
      }

      if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
        return limitReached(reply)
      }

      try {
        await useAvatarRun(app, userId)
      } catch (error) {
        await releaseGenerations(app, userId, 'avatar', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const stamp = Date.now()
      const selfieKey = selfie ? `users/${userId.toString()}/selfie-${stamp}.jpg` : null
      const bodyPhotoKey = bodyPhoto ? `users/${userId.toString()}/body-${stamp}.jpg` : null

      if (selfie && selfieKey) {
        await storage.put(selfieKey, selfie, 'image/jpeg')
      }

      if (bodyPhoto && bodyPhotoKey) {
        await storage.put(bodyPhotoKey, bodyPhoto, 'image/jpeg')
      }

      const now = new Date()
      const avatarId = existing?._id ?? new ObjectId()
      const newPhotos = Boolean(selfie || bodyPhoto)

      // What it replaces comes from the document as it was right before, so
      // a report image that finished rendering meanwhile goes too.
      const previous = await app.collections.avatars.findOneAndUpdate(
        { userId },
        {
          $set: {
            status: 'processing',
            error: null,
            body: roundBody(parsedBody.data),
            job: newJob('create'),
            updatedAt: now,
            readyAt: existing?.readyAt ?? null,
            avatarKey: existing?.avatarKey ?? null,
            styleProfile: null,
            ...(selfieKey
              ? {
                  selfieKey,
                  colorAnalysis: null,
                  colorReport: null,
                  drape: null,
                  drapePreview: null,
                  reportBoards: null,
                  hairProfile: null,
                }
              : {}),
            ...(bodyPhotoKey ? { bodyPhotoKey } : {}),
            ...(newPhotos ? { consentVersion: PHOTO_CONSENT_VERSION, consentAt: now } : {}),
          },
          // A new selfie clears every board (above); the body, the style ones.
          ...(selfieKey ? {} : { $unset: unsetBoards(STYLE_BOARDS) }),
          $inc: { generations: 1 },
          $setOnInsert: { _id: avatarId, userId, createdAt: now },
        },
        { upsert: true, returnDocument: 'before' },
      )

      const replaced = [
        selfieKey ? previous?.selfieKey : null,
        selfieKey ? previous?.drape?.key : null,
        selfieKey ? previous?.drapePreview?.key : null,
        bodyPhotoKey ? previous?.bodyPhotoKey : null,
        ...boardKeys(previous?.reportBoards, selfieKey ? BOARD_KINDS : STYLE_BOARDS),
      ].filter((key): key is string => Boolean(key))

      await Promise.all(replaced.map((key) => storage.remove(key).catch(() => undefined)))

      // Haircuts were read from, and drawn with, the old selfie.
      if (selfieKey) {
        await deleteHairstyles(app, userId)
      }

      startAvatarJob(app, avatarId, {
        kind: 'create',
        analyze: Boolean(selfieKey) || !existing?.colorAnalysis,
        keepHair: !selfieKey,
      })
      void trackServerEvent(app, { name: 'avatar_started', userId, props: { kind: 'create' } })

      const avatar = await app.collections.avatars.findOne({ _id: avatarId })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null })
    },
  )

  // Colors first: a selfie (and consent) is enough to read their colors, in
  // seconds and before any measurements. Only before the avatar exists;
  // without a new selfie it reads the stored one again (the retry after a
  // failure). Doesn't spend a free avatar render: the avatar comes later
  // from the same selfie, through POST /.
  app.post(
    '/colors',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const fields: Record<string, string> = {}
      let upload: Buffer | null = null

      try {
        for await (const part of request.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } })) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer()

            if (part.fieldname === 'selfie') {
              upload = buffer
            }
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Selfie upload rejected')
        return reply.code(413).send({ message: 'The photo must be an image under 12 MB.' })
      }

      const existing = await app.collections.avatars.findOne({ userId })

      if (existing?.status === 'processing') {
        return reply.code(409).send({ message: busyMessage(existing.job) })
      }

      if (existing?.avatarKey) {
        return reply.code(409).send({ message: 'You already have your avatar. Change your selfie from Photos & measurements.' })
      }

      if (!upload && !existing?.selfieKey) {
        return reply.code(400).send({ message: 'Add a selfie to continue.' })
      }

      if (upload && fields.consent !== 'true') {
        return reply.code(400).send({ message: 'Please agree to how we use your photo first.' })
      }

      let selfie: Buffer | null = null

      try {
        selfie = upload ? await normalizeSelfie(upload) : null
      } catch (error) {
        if (error instanceof InvalidImageError) {
          return reply.code(400).send({ message: error.message })
        }

        throw error
      }

      if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
        return limitReached(reply)
      }

      const now = new Date()
      const selfieKey = selfie ? `users/${userId.toString()}/selfie-${Date.now()}.jpg` : null

      if (selfie && selfieKey) {
        await storage.put(selfieKey, selfie, 'image/jpeg')
      }

      const previous = await app.collections.avatars.findOneAndUpdate(
        { userId },
        {
          $set: {
            status: 'processing',
            error: null,
            job: newJob('colors'),
            updatedAt: now,
            colorAnalysis: null,
            colorReport: null,
            drape: null,
            drapePreview: null,
            reportBoards: null,
            hairProfile: null,
            ...(selfieKey ? { selfieKey, consentVersion: PHOTO_CONSENT_VERSION, consentAt: now } : {}),
          },
          $setOnInsert: {
            _id: new ObjectId(),
            userId,
            avatarKey: null,
            body: null,
            readyAt: null,
            generations: 0,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: 'before' },
      )

      // Everything read from, or drawn with, the selfie it replaces.
      const replaced = [
        selfieKey ? previous?.selfieKey : null,
        previous?.drape?.key,
        previous?.drapePreview?.key,
        ...boardKeys(previous?.reportBoards, BOARD_KINDS),
      ].filter((key): key is string => Boolean(key))

      await Promise.all(replaced.map((key) => storage.remove(key).catch(() => undefined)))

      if (selfieKey && previous) {
        await deleteHairstyles(app, userId)
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar) {
        return reply.code(500).send({ message: 'Could not start. Please try again.' })
      }

      startColorsJob(app, avatar._id)
      void trackServerEvent(app, { name: 'colors_started', userId, props: { retry: !selfieKey } })

      return reply.code(202).send({ avatar: await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) })
    },
  )

  // Re-renders from the stored photos, optionally with new measurements.
  // Also the retry path after a failure.
  app.post(
    '/regenerate',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(regenerateSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const existing = await app.collections.avatars.findOne({ userId })

      if (!existing) {
        return reply.code(404).send({ message: 'Create your avatar first.' })
      }

      if (existing.status === 'processing') {
        return reply.code(409).send({ message: busyMessage(existing.job) })
      }

      // Someone with only their colors has no measurements to render from.
      if (!existing.body && !parsed.data.body) {
        return reply.code(409).send({ message: 'Add your measurements to create your avatar.' })
      }

      if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
        return limitReached(reply)
      }

      try {
        await useAvatarRun(app, userId)
      } catch (error) {
        await releaseGenerations(app, userId, 'avatar', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const previous = await app.collections.avatars.findOneAndUpdate(
        { _id: existing._id },
        {
          $set: {
            status: 'processing',
            error: null,
            job: newJob('create'),
            updatedAt: new Date(),
            ...(parsed.data.body ? { body: roundBody(parsed.data.body), styleProfile: null } : {}),
          },
          ...(parsed.data.body ? { $unset: unsetBoards(STYLE_BOARDS) } : {}),
          $inc: { generations: 1 },
        },
        { returnDocument: 'before' },
      )

      // New measurements retire the style boards along with the profile.
      const replaced = parsed.data.body ? boardKeys(previous?.reportBoards, STYLE_BOARDS) : []

      await Promise.all(replaced.map((key) => storage.remove(key).catch(() => undefined)))

      startAvatarJob(app, existing._id, { kind: 'create', analyze: !existing.colorAnalysis, keepHair: true })

      const avatar = await app.collections.avatars.findOne({ _id: existing._id })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null })
    },
  )

  // Edits the current avatar with targeted fixes (e.g. "head smaller") so
  // what already looks right stays; earlier versions can be restored.
  app.post(
    '/refine',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(refineSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const existing = await app.collections.avatars.findOne({ userId })

      if (!existing?.avatarKey) {
        return reply.code(404).send({ message: 'Create your avatar first.' })
      }

      if (existing.status === 'processing') {
        return reply.code(409).send({ message: 'Your avatar is still being created.' })
      }

      if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
        return limitReached(reply)
      }

      try {
        await useAvatarRun(app, userId)
      } catch (error) {
        await releaseGenerations(app, userId, 'avatar', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      await app.collections.avatars.updateOne(
        { _id: existing._id },
        {
          $set: { status: 'processing', error: null, job: newJob('refine'), updatedAt: new Date() },
          $inc: { generations: 1 },
        },
      )

      startAvatarJob(app, existing._id, {
        kind: 'refine',
        adjustments: parsed.data.adjustments,
        notes: parsed.data.notes || null,
      })

      const avatar = await app.collections.avatars.findOne({ _id: existing._id })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null })
    },
  )

  app.post('/versions/:id/select', async (request, reply) => {
    const userId = requireUserId(request)
    const versionId = (request.params as { id?: string }).id
    const existing = await app.collections.avatars.findOne({ userId })
    const version = existing?.versions?.find((item) => item.id === versionId)

    if (!existing || !version) {
      return reply.code(404).send({ message: 'Version not found.' })
    }

    if (existing.status === 'processing') {
      return reply.code(409).send({ message: 'Your avatar is still being created.' })
    }

    const avatar = await app.collections.avatars.findOneAndUpdate(
      { _id: existing._id },
      { $set: { avatarKey: version.key, error: null, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    return { avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null }
  })

  // Deletes one version. Deleting the one in use switches to the newest
  // remaining version; the last version can't go (delete the avatar instead).
  app.delete('/versions/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const versionId = (request.params as { id?: string }).id
    const existing = await app.collections.avatars.findOne({ userId })
    const versions = existing?.versions ?? []
    const version = versions.find((item) => item.id === versionId)

    if (!existing || !version) {
      return reply.code(404).send({ message: 'Version not found.' })
    }

    if (existing.status === 'processing') {
      return reply.code(409).send({ message: 'Wait until your avatar is ready.' })
    }

    const remaining = versions.filter((item) => item.id !== version.id)

    if (remaining.length === 0) {
      return reply.code(409).send({
        message: 'This is your only avatar version. Delete the whole avatar to start over.',
      })
    }

    const avatarKey = existing.avatarKey === version.key ? remaining[0]?.key ?? null : existing.avatarKey
    const avatar = await app.collections.avatars.findOneAndUpdate(
      { _id: existing._id },
      { $set: { versions: remaining, avatarKey, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    await Promise.all(
      [version.key, ...orphanHairKeys([version], remaining)].map((key) => storage.remove(key).catch(() => undefined)),
    )

    return { avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null }
  })

  // Deletes the avatar, every version and the photos behind it. Looks keep
  // their images; styling new ones needs a new avatar.
  app.delete('/', async (request, reply) => {
    const userId = requireUserId(request)
    const existing = await app.collections.avatars.findOne({ userId })

    if (!existing) {
      return reply.code(404).send({ message: 'There is no avatar to delete.' })
    }

    if (existing.status === 'processing') {
      return reply.code(409).send({ message: 'Wait until your avatar is ready.' })
    }

    const keys = [
      ...new Set(
        [
          existing.selfieKey,
          existing.bodyPhotoKey,
          existing.avatarKey,
          existing.job?.previewKey,
          existing.drape?.key,
          existing.drapePreview?.key,
          ...boardKeys(existing.reportBoards),
          ...(existing.versions ?? []).flatMap((version) => [version.key, version.hair?.refKey]),
        ].filter((key): key is string => Boolean(key)),
      ),
    ]

    await app.collections.avatars.deleteOne({ _id: existing._id })
    await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
    // The haircuts on them were drawn from these photos.
    await deleteHairstyles(app, userId)

    return { ok: true }
  })

  app.delete('/body-photo', async (request, reply) => {
    const userId = requireUserId(request)
    const existing = await app.collections.avatars.findOne({ userId })

    if (!existing?.bodyPhotoKey) {
      return reply.code(404).send({ message: 'There is no full-body photo to remove.' })
    }

    await storage.remove(existing.bodyPhotoKey).catch(() => undefined)

    const avatar = await app.collections.avatars.findOneAndUpdate(
      { _id: existing._id },
      { $set: { bodyPhotoKey: null, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    return { avatar: avatar ? await serializeAvatar(avatar, { fullPalette: await hasColorReport(app, userId) }) : null }
  })
}

export default avatarRoutes
