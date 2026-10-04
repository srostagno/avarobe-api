import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { MagazineDocument, MagazinePhoto } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { trackServerEvent } from '../analytics/service.js'
import { PaywallError, refundMagazineAccess, sendPaywall, useMagazineAccess } from '../billing/entitlements.js'
import { magazineMoments } from './prompts.js'
import { magazineSeason, planMagazine, serializeMagazine, startMagazine } from './service.js'

const createSchema = z.object({
  // Moment ids from the list, in order.
  moments: z.array(z.string().max(40)).max(10).default([]),
  // Their own moments ("My sister's baby shower"), after the listed ones.
  custom: z.array(z.string().trim().min(3).max(80)).max(3).default([]),
})

// The personal magazine: a cover, a letter and up to ten looks on location,
// on their own avatar, paid with a magazine credit. The photos are made in
// the background and the issue is emailed when it's ready.
const magazineRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const [magazines, avatar, user] = await Promise.all([
      app.collections.magazines.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray(),
      app.collections.avatars.findOne({ userId }, { projection: { status: 1, avatarKey: 1, body: 1, presentation: 1 } }),
      app.collections.users.findOne({ _id: userId }, { projection: { magazineCredits: 1 } }),
    ])

    return {
      magazines: await Promise.all(magazines.map(serializeMagazine)),
      moments: magazineMoments(avatar?.body?.presentation ?? avatar?.presentation),
      credits: user?.magazineCredits ?? 0,
      avatarReady: Boolean(avatar?.avatarKey && avatar.status === 'ready'),
    }
  })

  app.get('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id?: string }).id)
    const magazine = id ? await app.collections.magazines.findOne({ _id: id, userId }) : null

    if (!magazine) {
      return reply.code(404).send({ message: 'Magazine not found.' })
    }

    return { magazine: await serializeMagazine(magazine) }
  })

  app.post('/', { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(createSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.avatarKey || avatar.status !== 'ready') {
      return reply.code(409).send({ message: 'Your avatar needs to be ready before we can shoot your magazine.' })
    }

    const listed = magazineMoments(avatar.body?.presentation ?? avatar.presentation)
    const labels = [
      ...parsed.data.moments.map((id) => listed.find((moment) => moment.id === id)?.label).filter((label): label is string => Boolean(label)),
      ...parsed.data.custom,
    ].slice(0, 10)

    if (labels.length < 3) {
      return reply.code(400).send({ message: 'Pick at least three moments for your magazine.' })
    }

    let via: 'credit' | 'comp'

    try {
      via = await useMagazineAccess(app, userId)
    } catch (error) {
      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }

    const user = await app.collections.users.findOne({ _id: userId }, { projection: { firstName: 1 } })
    let plan: Awaited<ReturnType<typeof planMagazine>>

    try {
      plan = await planMagazine({ firstName: user?.firstName ?? '', avatar, moments: labels })
    } catch (error) {
      request.log.error({ err: errorMessage(error) }, 'Magazine planning failed')
      await refundMagazineAccess(app, userId, via)
      return reply.code(502).send({ message: 'Our editor could not plan your magazine. Please try again.' })
    }

    const now = new Date()
    const colors = avatar.colorAnalysis
    const magazine: MagazineDocument = {
      _id: new ObjectId(),
      userId,
      status: 'processing',
      moments: labels,
      season: magazineSeason(avatar),
      palette: colors ? [...colors.bestColors, ...colors.neutrals].slice(0, 8) : [],
      plan,
      cover: { status: 'processing', key: null },
      looks: plan.looks.map(() => ({ status: 'processing', key: null })),
      via,
      createdAt: now,
      updatedAt: now,
      readyAt: null,
    }

    await app.collections.magazines.insertOne(magazine)
    startMagazine(app, magazine._id)
    void trackServerEvent(app, { name: 'magazine_started', userId, props: { via, moments: labels.length, custom: parsed.data.custom.length } })

    return reply.code(202).send({ magazine: await serializeMagazine(magazine) })
  })

  // Redoes the photos that failed, free.
  app.post('/:id/retry', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id?: string }).id)
    const magazine = id ? await app.collections.magazines.findOne({ _id: id, userId }) : null

    if (!magazine) {
      return reply.code(404).send({ message: 'Magazine not found.' })
    }

    const failed = [magazine.cover, ...magazine.looks].some((photo) => photo.status === 'failed')

    if (!failed || magazine.status === 'processing') {
      return reply.code(409).send({ message: 'Nothing to redo in this magazine.' })
    }

    const again: MagazinePhoto = { status: 'processing', key: null }
    const reset: Record<string, MagazinePhoto> = {}

    if (magazine.cover.status === 'failed') {
      reset.cover = again
    }

    magazine.looks.forEach((photo, index) => {
      if (photo.status === 'failed') {
        reset[`looks.${index}`] = again
      }
    })

    await app.collections.magazines.updateOne({ _id: magazine._id }, { $set: { ...reset, status: 'processing', updatedAt: new Date() } })
    startMagazine(app, magazine._id)
    const updated = await app.collections.magazines.findOne({ _id: magazine._id })

    return reply.code(202).send({ magazine: await serializeMagazine(updated ?? magazine) })
  })
}

export default magazineRoutes
