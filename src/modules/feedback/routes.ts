import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { FeedbackProduct } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { trackServerEvent } from '../analytics/service.js'
import { billingState, loadBillingUser } from '../billing/entitlements.js'
import { pricingRegion } from '../billing/pricing.js'

import { COMMENT_MAX, FEEDBACK_PRODUCTS, PRO_HALF, earnsOffer, npsGroup, offerView } from './rules.js'

const feedbackSchema = z.object({
  product: z.enum(FEEDBACK_PRODUCTS),
  score: z.number().int().min(0).max(10),
  comment: z.string().trim().max(COMMENT_MAX).optional(),
  quoteOk: z.boolean().optional(),
})

// Whether they have the advisor they're rating (bought, or with Pro).
function owns(product: FeedbackProduct, state: ReturnType<typeof billingState>) {
  switch (product) {
    case 'color_advisor':
      return state.colorReport
    case 'style_advisor':
      return state.styleReport
    case 'hair_advisor':
      return state.hairAdvisor
  }
}

// The rating at the end of each paid advisor's report (rules.ts).
const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // What they rated already, and Pro's half-price first month while it's open.
  app.get('/', async (request, reply) => {
    const userId = requireUserId(request)
    const [user, answers] = await Promise.all([
      loadBillingUser(app, userId),
      app.collections.feedback.find({ userId }, { projection: { product: 1, score: 1, comment: 1, quoteOk: 1, updatedAt: 1 } }).toArray(),
    ])

    if (!user) {
      return reply.code(401).send({ message: 'Sign in again to continue.' })
    }

    const state = billingState(user)

    return {
      answers: answers.map((answer) => ({
        product: answer.product,
        score: answer.score,
        comment: answer.comment,
        quoteOk: answer.quoteOk,
        at: answer.updatedAt.toISOString(),
      })),
      offer: state.proLive || state.comp ? null : offerView(user.proHalfOffer, pricingRegion(request, user)),
    }
  })

  // Their rating, and later the review written under it (the same call
  // again, with the comment): one per advisor, the latest kept. A rating of
  // 7 or more brings the offer once (earnsOffer).
  app.post('/', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(feedbackSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const user = await loadBillingUser(app, userId)

    if (!user) {
      return reply.code(401).send({ message: 'Sign in again to continue.' })
    }

    const state = billingState(user)
    const { product, score, comment, quoteOk } = parsed.data

    if (!owns(product, state)) {
      return reply.code(403).send({ message: 'Rate an advisor once you have it.' })
    }

    const now = new Date()
    const region = pricingRegion(request, user)
    const existing = await app.collections.feedback.findOne({ userId, product }, { projection: { _id: 1, comment: 1, quoteOk: 1 } })
    const acquisition = await app.collections.users.findOne({ _id: userId }, { projection: { acquisition: 1 } })

    await app.collections.feedback.updateOne(
      { userId, product },
      {
        $set: {
          score,
          // Leaving the box empty keeps what they wrote before.
          comment: comment ? comment : (existing?.comment ?? null),
          quoteOk: comment ? Boolean(quoteOk) : (existing?.quoteOk ?? false),
          locale: user.locale ?? 'en',
          region,
          pro: state.proActive,
          content: acquisition?.acquisition?.content ?? acquisition?.acquisition?.source ?? null,
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), userId, product, createdAt: now },
      },
      { upsert: true },
    )

    let offer = state.proLive || state.comp ? null : offerView(user.proHalfOffer, region)

    if (earnsOffer(user, score, state.comp)) {
      const given = { from: product, at: now, until: new Date(now.getTime() + PRO_HALF.hours * 60 * 60 * 1000), usedAt: null }
      // Once per person, even with two ratings at the same moment.
      const set = await app.collections.users.updateOne({ _id: userId, proHalfOffer: { $in: [null] } }, { $set: { proHalfOffer: given } })

      if (set.modifiedCount === 1) {
        offer = offerView(given, region)
        void trackServerEvent(app, { name: 'pro_half_offer', userId, props: { from: product, score } })
      }
    }

    void trackServerEvent(app, {
      name: existing ? 'feedback_updated' : 'feedback_given',
      userId,
      props: { product, score, group: npsGroup(score), comment: Boolean(comment) },
    })

    return { ok: true, offer }
  })
}

export default feedbackRoutes
