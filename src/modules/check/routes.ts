import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { InvalidImageError, normalizeOutfitPhoto } from '../../utils/images.js'
import { parseBody } from '../../utils/http.js'
import { storage } from '../../utils/storage.js'
import { dailyLimitReply, releaseGenerations, reserveUsage } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { FREE_USE_LIMITS, PaywallError, billingState, loadBillingUser, sendPaywall } from '../billing/entitlements.js'

import { CheckLimitError, assertCheckAllowed, serializeCheck, startCheck } from './service.js'
import { TAP_HEX, tapVerdict } from './tap.js'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const NO_COLORS = 'We need your colors first: send a selfie.'

// `photo`: an id the web makes for each photo, so a check is one photo and
// "Try another spot" on it is free.
const tapSchema = z
  .object({ hex: z.string().regex(TAP_HEX, 'Send a color as #RRGGBB.'), photo: z.string().regex(/^[a-z0-9]{8,32}$/).optional() })
  .strict()

// "Will it suit me?": a garment photo in; a verdict against their colors
// and that color on their face out, or (the full read) why it works or not
// from every angle and them wearing it (modules/check/service.ts).
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
        return reply.code(409).send({ message: NO_COLORS })
      }

      let deep = false

      try {
        ;({ deep } = await assertCheckAllowed(app, userId))
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

      // Each check draws a picture: one of the day's (AI_DAILY_IMAGE_LIMIT),
      // given back if it fails or the garment can't be read.
      const images = await reserveUsage(app, userId, 'image', 1)

      if (!images.ok) {
        return dailyLimitReply(reply, images, {})
      }

      const checkId = new ObjectId()
      // A .jpg, never matched as shareable: what they uploaded stays theirs.
      const garmentKey = `users/${userId.toString()}/check-${checkId.toString()}-garment.jpg`

      try {
        await storage.put(garmentKey, photo, 'image/jpeg')
      } catch (error) {
        await releaseGenerations(app, userId, 'image', 1)
        throw error
      }

      const now = new Date()
      const check = {
        _id: checkId,
        userId,
        status: 'processing' as const,
        error: null,
        garmentKey,
        imageKey: null,
        deep,
        imageKind: null,
        reading: null,
        createdAt: now,
        updatedAt: now,
      }

      await app.collections.colorChecks.insertOne(check)
      startCheck(app, checkId)
      void trackServerEvent(app, { name: 'color_check_started', userId, props: { deep } })

      return reply.code(202).send({ check: await serializeCheck(check) })
    },
  )

  // "Should I buy it?": one color tapped on a garment photo, judged against
  // their palette with CIEDE2000 (tap.ts). Deterministic, no AI. It needs
  // the Color Advisor (the full palette); without Pro, FREE_COLOR_TAPS
  // photos (part 3, Nov 10, 2026), claimed atomically like the studios'
  // free uses. `freeLeft`: photos left without Pro (null with Pro).
  app.post('/tap', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(tapSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const avatar = await app.collections.avatars.findOne({ userId }, { projection: { colorAnalysis: 1 } })
    const result = avatar?.colorAnalysis ? tapVerdict(parsed.data.hex, avatar.colorAnalysis) : null

    if (!result) {
      return reply.code(409).send({ message: NO_COLORS })
    }

    const user = await loadBillingUser(app, userId)
    const state = user ? billingState(user) : null

    if (!state?.colorReport) {
      return sendPaywall(reply, new PaywallError('needs_color_report', 'Checking pieces against your palette comes with the Color Advisor.'))
    }

    let freeLeft: number | null = null

    if (!state.proActive) {
      const { photo } = parsed.data
      const limit = FREE_USE_LIMITS.color_tap()
      const field = 'freeUses.color_tap'
      const again = photo ? await app.collections.users.findOne({ _id: userId, colorTapPhotos: photo }, { projection: { freeUses: 1 } }) : null
      const claimed =
        again ??
        (await app.collections.users.findOneAndUpdate(
          { _id: userId, $or: [{ [field]: { $exists: false } }, { [field]: { $lt: limit } }] },
          { $inc: { [field]: 1 }, $set: { updatedAt: new Date() }, ...(photo ? { $addToSet: { colorTapPhotos: photo } } : {}) },
          { returnDocument: 'after', projection: { freeUses: 1 } },
        ))

      if (!claimed) {
        return sendPaywall(reply, new PaywallError('needs_pro', 'Checking more pieces comes with Avarobe Pro.'))
      }

      freeLeft = Math.max(0, limit - (claimed.freeUses?.color_tap ?? 0))
    }

    void trackServerEvent(app, { name: 'color_tap_check', userId, props: { verdict: result.verdict, pro: state.proActive } })

    return { ...result, freeLeft }
  })
}

export default checkRoutes
