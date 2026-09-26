import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { PHOTO_CONSENT_VERSION } from '../../constants/auth.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarBody } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { InvalidImageError, normalizeSelfie } from '../../utils/images.js'
import { serializeAvatar } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import { remainingGenerations, reserveGenerations } from '../../utils/usage.js'
import { startAvatarJob } from './service.js'

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

function roundBody(body: AvatarBody): AvatarBody {
  return {
    ...body,
    heightCm: Math.round(body.heightCm),
    weightKg: Math.round(body.weightKg),
  }
}

const avatarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId })

    return {
      avatar: avatar ? await serializeAvatar(avatar) : null,
      remaining: await remainingGenerations(app, userId, 'avatar'),
    }
  })

  // Multipart: a `selfie` file plus body fields and `consent=true`.
  app.post(
    '/',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const fields: Record<string, string> = {}
      let selfieUpload: Buffer | null = null

      try {
        for await (const part of request.parts({
          limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 12 },
        })) {
          if (part.type === 'file') {
            if (part.fieldname !== 'selfie') {
              await part.toBuffer()
              continue
            }

            selfieUpload = await part.toBuffer()
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Selfie upload rejected')
        return reply
          .code(413)
          .send({ message: 'The photo must be an image under 12 MB.' })
      }

      if (fields.consent !== 'true') {
        return reply
          .code(400)
          .send({ message: 'Please agree to how we use your photo first.' })
      }

      if (!selfieUpload) {
        return reply.code(400).send({ message: 'Add a selfie to continue.' })
      }

      const parsedBody = parseBody(bodySchema, fields)

      if (!parsedBody.ok) {
        return reply.code(400).send({ message: parsedBody.message })
      }

      const existing = await app.collections.avatars.findOne({ userId })

      if (existing?.status === 'processing') {
        return reply
          .code(409)
          .send({ message: 'Your avatar is still being created.' })
      }

      let selfie: Buffer

      try {
        selfie = await normalizeSelfie(selfieUpload)
      } catch (error) {
        if (error instanceof InvalidImageError) {
          return reply.code(400).send({ message: error.message })
        }

        throw error
      }

      if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
        return reply.code(429).send({
          message: `You can create up to ${env.DAILY_AVATAR_LIMIT} avatars a day. Try again tomorrow.`,
        })
      }

      const selfieKey = `users/${userId.toString()}/selfie-${Date.now()}.jpg`
      await storage.put(selfieKey, selfie, 'image/jpeg')

      const now = new Date()
      const body = roundBody(parsedBody.data)
      const avatarId = existing?._id ?? new ObjectId()

      await app.collections.avatars.updateOne(
        { userId },
        {
          $set: {
            status: 'processing',
            error: null,
            selfieKey,
            avatarKey: existing?.avatarKey ?? null,
            body,
            colorAnalysis: null,
            consentVersion: PHOTO_CONSENT_VERSION,
            consentAt: now,
            updatedAt: now,
            readyAt: null,
          },
          $inc: { generations: 1 },
          $setOnInsert: { _id: avatarId, userId, createdAt: now },
        },
        { upsert: true },
      )

      if (existing?.selfieKey) {
        await storage.remove(existing.selfieKey).catch(() => undefined)
      }

      startAvatarJob(app, avatarId, { render: true, analyze: true })

      const avatar = await app.collections.avatars.findOne({ _id: avatarId })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar) : null })
    },
  )

  // Re-renders the avatar from the stored selfie, optionally with new body
  // measurements. Also the retry path after a failure.
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
        return reply
          .code(409)
          .send({ message: 'Your avatar is still being created.' })
      }

      if (!(await reserveGenerations(app, userId, 'avatar', 1))) {
        return reply.code(429).send({
          message: `You can create up to ${env.DAILY_AVATAR_LIMIT} avatars a day. Try again tomorrow.`,
        })
      }

      const now = new Date()

      await app.collections.avatars.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'processing',
            error: null,
            updatedAt: now,
            ...(parsed.data.body ? { body: roundBody(parsed.data.body) } : {}),
          },
          $inc: { generations: 1 },
        },
      )

      startAvatarJob(app, existing._id, {
        render: true,
        analyze: existing.colorAnalysis === null,
      })

      const avatar = await app.collections.avatars.findOne({ _id: existing._id })

      return reply.code(202).send({ avatar: avatar ? await serializeAvatar(avatar) : null })
    },
  )
}

export default avatarRoutes
