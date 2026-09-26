import type { FastifyPluginAsync } from 'fastify'
import type { Filter } from 'mongodb'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { LookDocument } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { serializeLook } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import {
  releaseGenerations,
  remainingGenerations,
  reserveGenerations,
} from '../../utils/usage.js'
import { planLooks, startLookRender } from './service.js'

const createSchema = z.object({
  occasion: z.string().trim().min(3).max(280),
  notes: z.string().trim().max(280).optional(),
  count: z.number().int().min(1).max(3).default(3),
})

const listQuerySchema = z.object({
  batchId: z.string().optional(),
  collectionId: z.string().optional(),
  favorite: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
})

const updateSchema = z.object({
  favorite: z.boolean().optional(),
})

const lookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(listQuerySchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const filter: Filter<LookDocument> = { userId }
    const batchId = toObjectId(parsed.data.batchId)
    const collectionId = toObjectId(parsed.data.collectionId)

    if (batchId) {
      filter.batchId = batchId
    }

    if (collectionId) {
      filter.collectionIds = collectionId
    }

    if (parsed.data.favorite) {
      filter.favorite = true
    }

    const looks = await app.collections.looks
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(parsed.data.limit)
      .toArray()

    return {
      looks: await Promise.all(looks.map(serializeLook)),
      remaining: await remainingGenerations(app, userId, 'look'),
    }
  })

  app.get('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const look = lookId
      ? await app.collections.looks.findOne({ _id: lookId, userId })
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    return { look: await serializeLook(look) }
  })

  // Plans the looks synchronously (the stylist call), then renders each one
  // in the background. The client polls GET /looks?batchId=.
  app.post(
    '/',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(createSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply
          .code(409)
          .send({ message: 'Your avatar needs to be ready before styling looks.' })
      }

      const { occasion, count } = parsed.data
      const notes = parsed.data.notes || null

      if (!(await reserveGenerations(app, userId, 'look', count))) {
        const remaining = await remainingGenerations(app, userId, 'look')

        return reply.code(429).send({
          message:
            remaining > 0
              ? `You have ${remaining} look${remaining === 1 ? '' : 's'} left today. Ask for fewer or come back tomorrow.`
              : `You've used today's ${env.DAILY_LOOK_LIMIT} looks. Come back tomorrow.`,
        })
      }

      let plan: Awaited<ReturnType<typeof planLooks>>

      try {
        plan = await planLooks({ avatar, occasion, notes, count })
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Look planning failed')
        await releaseGenerations(app, userId, 'look', count)
        return reply
          .code(502)
          .send({ message: 'Our stylist could not plan this one. Please try again.' })
      }

      if (plan.looks.length < count) {
        await releaseGenerations(app, userId, 'look', count - plan.looks.length)
      }

      const now = new Date()
      const batchId = new ObjectId()
      const looks: LookDocument[] = plan.looks.map((lookPlan) => ({
        _id: new ObjectId(),
        userId,
        avatarId: avatar._id,
        batchId,
        occasion: {
          text: occasion,
          dressCode: plan.dressCode,
          summary: plan.occasionSummary,
        },
        plan: lookPlan,
        status: 'processing',
        error: null,
        imageKey: null,
        collectionIds: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        readyAt: null,
      }))

      await app.collections.looks.insertMany(looks)

      for (const look of looks) {
        startLookRender(app, look._id)
      }

      return reply.code(202).send({
        batchId: batchId.toString(),
        looks: await Promise.all(looks.map(serializeLook)),
      })
    },
  )

  app.post(
    '/:id/retry',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const lookId = toObjectId((request.params as { id?: string }).id)
      const look = lookId
        ? await app.collections.looks.findOne({ _id: lookId, userId })
        : null

      if (!look) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      if (look.status !== 'failed') {
        return reply.code(409).send({ message: 'This look does not need a retry.' })
      }

      if (!(await reserveGenerations(app, userId, 'look', 1))) {
        return reply.code(429).send({
          message: `You've used today's ${env.DAILY_LOOK_LIMIT} looks. Come back tomorrow.`,
        })
      }

      await app.collections.looks.updateOne(
        { _id: look._id },
        { $set: { status: 'processing', error: null, updatedAt: new Date() } },
      )
      startLookRender(app, look._id)

      const updated = await app.collections.looks.findOne({ _id: look._id })

      return reply.code(202).send({ look: updated ? await serializeLook(updated) : null })
    },
  )

  app.patch('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const parsed = parseBody(updateSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const look = lookId
      ? await app.collections.looks.findOneAndUpdate(
          { _id: lookId, userId },
          { $set: { ...parsed.data, updatedAt: new Date() } },
          { returnDocument: 'after' },
        )
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    return { look: await serializeLook(look) }
  })

  app.delete('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const look = lookId
      ? await app.collections.looks.findOneAndDelete({ _id: lookId, userId })
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    await Promise.all(
      [look.imageKey, look.previewKey]
        .filter((key): key is string => Boolean(key))
        .map((key) => storage.remove(key).catch(() => undefined)),
    )

    return { ok: true }
  })
}

export default lookRoutes
