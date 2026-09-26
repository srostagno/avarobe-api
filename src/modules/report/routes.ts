import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import {
  PaywallError,
  hasColorAccess,
  hasKit,
  requireColorAccess,
  requireKit,
  sendPaywall,
} from '../billing/entitlements.js'
import { generateColorReport, generateStyleProfile, startDrapeTest } from './service.js'

const refreshSchema = z.object({ refresh: z.boolean().default(false) })

async function serializeReport(avatar: AvatarDocument | null) {
  return {
    color: avatar?.colorReport?.data ?? null,
    drape: avatar?.drape
      ? {
          status: avatar.drape.status,
          url: await signedUrlOrNull(avatar.drape.key),
          wear: avatar.drape.wear,
          avoid: avatar.drape.avoid,
        }
      : null,
    style: avatar?.styleProfile?.data ?? null,
  }
}

// The Style Kit reports: advanced color analysis with a drape test, and the
// style profile. Generated on request and kept until the selfie (color) or
// the body (style) changes.
const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)

    const [kit, color] = await Promise.all([hasKit(app, userId), hasColorAccess(app, userId)])

    if (!color) {
      return { available: false, colorAvailable: false, color: null, drape: null, style: null }
    }

    const report = await serializeReport(await app.collections.avatars.findOne({ userId }))

    // The Color Report unlocks the color half; the style profile needs the Kit.
    return { available: kit, colorAvailable: true, ...report, style: kit ? report.style : null }
  })

  app.post(
    '/color',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(refreshSchema, request.body ?? {})

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      try {
        await requireColorAccess(app, userId, 'The advanced color report')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.colorAnalysis || !avatar.avatarKey) {
        return reply.code(409).send({ message: 'Your avatar and colors need to be ready first.' })
      }

      if (avatar.colorReport && !parsed.data.refresh) {
        return serializeReport(avatar)
      }

      let data: Awaited<ReturnType<typeof generateColorReport>>

      try {
        data = await generateColorReport(avatar)
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Color report failed')
        return reply.code(502).send({ message: 'We could not write your color report. Try again.' })
      }

      const updated = await app.collections.avatars.findOneAndUpdate(
        { _id: avatar._id },
        {
          $set: {
            colorReport: { data, createdAt: new Date() },
            drape: {
              status: 'processing',
              key: avatar.drape?.key ?? null,
              wear: data.drape.wear,
              avoid: data.drape.avoid,
              updatedAt: new Date(),
            },
          },
        },
        { returnDocument: 'after' },
      )

      startDrapeTest(app, avatar._id)

      return serializeReport(updated)
    },
  )

  // Retries a drape test that failed.
  app.post(
    '/color/drape',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)

      try {
        await requireColorAccess(app, userId, 'The drape test')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOneAndUpdate(
        { userId, 'drape.status': 'failed' },
        { $set: { 'drape.status': 'processing', 'drape.updatedAt': new Date() } },
        { returnDocument: 'after' },
      )

      if (!avatar) {
        return reply.code(409).send({ message: 'There is no drape test to retry.' })
      }

      startDrapeTest(app, avatar._id)

      return serializeReport(avatar)
    },
  )

  app.post(
    '/style',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(refreshSchema, request.body ?? {})

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      try {
        await requireKit(app, userId, 'Your style profile')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.colorAnalysis) {
        return reply.code(409).send({ message: 'Your avatar and colors need to be ready first.' })
      }

      if (avatar.styleProfile && !parsed.data.refresh) {
        return serializeReport(avatar)
      }

      try {
        const data = await generateStyleProfile(app, avatar)
        const updated = await app.collections.avatars.findOneAndUpdate(
          { _id: avatar._id },
          { $set: { styleProfile: { data, createdAt: new Date() } } },
          { returnDocument: 'after' },
        )

        return serializeReport(updated)
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Style profile failed')
        return reply.code(502).send({ message: 'We could not write your style profile. Try again.' })
      }
    },
  )
}

export default reportRoutes
