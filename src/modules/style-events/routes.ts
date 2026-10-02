import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { LookDocument, StyleEventDocument } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { releaseGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { EVENT_LOOKS, PaywallError, refundEventAccess, sendPaywall, useEventAccess } from '../billing/entitlements.js'
import { reserveLookQuota } from '../looks/quota.js'
import { planLooks, startLookRender } from '../looks/service.js'
import { readTaste, toStylistTaste } from '../taste/service.js'
import { buildEventNotes } from './prompts.js'
import { serializeStyleEvent, startEventPrep } from './service.js'

const createSchema = z.object({
  occasion: z.string().trim().min(3).max(200),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  budget: z.enum(['save', 'mid', 'splurge']).default('mid'),
  notes: z.string().trim().max(280).optional().nullable(),
})

// The Event Stylist: three looks on their avatar for one event, planned for
// its dress code, budget and day, with how to finish them. The looks are
// ordinary looks (eventId set), so their pieces and stores open without Pro.
const styleEventRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const events = await app.collections.styleEvents.find({ userId }).sort({ createdAt: -1 }).limit(30).toArray()

    return { events: await Promise.all(events.map((event) => serializeStyleEvent(app, event, { looks: false }))) }
  })

  app.get('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const eventId = toObjectId((request.params as { id?: string }).id)
    const event = eventId ? await app.collections.styleEvents.findOne({ _id: eventId, userId }) : null

    if (!event) {
      return reply.code(404).send({ message: 'Event not found.' })
    }

    return { event: await serializeStyleEvent(app, event, { looks: true }) }
  })

  app.post(
    '/',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(createSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply.code(409).send({ message: 'Your avatar needs to be ready before the Event Stylist can dress you.' })
      }

      const { occasion, budget } = parsed.data
      const date = parsed.data.date ?? null
      const notes = parsed.data.notes || null
      const quota = await reserveLookQuota(app, userId, EVENT_LOOKS)

      if (!quota.ok) {
        return reply.code(quota.status).send(quota.body)
      }

      let via: Awaited<ReturnType<typeof useEventAccess>>

      try {
        via = await useEventAccess(app, userId)
      } catch (error) {
        await releaseGenerations(app, userId, 'look', EVENT_LOOKS)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      let plan: Awaited<ReturnType<typeof planLooks>>

      try {
        plan = await planLooks({
          avatar,
          occasion,
          notes: buildEventNotes({ notes, budget, date }),
          count: EVENT_LOOKS,
          taste: toStylistTaste(await readTaste(app, userId)),
        })
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Event planning failed')
        await releaseGenerations(app, userId, 'look', EVENT_LOOKS)
        await refundEventAccess(app, userId, via)
        return reply.code(502).send({ message: 'Our stylist could not plan this event. Please try again.' })
      }

      const now = new Date()
      const eventId = new ObjectId()
      const batchId = new ObjectId()
      const looks: LookDocument[] = plan.looks.slice(0, EVENT_LOOKS).map((lookPlan) => ({
        _id: new ObjectId(),
        userId,
        avatarId: avatar._id,
        batchId,
        eventId,
        occasion: {
          text: occasion,
          notes,
          dressCode: plan.dressCode,
          summary: plan.occasionSummary,
          asks: plan.asks,
        },
        plan: lookPlan,
        status: 'processing',
        error: null,
        imageKey: null,
        // Paid with the event: a failed render is retried free, not refunded.
        creditSpent: false,
        collectionIds: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        readyAt: null,
      }))

      if (looks.length === 0) {
        await releaseGenerations(app, userId, 'look', EVENT_LOOKS)
        await refundEventAccess(app, userId, via)
        return reply.code(502).send({ message: 'Our stylist could not plan this event. Please try again.' })
      }

      const event: StyleEventDocument = {
        _id: eventId,
        userId,
        batchId,
        occasion,
        date,
        budget,
        notes,
        dressCode: plan.dressCode,
        summary: plan.occasionSummary,
        prep: { status: 'processing', data: null },
        via,
        createdAt: now,
        updatedAt: now,
      }

      await app.collections.looks.insertMany(looks)
      await app.collections.styleEvents.insertOne(event)

      for (const look of looks) {
        startLookRender(app, look._id)
      }

      startEventPrep(app, eventId)

      void trackServerEvent(app, {
        name: 'event_styled',
        userId,
        props: { via, budget, dress_code: plan.dressCode, dated: Boolean(date) },
      })

      return reply.code(202).send({ event: await serializeStyleEvent(app, event, { looks: true }) })
    },
  )
}

export default styleEventRoutes
