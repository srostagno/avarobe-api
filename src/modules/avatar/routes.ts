import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { PHOTO_CONSENT_NOTICE_VERSION, PHOTO_CONSENT_VERSION } from '../../constants/auth.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarBody, AvatarDocument, AvatarJob, ColorReadLog } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { InvalidImageError, normalizeBodyPhoto, normalizeSelfie } from '../../utils/images.js'
import { serializeAvatar } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations, remainingGenerations, reserveGenerations } from '../../utils/usage.js'
import { requestGeo, type Geo } from '../analytics/geo.js'
import { trackServerEvent } from '../analytics/service.js'
import { paletteAccess } from '../billing/entitlements.js'
import { deleteHairstyles } from '../hair/service.js'
import { deleteMakeupTryOns } from '../makeup/service.js'
import { BOARD_KINDS, COLOR_BOARDS, STYLE_BOARDS, boardKeys, unsetBoards } from '../report/boards.js'
import { ensureLockedPreview, startDrapePreview } from '../report/service.js'
import { orphanHairKeys } from './hair.js'
import { AVATAR_ADJUSTMENTS } from './prompts.js'
import { answeredBefore, colorsLocked, colorsReadStart, imageHash, loadColorsAccess, newReadId, readEntry, replacedKeys, withRead } from './reads.js'
import { avatarLimitBody, beforeAvatarJob, takeAvatarRender } from './render-quota.js'
import { newJob, requestColorsNotice, startAvatarJob, startColorsJob } from './service.js'

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

const choiceSchema = z.object({
  readId: z.string().min(1).max(64),
  keep: z.enum(['paid', 'new']),
})

const NO_CANDIDATE = { code: 'no_candidate', message: 'There is no new color read to choose.' }
const REPORT_LOCKED = { code: 'report_locked', message: 'Your color report stays on the colors it was written for.' }

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

// What a busy avatar is doing, for the 409 while it's at it.
function busyMessage(job: AvatarJob | null | undefined) {
  return job?.kind === 'colors' ? 'We are still reading your colors. One moment.' : 'Your avatar is still being created.'
}

// The day's avatar renders and reads (render-quota.ts for renders).
function limitReached(reply: FastifyReply) {
  return reply.code(429).send(avatarLimitBody())
}

const avatarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const found = await app.collections.avatars.findOne({ userId })
    const access = await paletteAccess(app, userId)
    // A preview from before the lock gets its locked copy here, once.
    const avatar = found && !access.fullPalette && !access.mirror ? await ensureLockedPreview(app, found) : found

    return {
      avatar: avatar ? await serializeAvatar(avatar, access) : null,
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

      // Agreed to by uploading after the notice beside the button (the
      // Halloween flow), or with the checkbox. In Illinois only the checkbox
      // counts, as for the colors below.
      const byNotice = fields.consentMethod === 'notice'

      if ((uploads.selfie || uploads.bodyPhoto) && byNotice && needsCheckboxConsent(requestGeo(request))) {
        return reply.code(409).send({ code: 'consent_checkbox', message: 'Please agree to how we use your photo first.' })
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

      const stamp = Date.now()
      const selfieKey = selfie ? `users/${userId.toString()}/selfie-${stamp}.jpg` : null
      const bodyPhotoKey = bodyPhoto ? `users/${userId.toString()}/body-${stamp}.jpg` : null

      const now = new Date()
      const avatarId = existing?._id ?? new ObjectId()
      const newPhotos = Boolean(selfie || bodyPhoto)
      // A new selfie no longer wipes the colors: they stay until a read of
      // it succeeds (a buyer's aren't read again at all: her colors, report,
      // drape test, preview and color boards stay as they are).
      const hasColors = Boolean(existing?.colorAnalysis)
      const locked = existing ? await colorsLocked(app, existing) : false
      const wipe = Boolean(selfieKey) && !hasColors
      // Colors read before reads kept their source came from the stored
      // selfie, which this one replaces: the source is written down now, so
      // the new photo is never taken for theirs (and read, not given back).
      const legacySource =
        selfieKey && existing?.colorAnalysis && !existing.colorsSource
          ? {
              readId: `before-${existing._id.toString()}`,
              at: existing.colorsAt ?? existing.updatedAt,
              selfieKey: existing.selfieKey,
              imageHash: await storage
                .read(existing.selfieKey)
                .then(imageHash)
                .catch(() => null),
              method: 'classic' as const,
              scores: null,
              lighting: null,
            }
          : null

      const render = await takeAvatarRender(app, reply, userId)

      if (!render.ok) {
        return render.sent
      }

      // The photos and the job's start: a failure here gives the render back.
      const previous = await beforeAvatarJob(app, userId, render.run, async () => {
        if (selfie && selfieKey) {
          await storage.put(selfieKey, selfie, 'image/jpeg')
        }

        if (bodyPhoto && bodyPhotoKey) {
          await storage.put(bodyPhotoKey, bodyPhoto, 'image/jpeg')
        }

        // What it replaces comes from the document as it was right before, so
        // a report image that finished rendering meanwhile goes too.
        return app.collections.avatars.findOneAndUpdate(
          { userId },
          {
            $set: {
              status: 'processing',
              error: null,
              failure: null,
              body: roundBody(parsedBody.data),
              job: newJob('create', render.run),
              updatedAt: now,
              readyAt: existing?.readyAt ?? null,
              avatarKey: existing?.avatarKey ?? null,
              styleProfile: null,
              ...(selfieKey
                ? wipe
                  ? {
                      selfieKey,
                      colorAnalysis: null,
                      colorsAt: null,
                      colorReport: null,
                      drape: null,
                      drapePreview: null,
                      reportBoards: null,
                      hairProfile: null,
                    }
                  : { selfieKey, hairProfile: null, ...(legacySource ? { colorsSource: legacySource } : {}) }
                : {}),
              ...(bodyPhotoKey ? { bodyPhotoKey } : {}),
              ...(newPhotos ? { consentVersion: byNotice ? PHOTO_CONSENT_NOTICE_VERSION : PHOTO_CONSENT_VERSION, consentAt: now } : {}),
            },
            // A new selfie without colors clears every board (above); the body,
            // or a selfie while there are colors, the style ones.
            ...(wipe ? {} : { $unset: unsetBoards(STYLE_BOARDS) }),
            $inc: { generations: 1 },
            $setOnInsert: { _id: avatarId, userId, createdAt: now },
          },
          { upsert: true, returnDocument: 'before' },
        )
      })

      // The free preview of a selfie with colors goes only once a read of the
      // new one succeeds (the job); a waiting candidate keeps its photo.
      const replaced = [
        selfieKey ? previous?.selfieKey : null,
        wipe ? previous?.drape?.key : null,
        wipe ? previous?.drapePreview?.key : null,
        wipe ? previous?.drapePreview?.lockedKey : null,
        bodyPhotoKey ? previous?.bodyPhotoKey : null,
        ...boardKeys(previous?.reportBoards, wipe ? BOARD_KINDS : STYLE_BOARDS),
      ].filter((key): key is string => Boolean(key) && key !== previous?.colorCandidate?.selfieKey)

      await Promise.all(replaced.map((key) => storage.remove(key).catch(() => undefined)))

      // Haircuts and makeup were read from, and drawn with, the old selfie.
      if (selfieKey) {
        await deleteHairstyles(app, userId)
        await deleteMakeupTryOns(app, userId)
      }

      startAvatarJob(app, avatarId, {
        kind: 'create',
        analyze: (Boolean(selfieKey) && !locked) || !hasColors,
        keepHair: !selfieKey,
      })
      void trackServerEvent(app, { name: 'avatar_started', userId, props: { kind: 'create' } })

      const avatar = await app.collections.avatars.findOne({ _id: avatarId })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null })
    },
  )

  // Colors first: a selfie (and consent) is enough to read their colors, in
  // seconds and before any measurements. Only before the avatar exists;
  // without a new selfie it reads the stored one again (the retry after a
  // failure). Doesn't spend a free avatar render: the avatar comes later
  // from the same selfie, through POST /. Someone with colors who sends no
  // photo, or the same one, gets them back as they are (`reused`); a new
  // photo is read while their colors stay (service.ts runColorsJob).
  app.post(
    '/colors',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const fields: Record<string, string> = {}
      let upload: Buffer | null = null

      try {
        for await (const part of request.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } })) {
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

      // Agreed to by uploading after the notice beside the button, or with
      // the checkbox. Where the law asks for a written release for anything
      // read from a face (Illinois), only the checkbox counts: the web shows
      // it when it gets this answer.
      const byNotice = fields.consentMethod === 'notice'

      if (upload && byNotice && needsCheckboxConsent(requestGeo(request))) {
        return reply.code(409).send({ code: 'consent_checkbox', message: 'Please agree to how we use your photo first.' })
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

      const hash = selfie ? imageHash(selfie) : null

      // The same photo again (or no photo) while they have colors: the
      // stored result, without reading it again (the same photo read twice
      // used to flip seasons, and a "read again" wiped a buyer's report).
      // Also a photo already answered: the one waiting for their choice, one
      // that confirmed their season, or one they kept their colors over.
      const answered = existing?.colorAnalysis ? (hash ? await answeredPhoto(existing, hash) : 'current') : null

      if (existing && answered) {
        await reuseColors(app, existing, hash, answered)
        return reply.code(202).send({ avatar: await serializeAvatar(existing, await paletteAccess(app, userId)), reused: true })
      }

      // A read is text, not one of the day's new pictures.
      if (!(await reserveGenerations(app, userId, 'avatar', 1, { image: false }))) {
        return limitReached(reply)
      }

      const now = new Date()
      const readId = newReadId()
      // A new selfie waits in the job until the read succeeds; their colors
      // and selfie stay as they are meanwhile. Named after its read too, so
      // two at once never share a file.
      const heldKey = selfie ? `users/${userId.toString()}/selfie-${Date.now()}-${readId.slice(-8)}.jpg` : null

      if (selfie && heldKey) {
        await storage.put(heldKey, selfie, 'image/jpeg')
      }

      const photoKey = heldKey ?? existing!.selfieKey
      const locked = existing ? await colorsLocked(app, existing) : false
      const read = { readId, photoKey }
      // Not over a read that started meanwhile (a double tap, the busy
      // card's own retry and a tap): userId is unique, so a document already
      // processing makes the upsert fail instead of taking its place.
      let avatar: AvatarDocument | null

      try {
        avatar = await app.collections.avatars.findOneAndUpdate(
          { userId, status: { $ne: 'processing' } },
          {
            $set: {
              ...colorsReadStart(now, { readId: read.readId, selfieKey: photoKey }),
              ...(heldKey ? { consentVersion: byNotice ? PHOTO_CONSENT_NOTICE_VERSION : PHOTO_CONSENT_VERSION, consentAt: now } : {}),
            },
            // Their first selfie: nothing to protect, it's theirs at once.
            $setOnInsert: {
              _id: new ObjectId(),
              userId,
              selfieKey: photoKey,
              avatarKey: null,
              body: null,
              colorAnalysis: null,
              readyAt: null,
              generations: 0,
              createdAt: now,
            },
          },
          { upsert: true, returnDocument: 'after' },
        )
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error
        }

        avatar = null
      }

      if (!avatar) {
        if (heldKey) {
          await storage.remove(heldKey).catch(() => undefined)
        }

        await releaseGenerations(app, userId, 'avatar', 1, { image: false })
        const busy = await app.collections.avatars.findOne({ userId }, { projection: { job: 1 } })

        return reply.code(409).send({ message: busyMessage(busy?.job) })
      }

      startColorsJob(app, avatar._id, read)
      // trigger 'auto': the web's busy card trying again by itself, not a tap.
      void trackServerEvent(app, {
        name: 'colors_started',
        userId,
        props: {
          retry: !heldKey,
          ...(fields.trigger === 'auto' ? { trigger: 'auto' } : {}),
          hasColors: Boolean(existing?.colorAnalysis),
          locked,
          newPhoto: Boolean(heldKey),
        },
      })

      return reply.code(202).send({ avatar: await serializeAvatar(avatar, await paletteAccess(app, userId)) })
    },
  )

  // "Tell me when my colors are ready", from an account (guests ask while
  // saving their email, POST /auth/claim): after a read the AI couldn't do,
  // it's read again later and they get a sign-in link to their colors.
  app.post(
    '/colors/notify',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      // A guest has no address yet: theirs comes with saving (claim).
      const user = await app.collections.users.findOne({ _id: userId }, { projection: { guest: 1 } })

      if (!user || user.guest || !(await requestColorsNotice(app, userId, 'account'))) {
        return reply.code(409).send({ code: 'not_waiting', message: 'There is no color read to retry.' })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      return { avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null }
    },
  )

  // The choice after a new photo read as another season (a buyer's clear
  // difference; in 'classic', anyone's): keep the colors they have (a
  // buyer's report stays), or switch to the new read. A buyer's report is
  // written again for it from /report/color (not counted against the day's
  // reports); the one she had is kept in previousColors for an undo by hand.
  // Until they choose, everything stays as it is. Someone whose report
  // couldn't be written again (a lapsed Pro, the Hair Advisor alone) keeps
  // theirs (409 report_locked).
  app.post(
    '/colors/choice',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(choiceSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const existing = await app.collections.avatars.findOne({ userId })

      if (existing?.status === 'processing') {
        return reply.code(409).send({ message: busyMessage(existing.job) })
      }

      const candidate = existing?.colorCandidate

      if (!existing || !candidate || candidate.readId !== parsed.data.readId) {
        return reply.code(404).send(NO_CANDIDATE)
      }

      const now = new Date()
      const paid = existing.colorAnalysis?.season ?? null
      const keepNew = parsed.data.keep === 'new'

      if (keepNew && !(await loadColorsAccess(app, existing)).switchable) {
        return reply.code(409).send(REPORT_LOCKED)
      }

      // Their selfie moves to the photo read only if it's still the one they
      // had then and no avatar was made from it: a newer selfie (Photos &
      // measurements) isn't swapped back for an older photo.
      const moveSelfie = !existing.avatarKey && (!candidate.baseSelfieKey || candidate.baseSelfieKey === existing.selfieKey)
      const entry = readEntry({
        id: newReadId(),
        at: now,
        selfieKey: candidate.selfieKey,
        imageHash: candidate.source.imageHash,
        method: candidate.source.method,
        outcome: keepNew ? 'switched' : 'kept_paid',
        season: candidate.analysis.season,
        undertone: candidate.analysis.undertone,
        contrast: candidate.analysis.contrast,
        scores: candidate.source.scores,
        lighting: candidate.source.lighting,
        shown: keepNew ? candidate.analysis.season : paid,
        ...(keepNew ? { from: paid } : {}),
      })
      // Switching: the new read (and its photo, as above); the report, drape
      // test, free preview and color boards were of the old one, and the
      // hair read of the old selfie. The style boards stay. What they had
      // is kept, report included, for an undo by hand.
      const set: Record<string, unknown> = keepNew
        ? {
            colorAnalysis: candidate.analysis,
            colorsAt: candidate.at,
            colorsSource: candidate.source,
            ...(moveSelfie ? { selfieKey: candidate.selfieKey, hairProfile: null } : {}),
            colorCandidate: null,
            colorReport: null,
            drape: null,
            drapePreview: null,
            ...(existing.colorAnalysis
              ? {
                  previousColors: {
                    at: now,
                    analysis: existing.colorAnalysis,
                    colorsAt: existing.colorsAt ?? null,
                    source: existing.colorsSource ?? null,
                    report: existing.colorReport ?? null,
                  },
                }
              : {}),
            colorReads: withRead(existing.colorReads, entry),
            updatedAt: now,
          }
        : { colorCandidate: null, colorReads: withRead(existing.colorReads, entry) }
      const saved = await app.collections.avatars.updateOne(
        { _id: existing._id, 'colorCandidate.readId': candidate.readId, ...(keepNew ? { status: { $ne: 'processing' } } : {}) },
        keepNew ? { $set: set, $unset: unsetBoards(COLOR_BOARDS) } : { $set: set },
      )

      if (saved.matchedCount === 0) {
        return reply.code(404).send(NO_CANDIDATE)
      }

      const after = { ...existing, ...set, reportBoards: keepNew ? null : existing.reportBoards } as AvatarDocument

      await Promise.all(replacedKeys(existing, after).map((key) => storage.remove(key).catch(() => undefined)))

      if (keepNew) {
        if (moveSelfie) {
          await deleteHairstyles(app, userId)
          await deleteMakeupTryOns(app, userId)
        }

        await startDrapePreview(app, existing._id).catch((error: unknown) => {
          request.log.error({ err: error }, 'Drape preview did not start')
        })
      }

      void trackServerEvent(app, {
        name: 'colors_choice',
        userId,
        props: {
          choice: parsed.data.keep,
          ...(paid ? { paid } : {}),
          candidate: candidate.analysis.season,
          ageHours: Math.round(((now.getTime() - candidate.at.getTime()) / 3_600_000) * 10) / 10,
        },
      })

      const avatar = await app.collections.avatars.findOne({ _id: existing._id })

      return { avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null }
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

      const render = await takeAvatarRender(app, reply, userId)

      if (!render.ok) {
        return render.sent
      }

      const previous = await beforeAvatarJob(app, userId, render.run, () =>
        app.collections.avatars.findOneAndUpdate(
          { _id: existing._id },
          {
            $set: {
              status: 'processing',
              error: null,
              failure: null,
              job: newJob('create', render.run),
              updatedAt: new Date(),
              ...(parsed.data.body ? { body: roundBody(parsed.data.body), styleProfile: null } : {}),
            },
            ...(parsed.data.body ? { $unset: unsetBoards(STYLE_BOARDS) } : {}),
            $inc: { generations: 1 },
          },
          { returnDocument: 'before' },
        ),
      )

      // New measurements retire the style boards along with the profile.
      const replaced = parsed.data.body ? boardKeys(previous?.reportBoards, STYLE_BOARDS) : []

      await Promise.all(replaced.map((key) => storage.remove(key).catch(() => undefined)))

      startAvatarJob(app, existing._id, { kind: 'create', analyze: !existing.colorAnalysis, keepHair: true })

      const avatar = await app.collections.avatars.findOne({ _id: existing._id })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null })
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

      const render = await takeAvatarRender(app, reply, userId)

      if (!render.ok) {
        return render.sent
      }

      await beforeAvatarJob(app, userId, render.run, () =>
        app.collections.avatars.updateOne(
          { _id: existing._id },
          {
            $set: { status: 'processing', error: null, job: newJob('refine', render.run), updatedAt: new Date() },
            $inc: { generations: 1 },
          },
        ),
      )

      startAvatarJob(app, existing._id, {
        kind: 'refine',
        adjustments: parsed.data.adjustments,
        notes: parsed.data.notes || null,
      })

      const avatar = await app.collections.avatars.findOne({ _id: existing._id })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null })
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

    return { avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null }
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

    return { avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null }
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
          existing.job?.selfieKey,
          existing.colorCandidate?.selfieKey,
          existing.drape?.key,
          existing.drapePreview?.key,
          existing.drapePreview?.lockedKey,
          ...boardKeys(existing.reportBoards),
          ...(existing.versions ?? []).flatMap((version) => [version.key, version.hair?.refKey]),
        ].filter((key): key is string => Boolean(key)),
      ),
    ]

    await app.collections.avatars.deleteOne({ _id: existing._id })
    await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
    // The haircuts and makeup on them were drawn from these photos.
    await deleteHairstyles(app, userId)
    await deleteMakeupTryOns(app, userId)

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

    return { avatar: avatar ? await serializeAvatar(avatar, await paletteAccess(app, userId)) : null }
  })
}

export default avatarRoutes

// Whether an upload (same bytes after normalizing) was answered by a read
// already (reads.ts answeredBefore). Before reads kept their source, colors
// always came from the stored selfie.
async function answeredPhoto(avatar: AvatarDocument, hash: string) {
  const stored = avatar.colorsSource
    ? null
    : await storage
        .read(avatar.selfieKey)
        .then(imageHash)
        .catch(() => null)

  return answeredBefore(avatar, hash, stored)
}

// The colors they have, given back for a photo already answered: a line in
// the history, no AI call, nothing else changes (a candidate keeps waiting).
async function reuseColors(app: FastifyInstance, avatar: AvatarDocument, hash: string | null, scope: 'current' | 'candidate' | 'history') {
  const analysis = avatar.colorAnalysis!
  const source = avatar.colorsSource
  const entry: ColorReadLog = readEntry({
    id: newReadId(),
    at: new Date(),
    selfieKey: source?.selfieKey ?? avatar.selfieKey,
    imageHash: hash ?? source?.imageHash ?? null,
    method: source?.method ?? 'classic',
    outcome: 'reused',
    season: analysis.season,
    undertone: analysis.undertone,
    contrast: analysis.contrast,
    scores: source?.scores ?? null,
    lighting: source?.lighting ?? null,
    shown: analysis.season,
    via: 'colors',
  })

  await app.collections.avatars.updateOne(
    { _id: avatar._id, status: { $ne: 'processing' } },
    { $set: { colorReads: withRead(avatar.colorReads, entry) } },
  )
  void trackServerEvent(app, { name: 'colors_reused', userId: avatar.userId, props: { scope } })
}

// Where a photo's consent has to be a written release (a checkbox), not the
// act of uploading after a notice: Illinois (BIPA). Unknown places get the
// notice, like everyone else.
export function needsCheckboxConsent(geo: Geo | null) {
  return geo?.country === 'US' && geo.region === 'IL'
}
