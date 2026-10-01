import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { InvalidImageError, normalizeOutfitPhoto } from '../../utils/images.js'
import { storage } from '../../utils/storage.js'
import { trackServerEvent } from '../analytics/service.js'
import { PaywallError, sendPaywall } from '../billing/entitlements.js'

import { CheckLimitError, assertCheckAllowed, serializeCheck, startCheck } from './service.js'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

// "Does this color suit me?": a garment photo in, a verdict against their
// colors and that color on their face out (modules/check/service.ts).
const checkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const checks = await app.collections.colorChecks.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray()

    return { checks: await Promise.all(checks.map(serializeCheck)) }
  })

  app.post(
    '/',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      let upload: Buffer | null = null

      try {
        for await (const part of request.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 2 } })) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer()

            if (part.fieldname === 'photo') {
              upload = buffer
            }
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Check upload rejected')
        return reply.code(413).send({ message: 'The photo must be an image under 12 MB.' })
      }

      if (!upload) {
        return reply.code(400).send({ message: 'Add a photo of the garment.' })
      }

      const avatar = await app.collections.avatars.findOne({ userId }, { projection: { colorAnalysis: 1 } })

      if (!avatar?.colorAnalysis) {
        return reply.code(409).send({ message: 'We need your colors first: send a selfie.' })
      }

      try {
        await assertCheckAllowed(app, userId)
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        if (error instanceof CheckLimitError) {
          return reply.code(429).send({ message: error.message })
        }

        throw error
      }

      let photo: Buffer

      try {
        photo = await normalizeOutfitPhoto(upload)
      } catch (error) {
        return reply.code(400).send({ message: error instanceof InvalidImageError ? error.message : 'That photo could not be read.' })
      }

      const checkId = new ObjectId()
      // A .jpg, never matched as shareable: what they uploaded stays theirs.
      const garmentKey = `users/${userId.toString()}/check-${checkId.toString()}-garment.jpg`

      await storage.put(garmentKey, photo, 'image/jpeg')

      const now = new Date()
      const check = {
        _id: checkId,
        userId,
        status: 'processing' as const,
        error: null,
        garmentKey,
        imageKey: null,
        reading: null,
        createdAt: now,
        updatedAt: now,
      }

      await app.collections.colorChecks.insertOne(check)
      startCheck(app, checkId)
      void trackServerEvent(app, { name: 'color_check_started', userId })

      return reply.code(202).send({ check: await serializeCheck(check) })
    },
  )
}

export default checkRoutes
