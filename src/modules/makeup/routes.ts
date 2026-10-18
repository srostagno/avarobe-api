import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { storage } from '../../utils/storage.js'
import { dailyLimitReply, releaseGenerations, remainingGenerations, reserveUsage } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { PaywallError, requirePro, sendPaywall, spendCredits } from '../billing/entitlements.js'
import {
  BEST_FACE_PREFIX,
  MakeupLockedError,
  startBestFace,
  MakeupNotFoundError,
  makeupKeys,
  resolveMakeupPreset,
  serializeMakeupStudio,
  serializeMakeupTryOn,
  startMakeupTryOn,
} from './service.js'

const bestFaceSchema = z.object({ checkId: z.string().min(1).max(64) })

const makeupLimitBody = () => ({ code: 'daily_limit', message: `You can try ${env.DAILY_MAKEUP_LIMIT} makeup looks a day. Come back tomorrow.` })

// Makeup (the Face studio, Oct 17, 2026): ready-made makeup looks tried on
// her, from her selfie (and avatar). Off with MAKEUP_ENABLED=off.
const makeupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', async (_request, reply) => {
    if (env.MAKEUP_ENABLED !== 'on') {
      return reply.code(404).send({ message: 'Not found.' })
    }
  })

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId })

    return { ...(await serializeMakeupStudio(app, avatar, userId)), remaining: await remainingGenerations(app, userId, 'makeup') }
  })

  // One makeup on her: the one she has for this selfie (200, no charge), or
  // a new render (202): Pro spends a credit, otherwise her free one.
  app.post('/presets/:id/try-on', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const { id } = request.params as { id: string }

    if (!/^[a-z0-9-]{2,40}$/.test(id)) {
      return reply.code(404).send({ message: 'No such makeup.' })
    }

    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.selfieKey) {
      return reply.code(409).send({ code: 'needs_selfie', message: 'Add your selfie first.' })
    }

    let preset: Awaited<ReturnType<typeof resolveMakeupPreset>>

    try {
      preset = await resolveMakeupPreset(app, avatar, id)
    } catch (error) {
      if (error instanceof MakeupLockedError) {
        return sendPaywall(reply, new PaywallError('needs_color_report', error.message))
      }

      if (error instanceof MakeupNotFoundError) {
        return reply.code(404).send({ message: 'No such makeup.' })
      }

      throw error
    }

    const reserved = await reserveUsage(app, userId, 'makeup', 1)

    if (!reserved.ok) {
      return dailyLimitReply(reply, reserved, makeupLimitBody())
    }

    try {
      const { tryOn, started } = await startMakeupTryOn(app, avatar, preset)

      if (!started) {
        await releaseGenerations(app, userId, 'makeup', 1)
      } else {
        void trackServerEvent(app, { name: 'makeup_requested', userId, props: { preset: preset.id } })
      }

      return reply.code(started ? 202 : 200).send({ tryOn: await serializeMakeupTryOn(tryOn) })
    } catch (error) {
      await releaseGenerations(app, userId, 'makeup', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }
  })

  // "Unlock your best face" (Face Age, Pro): her face read's changes applied
  // to her; one credit, given back if it fails. The same read again: the
  // picture she has.
  app.post('/best-face', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(bestFaceSchema, request.body)
    const checkId = parsed.ok ? toObjectId(parsed.data.checkId) : null
    const check = checkId ? await app.collections.faceChecks.findOne({ _id: checkId, userId, status: 'ready' }) : null

    if (!checkId || !check?.reading?.usable || check.reading.tips.length === 0) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.selfieKey) {
      return reply.code(409).send({ code: 'needs_selfie', message: 'Add your selfie first.' })
    }

    const existing = await app.collections.makeupTryOns.findOne({ userId, presetId: `${BEST_FACE_PREFIX}${checkId.toString()}`, selfieKey: avatar.selfieKey })

    if (existing && existing.status !== 'failed') {
      return reply.code(200).send({ tryOn: await serializeMakeupTryOn(existing) })
    }

    const reserved = await reserveUsage(app, userId, 'makeup', 1)

    if (!reserved.ok) {
      return dailyLimitReply(reply, reserved, makeupLimitBody())
    }

    let creditSpent: boolean

    try {
      await requirePro(app, userId, 'Your best face')
      creditSpent = await spendCredits(app, userId, 1)
    } catch (error) {
      await releaseGenerations(app, userId, 'makeup', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }

    const { tryOn } = await startBestFace(app, { avatar, faceCheckId: checkId, tips: check.reading.tips, creditSpent })
    void trackServerEvent(app, { name: 'best_face_started', userId })

    return reply.code(202).send({ tryOn: await serializeMakeupTryOn(tryOn) })
  })

  app.get('/tryons/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id: string }).id)
    const tryOn = id ? await app.collections.makeupTryOns.findOne({ _id: id, userId }) : null

    if (!tryOn) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    return { tryOn: await serializeMakeupTryOn(tryOn) }
  })

  app.delete('/tryons/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id: string }).id)
    const tryOn = id ? await app.collections.makeupTryOns.findOne({ _id: id, userId }) : null

    if (!tryOn) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    await app.collections.makeupTryOns.deleteOne({ _id: tryOn._id, userId })

    await Promise.all(makeupKeys(tryOn).map((key) => storage.remove(key).catch(() => undefined)))

    return reply.code(204).send()
  })
}

export default makeupRoutes
