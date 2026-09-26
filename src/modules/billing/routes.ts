import type { FastifyPluginAsync } from 'fastify'
import type Stripe from 'stripe'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import type { PurchaseProduct } from '../../types/mongo.js'
import { serializeUser } from '../../utils/serializers.js'
import { attributionMetadata } from './conversions.js'
import { billingState, isAdmin, loadBillingUser } from './entitlements.js'
import {
  BillingNotConfiguredError,
  PRODUCTS,
  createCheckout,
  grantSession,
  handleInvoicePaid,
  handleSubscriptionChange,
  retrieveSession,
  sessionSettled,
  setPlusCancellation,
  stripeConfigured,
  verifyWebhook,
} from './stripe.js'

const idPattern = /^[A-Za-z0-9._-]{1,200}$/

const checkoutSchema = z.object({
  product: z.enum(['style_kit', 'top_up', 'color_report', 'kit_upgrade', 'plus']),
  // Browser analytics ids for server-side purchase events; absent when the
  // visitor opted out.
  attribution: z
    .object({
      gaClientId: z.string().regex(idPattern).optional(),
      fbp: z.string().regex(idPattern).optional(),
      fbc: z.string().regex(idPattern).optional(),
    })
    .optional(),
  // Where to come back to if they cancel; only paths inside the studio.
  returnPath: z
    .string()
    .regex(/^\/studio(\/[\w\-/]*)?$/)
    .default('/studio'),
})

const previewSchema = z.object({ asCustomer: z.boolean() })

const funnelSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

const LIVE_PLUS = ['active', 'trialing', 'past_due']

const confirmSchema = z.object({
  sessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/),
})

function offer() {
  return Object.fromEntries(
    Object.entries(PRODUCTS).map(([id, product]) => [
      id,
      {
        amount: product.amount(),
        currency: 'usd',
        credits: product.credits(),
        days: product.days(),
        interval: product.recurring ?? null,
      },
    ]),
  )
}

// Who can buy what: top-ups and Plus continue a Style Kit, the upgrade
// follows a recent Color Report, and nobody buys what they already have.
function ineligibility(product: PurchaseProduct, state: ReturnType<typeof billingState>) {
  switch (product) {
    case 'top_up':
      return state.everHadKit ? null : 'Top-ups are for Style Kit owners.'
    case 'plus':
      if (!state.everHadKit) {
        return 'Plus is for Style Kit owners.'
      }

      return state.plusActive ? 'You already have Plus.' : null
    case 'color_report':
      return state.colorAccess ? 'You already have your full color report.' : null
    case 'kit_upgrade':
      return state.kitUpgradeUntil ? null : 'The upgrade price has expired. The Style Kit is still available.'
    default:
      return null
  }
}

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/offer', async () => ({
    available: stripeConfigured(),
    products: offer(),
    free: { credits: env.FREE_CREDITS, avatarRuns: env.FREE_AVATAR_RUNS },
  }))

  app.post(
    '/checkout',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(checkoutSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const user = await loadBillingUser(app, userId)

      if (!user) {
        return reply.code(401).send({ message: 'Sign in again to continue.' })
      }

      const reason = ineligibility(parsed.data.product, billingState(user))

      if (reason) {
        return reply.code(409).send({ message: reason })
      }

      try {
        const url = await createCheckout({
          user,
          product: parsed.data.product,
          returnPath: parsed.data.returnPath,
          attribution: attributionMetadata(parsed.data.attribution, request),
        })
        return { url }
      } catch (error) {
        if (error instanceof BillingNotConfiguredError) {
          return reply.code(503).send({ message: 'Payments are coming soon.' })
        }

        request.log.error({ err: errorMessage(error) }, 'Stripe checkout failed')
        return reply.code(502).send({ message: 'Checkout is not responding. Try again in a moment.' })
      }
    },
  )

  // The success page reports the session so access starts right away, even
  // before (or without) the webhook.
  app.post(
    '/confirm',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(confirmSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      let session: Stripe.Checkout.Session

      try {
        session = await retrieveSession(parsed.data.sessionId)
      } catch (error) {
        request.log.warn({ err: errorMessage(error) }, 'Stripe session lookup failed')
        return reply.code(404).send({ message: 'We could not find that payment.' })
      }

      if (session.metadata?.userId !== userId.toString()) {
        return reply.code(404).send({ message: 'We could not find that payment.' })
      }

      if (!sessionSettled(session)) {
        return reply.code(409).send({ message: 'The payment is still processing. Refresh in a moment.' })
      }

      await grantSession(app, session)

      const user = await app.collections.users.findOne({ _id: userId })

      return {
        user: user ? serializeUser(user) : null,
        purchase: {
          mode: session.mode,
          product: session.metadata?.product ?? null,
          amount: session.amount_total ?? 0,
          currency: session.currency ?? 'usd',
          sessionId: session.id,
        },
      }
    },
  )

  // Admins only: see the app as a customer (free Kit off), and wipe their own
  // test purchases to walk through the free flow again.
  app.post('/admin/preview', { preHandler: authenticate }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(previewSchema, request.body)
    const user = await loadBillingUser(app, userId)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    if (!user || !isAdmin(user)) {
      return reply.code(403).send({ message: 'Only admins can do this.' })
    }

    const updated = await app.collections.users.findOneAndUpdate(
      { _id: userId },
      { $set: { compPaused: parsed.data.asCustomer, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    return { user: updated ? serializeUser(updated) : null }
  })

  // The funnel from the database (no ad blockers in the way): of the people
  // who signed up in the last N days, how many got an avatar, styled a look
  // and paid; plus purchases, revenue and Plus in the period. Admins excluded.
  app.get('/admin/funnel', { preHandler: authenticate }, async (request, reply) => {
    const userId = requireUserId(request)
    const viewer = await loadBillingUser(app, userId)
    const parsed = parseBody(funnelSchema, request.query)

    if (!viewer || !isAdmin(viewer)) {
      return reply.code(403).send({ message: 'Only admins can do this.' })
    }

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const since = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000)
    const admins = env.COMP_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
    const adminIds = (
      await app.collections.users.find({ email: { $in: admins } }, { projection: { _id: 1 } }).toArray()
    ).map((user) => user._id)
    const cohort = (
      await app.collections.users
        .find({ createdAt: { $gte: since }, _id: { $nin: adminIds } }, { projection: { _id: 1 } })
        .toArray()
    ).map((user) => user._id)
    const inCohort = { userId: { $in: cohort } }
    const [avatarReady, styled, triedOn, purchased, purchases, plusActive, kitActive] = await Promise.all([
      app.collections.avatars.countDocuments({ ...inCohort, readyAt: { $ne: null } }),
      app.collections.looks.distinct('userId', inCohort),
      app.collections.looks.distinct('userId', { ...inCohort, source: 'tryon' }),
      app.collections.purchases.distinct('userId', inCohort),
      app.collections.purchases
        .aggregate<{ _id: string; count: number; revenue: number; buyers: unknown[] }>([
          { $match: { createdAt: { $gte: since }, userId: { $nin: adminIds } } },
          { $group: { _id: '$product', count: { $sum: 1 }, revenue: { $sum: '$amountTotal' }, buyers: { $addToSet: '$userId' } } },
        ])
        .toArray(),
      app.collections.users.countDocuments({
        _id: { $nin: adminIds },
        'plus.status': { $in: LIVE_PLUS },
        'plus.periodEnd': { $gt: new Date() },
      }),
      app.collections.users.countDocuments({ _id: { $nin: adminIds }, styleKitUntil: { $gt: new Date() } }),
    ])

    return {
      days: parsed.data.days,
      cohort: {
        signups: cohort.length,
        avatarReady,
        styledLook: styled.length,
        triedOn: triedOn.length,
        purchased: purchased.length,
      },
      purchases: purchases
        .map((row) => ({ product: row._id, count: row.count, buyers: row.buyers.length, revenue: row.revenue }))
        .sort((a, b) => b.revenue - a.revenue),
      revenue: purchases.reduce((sum, row) => sum + row.revenue, 0),
      plus: { active: plusActive, mrr: plusActive * env.PLUS_PRICE_CENTS },
      kitActive,
    }
  })

  app.post('/admin/reset', { preHandler: authenticate }, async (request, reply) => {
    const userId = requireUserId(request)
    const user = await loadBillingUser(app, userId)

    if (!user || !isAdmin(user)) {
      return reply.code(403).send({ message: 'Only admins can do this.' })
    }

    // A live subscription would put Plus back on its next invoice.
    if (billingState(user).plusActive && !user.plus?.cancelAtPeriodEnd) {
      return reply.code(409).send({ message: 'Cancel Plus first, then reset.' })
    }

    const updated = await app.collections.users.findOneAndUpdate(
      { _id: userId },
      {
        $unset: { credits: '', styleKitUntil: '', colorReportAt: '', plus: '', freeAvatarRuns: '' },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' },
    )

    return { user: updated ? serializeUser(updated) : null }
  })

  // Plus: cancel at the end of the paid period, or keep it after all.
  for (const [path, cancel] of [
    ['/plus/cancel', true],
    ['/plus/resume', false],
  ] as const) {
    app.post(
      path,
      { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const userId = requireUserId(request)
        const user = await loadBillingUser(app, userId)
        const subscriptionId = user?.plus?.subscriptionId

        if (!subscriptionId || !billingState(user).plusActive) {
          return reply.code(404).send({ message: 'There is no active Plus subscription.' })
        }

        try {
          await setPlusCancellation(app, subscriptionId, cancel)
        } catch (error) {
          request.log.error({ err: errorMessage(error) }, 'Plus cancellation change failed')
          return reply.code(502).send({ message: 'Billing is not responding. Try again in a moment.' })
        }

        const updated = await app.collections.users.findOne({ _id: userId })
        return { user: updated ? serializeUser(updated) : null }
      },
    )
  }
}

// Stripe needs the exact raw body to check the signature, so the webhook
// lives in its own plugin with a string body parser.
export const billingWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  app.post('/', { config: { rateLimit: false } }, async (request, reply) => {
    const signature = request.headers['stripe-signature']

    if (typeof signature !== 'string') {
      return reply.code(400).send({ message: 'Missing Stripe signature.' })
    }

    let event: Stripe.Event

    try {
      event = verifyWebhook(typeof request.body === 'string' ? request.body : '', signature)
    } catch (error) {
      request.log.warn({ err: errorMessage(error) }, 'Rejected Stripe webhook')
      return reply.code(400).send({ message: 'Invalid Stripe webhook.' })
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          await grantSession(app, event.data.object)
          break
        case 'invoice.paid':
          await handleInvoicePaid(app, event.data.object)
          break
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await handleSubscriptionChange(app, event.data.object)
          break
        default:
          break
      }
    } catch (error) {
      // A 500 makes Stripe retry later.
      request.log.error({ err: errorMessage(error), type: event.type }, 'Stripe webhook failed')
      return reply.code(500).send({ message: 'Webhook processing failed.' })
    }

    return { received: true }
  })
}

export default billingRoutes
