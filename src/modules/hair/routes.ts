import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { parseBody } from '../../utils/http.js'
import { InvalidImageError, normalizeOutfitPhoto } from '../../utils/images.js'
import { toObjectId } from '../../utils/object-id.js'
import { serializeAvatar } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations, remainingGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { currentHair } from '../avatar/hair.js'
import { startAvatarJob } from '../avatar/service.js'
import {
  PaywallError,
  paletteAccess,
  refundCredits,
  requirePro,
  sendPaywall,
  spendCredits,
  useAvatarRun,
} from '../billing/entitlements.js'
import {
  NotAHaircutError,
  hairstyleKeys,
  planHairRequest,
  serializeHairStudio,
  serializeHairstyle,
  startHairProfile,
  startHairstyleRender,
  startRecommendedHairstyle,
} from './service.js'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

const recommendedSchema = z.object({ recommendationId: z.string().regex(/^r\d{1,2}$/) })
const requestFieldsSchema = z.object({ description: z.string().trim().max(200).optional() })

function hairLimitReached(reply: FastifyReply) {
  return reply.code(429).send({
    message: `You can try ${env.DAILY_HAIR_LIMIT} hairstyles a day. Come back tomorrow.`,
  })
}

// The Hair studio: a read of their face shape and hair with the cuts that
// suit them (free, with the ideal cut shown on them), every recommended cut
// on them (Style Advisor or Pro), any haircut they describe or bring in a
// photo (Pro, one credit), and putting a haircut on their avatar.
const hairRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId })

    return {
      ...(await serializeHairStudio(app, avatar, userId)),
      remaining: await remainingGenerations(app, userId, 'hair'),
    }
  })

  // Reads the selfie (or reads it again). The ideal cut starts rendering as
  // soon as the read is ready.
  app.post('/profile', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.avatarKey || avatar.status === 'failed') {
      return reply.code(409).send({ message: 'Create your avatar first.' })
    }

    if (avatar.hairProfile?.status === 'processing') {
      return reply.code(409).send({ message: 'We’re already reading your hair.' })
    }

    if (!(await reserveGenerations(app, userId, 'hair', 1))) {
      return hairLimitReached(reply)
    }

    const now = new Date()

    await app.collections.avatars.updateOne(
      { _id: avatar._id },
      { $set: { hairProfile: { status: 'processing', data: null, error: null, startedAt: now, updatedAt: now } } },
    )
    startHairProfile(app, avatar._id, now)
    void trackServerEvent(app, { name: 'hair_profile_started', userId })

    const updated = await app.collections.avatars.findOne({ _id: avatar._id })

    return reply.code(202).send({ ...(await serializeHairStudio(app, updated, userId)) })
  })

  // One of their recommended cuts, on them.
  app.post('/styles', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(recommendedSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const avatar = await app.collections.avatars.findOne({ userId })
    const recommendation = avatar?.hairProfile?.data?.recommendations.find(
      (item) => item.id === parsed.data.recommendationId,
    )

    if (!avatar?.avatarKey || !recommendation) {
      return reply.code(404).send({ message: 'Read your hair first to get your recommended cuts.' })
    }

    if (!(await reserveGenerations(app, userId, 'hair', 1))) {
      return hairLimitReached(reply)
    }

    try {
      const { hairstyle, started } = await startRecommendedHairstyle(app, avatar, recommendation)

      if (!started) {
        await releaseGenerations(app, userId, 'hair', 1)
      }

      return reply.code(started ? 202 : 200).send({
        hairstyle: await serializeHairstyle(hairstyle, currentHair(avatar)?.hairstyleId ?? null),
      })
    } catch (error) {
      await releaseGenerations(app, userId, 'hair', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }
  })

  // A haircut they describe, or bring in a photo (only its hair is used):
  // a Pro try-on that spends a credit, given back if it fails.
  app.post('/styles/custom', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const fields: Record<string, string> = {}
    let upload: Buffer | null = null

    try {
      for await (const part of request.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } })) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer()

          if (part.fieldname === 'photo') {
            upload = buffer
          }
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value
        }
      }
    } catch (error) {
      request.log.warn({ err: error }, 'Hairstyle upload rejected')
      return reply.code(413).send({ message: 'The photo must be an image under 12 MB.' })
    }

    const parsed = parseBody(requestFieldsSchema, fields)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const description = parsed.data.description || null

    if (!description && !upload) {
      return reply.code(400).send({ message: 'Describe the haircut, or add a photo of it.' })
    }

    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.avatarKey || avatar.status === 'failed') {
      return reply.code(409).send({ message: 'Create your avatar first.' })
    }

    let photo: Buffer | null = null

    try {
      photo = upload ? await normalizeOutfitPhoto(upload) : null
    } catch (error) {
      return reply.code(400).send({ message: error instanceof InvalidImageError ? error.message : 'That photo could not be read.' })
    }

    if (!(await reserveGenerations(app, userId, 'hair', 1))) {
      return hairLimitReached(reply)
    }

    let creditSpent: boolean

    try {
      await requirePro(app, userId, 'Trying any hairstyle')
      creditSpent = await spendCredits(app, userId, 1)
    } catch (error) {
      await releaseGenerations(app, userId, 'hair', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }

    const refund = async () => {
      await releaseGenerations(app, userId, 'hair', 1)
      await refundCredits(app, userId, creditSpent ? 1 : 0)
    }
    let plan: Awaited<ReturnType<typeof planHairRequest>>

    try {
      plan = await planHairRequest({ avatar, description, photo })
    } catch (error) {
      await refund()

      if (error instanceof NotAHaircutError) {
        return reply.code(422).send({
          message: photo
            ? 'We couldn’t find a haircut in that photo. Try one where the hair is clearly visible.'
            : 'That doesn’t sound like a haircut. Try something like “chin-length bob with curtain bangs”.',
        })
      }

      request.log.error({ err: error }, 'Hair request failed')
      return reply.code(502).send({ message: 'Our stylist couldn’t read that request. Try again.' })
    }

    const id = new ObjectId()
    const referenceKey = photo ? `users/${userId.toString()}/hairstyle-${id.toString()}-reference.jpg` : null

    if (photo && referenceKey) {
      await storage.put(referenceKey, photo, 'image/jpeg')
    }

    const now = new Date()
    const hairstyle = {
      _id: id,
      userId,
      avatarId: avatar._id,
      source: photo ? ('photo' as const) : ('described' as const),
      recommendationId: null,
      name: plan.name,
      why: null,
      stylistBrief: plan.stylistBrief,
      fit: plan.fit,
      render: plan.render,
      request: description,
      referenceKey,
      status: 'processing' as const,
      error: null,
      imageKey: null,
      previewKey: null,
      creditSpent,
      freeRun: false,
      createdAt: now,
      updatedAt: now,
      readyAt: null,
    }

    await app.collections.hairstyles.insertOne(hairstyle)
    startHairstyleRender(app, id)

    return reply.code(202).send({ hairstyle: await serializeHairstyle(hairstyle, currentHair(avatar)?.hairstyleId ?? null) })
  })

  // Puts a haircut on the avatar: a new version, so looks follow it and the
  // old hair is one tap away. Counts as an avatar change.
  app.post('/styles/:id/apply', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const hairstyleId = toObjectId((request.params as { id?: string }).id)
    const [hairstyle, avatar] = await Promise.all([
      hairstyleId ? app.collections.hairstyles.findOne({ _id: hairstyleId, userId }) : null,
      app.collections.avatars.findOne({ userId }),
    ])

    if (!hairstyle || hairstyle.status !== 'ready') {
      return reply.code(404).send({ message: 'This haircut isn’t ready yet.' })
    }

    if (!avatar?.avatarKey) {
      return reply.code(409).send({ message: 'Create your avatar first.' })
    }

    if (avatar.status === 'processing') {
      return reply.code(409).send({ message: 'Your avatar is still being updated.' })
    }

    if (currentHair(avatar)?.hairstyleId === hairstyle._id.toString()) {
      return { avatar: await serializeAvatar(avatar, await paletteAccess(app, userId)) }
    }

    if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
      return reply.code(429).send({
        message: `You can create or adjust your avatar ${env.DAILY_AVATAR_LIMIT} times a day. Try again tomorrow.`,
      })
    }

    try {
      await useAvatarRun(app, userId)
    } catch (error) {
      await releaseGenerations(app, userId, 'avatar', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, new PaywallError('needs_pro', 'Putting more haircuts on your avatar comes with Avarobe Pro.'))
      }

      throw error
    }

    const now = new Date()

    await app.collections.avatars.updateOne(
      { _id: avatar._id },
      {
        $set: {
          status: 'processing',
          error: null,
          job: { kind: 'hair', startedAt: now, previewKey: null, previewCount: 0, hairstyleId: hairstyle._id.toString() },
          updatedAt: now,
        },
        $inc: { generations: 1 },
      },
    )
    startAvatarJob(app, avatar._id, { kind: 'hair', hairstyleId: hairstyle._id.toString() })
    void trackServerEvent(app, { name: 'avatar_started', userId, props: { kind: 'hair' } })

    const updated = await app.collections.avatars.findOne({ _id: avatar._id })

    return reply.code(202).send({
      avatar: updated ? await serializeAvatar(updated, await paletteAccess(app, userId)) : null,
    })
  })

  // Back to their own hair: the newest version without a studio haircut.
  app.post('/natural', async (request, reply) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.avatarKey) {
      return reply.code(404).send({ message: 'Create your avatar first.' })
    }

    if (avatar.status === 'processing') {
      return reply.code(409).send({ message: 'Your avatar is still being updated.' })
    }

    const natural = avatar.versions?.find((version) => !version.hair)

    if (!natural) {
      return reply.code(409).send({
        message: 'None of your avatar versions has your own hair anymore. Update your avatar from your selfie to get it back.',
      })
    }

    const updated = await app.collections.avatars.findOneAndUpdate(
      { _id: avatar._id },
      { $set: { avatarKey: natural.key, error: null, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    return { avatar: updated ? await serializeAvatar(updated, await paletteAccess(app, userId)) : null }
  })

  app.delete('/styles/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const hairstyleId = toObjectId((request.params as { id?: string }).id)
    const hairstyle = hairstyleId ? await app.collections.hairstyles.findOne({ _id: hairstyleId, userId }) : null

    if (!hairstyle) {
      return reply.code(404).send({ message: 'Haircut not found.' })
    }

    if (hairstyle.status === 'processing') {
      return reply.code(409).send({ message: 'Wait until this haircut is ready.' })
    }

    // The avatar keeps its own copy of a haircut it wears.
    await app.collections.hairstyles.deleteOne({ _id: hairstyle._id })
    await Promise.all(hairstyleKeys(hairstyle).map((key) => storage.remove(key).catch(() => undefined)))

    return { ok: true }
  })
}

export default hairRoutes
