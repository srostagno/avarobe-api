import type { FastifyPluginAsync } from 'fastify'
import type { ObjectId } from 'mongodb'
import type Stripe from 'stripe'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import type { PurchaseProduct } from '../../types/mongo.js'
import { serializeUser } from '../../utils/serializers.js'
import { trackServerEvent } from '../analytics/service.js'
import { attributionMetadata } from './conversions.js'
import { PRO_LIVE_STATUSES, adminUserIds, billingState, isAdmin, loadBillingUser } from './entitlements.js'
import {
  BillingNotConfiguredError,
  PRODUCTS,
  SwitchDeclinedError,
  addMonths,
  createCheckout,
  grantSession,
  handleInvoicePaid,
  handleSubscriptionChange,
  retrieveSession,
  sessionSettled,
  setProCancellation,
  stripeConfigured,
  switchToAnnual,
  verifyWebhook,
} from './stripe.js'

const idPattern = /^[A-Za-z0-9._-]{1,200}$/

const checkoutSchema = z.object({
  product: z.enum([
    'color_report',
    'style_report',
    'reports_bundle',
    'color_addon',
    'style_addon',
    'look_pack',
    'pro_monthly',
    'pro_annual',
  ]),
  // Browser analytics ids for server-side purchase events; absent when the
  // visitor opted out.
  attribution: z
    .object({
      gaClientId: z.string().regex(idPattern).optional(),
      fbp: z.string().regex(idPattern).optional(),
      fbc: z.string().regex(idPattern).optional(),
    })
    .optional(),
  // Which offer led here (first-party analytics), e.g. new_look_results.
  placement: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  // Where to come back to if they cancel; only paths inside the studio.
  returnPath: z
    .string()
    .regex(/^\/studio(\/[\w\-/]*)?$/)
    .default('/studio'),
})

const previewSchema = z.object({ asCustomer: z.boolean() })

// Plan stages an admin can jump to, to see each offer without buying.
const SIMULATED_STAGES = [
  'free',
  'free_used',
  'color_report',
  'style_report',
  'reports',
  'pack',
  'pro_monthly',
  'pro_low',
  'pro_ending',
  'pro_annual',
] as const

const simulateSchema = z.object({ stage: z.enum(SIMULATED_STAGES) })

// Simulated Plus subscriptions never reach Stripe.
const SIMULATED_SUBSCRIPTION = 'sim_admin'

function stageFields(stage: (typeof SIMULATED_STAGES)[number]) {
  const now = new Date()
  const day = 24 * 60 * 60 * 1000
  const pro = (interval: 'month' | 'year', credits: number, options: { ending?: boolean } = {}) => ({
    credits,
    paidAt: now,
    pro: {
      subscriptionId: SIMULATED_SUBSCRIPTION,
      customerId: null,
      status: 'active',
      interval,
      periodEnd: options.ending ? new Date(now.getTime() + 5 * day) : addMonths(now, interval === 'year' ? 12 : 1),
      cancelAtPeriodEnd: Boolean(options.ending),
      nextCreditsAt: interval === 'year' ? addMonths(now, 1) : null,
    },
  })

  switch (stage) {
    case 'free_used':
      return { credits: 0 }
    case 'color_report':
      return { credits: 0, colorReportAt: now, paidAt: now }
    case 'style_report':
      return { credits: 0, styleReportAt: now, paidAt: now }
    case 'reports':
      return { credits: 0, colorReportAt: now, styleReportAt: now, paidAt: now }
    case 'pack':
      return { credits: 10, paidAt: now }
    case 'pro_monthly':
      return pro('month', 30)
    case 'pro_low':
      return pro('month', 2)
    case 'pro_ending':
      return pro('month', 12, { ending: true })
    case 'pro_annual':
      return { ...pro('year', 30), colorReportAt: now, styleReportAt: now }
    default:
      return {}
  }
}

const isSimulated = (subscriptionId: string | undefined) => subscriptionId === SIMULATED_SUBSCRIPTION

const funnelSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

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
        interval: product.recurring ?? null,
      },
    ]),
  )
}

// Who can buy what: nobody buys what they already have, the add-ons follow
// a recent report, and a monthly plan moves to annual from the account (a
// plan switch, not a second subscription).
function ineligibility(product: PurchaseProduct, state: ReturnType<typeof billingState>) {
  switch (product) {
    case 'color_report':
      return state.colorReport ? 'You already have your Color Report.' : null
    case 'style_report':
      return state.styleReport ? 'You already have your Style Report.' : null
    case 'reports_bundle':
      return state.colorReport || state.styleReport ? 'You already have one of the reports. Add the other one on its own.' : null
    case 'color_addon':
      return state.colorAddonUntil ? null : 'This price has ended. The Color Report is still available.'
    case 'style_addon':
      return state.styleAddonUntil ? null : 'This price has ended. The Style Report is still available.'
    case 'look_pack':
      return state.comp ? 'Your account already has unlimited looks.' : null
    case 'pro_monthly':
      return state.proLive || state.comp ? 'You already have Avarobe Pro.' : null
    case 'pro_annual':
      if (state.comp) {
        return 'You already have Avarobe Pro.'
      }

      return state.proInterval === 'year'
        ? 'You already have Pro annual.'
        : state.proLive
          ? 'Switch your plan to annual from your account.'
          : null
  }
}

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/offer', async () => ({
    available: stripeConfigured(),
    products: offer(),
    free: { credits: env.FREE_CREDITS, avatarRuns: env.FREE_AVATAR_RUNS },
    reportCreditDays: env.REPORT_CREDIT_WINDOW_DAYS,
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

      const state = billingState(user)
      const reason = ineligibility(parsed.data.product, state)

      if (reason) {
        return reply.code(409).send({ message: reason })
      }

      try {
        const discountCents = parsed.data.product === 'pro_annual' ? state.reportCreditCents : 0
        const url = await createCheckout({
          user,
          product: parsed.data.product,
          returnPath: parsed.data.returnPath,
          discountCents,
          attribution: attributionMetadata(parsed.data.attribution, request),
        })
        void trackServerEvent(app, {
          name: 'checkout_created',
          userId,
          props: {
            product: parsed.data.product,
            amount: Math.max(0, PRODUCTS[parsed.data.product].amount() - discountCents),
            placement: parsed.data.placement ?? 'unknown',
          },
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
    const adminIds = await adminUserIds(app)
    const countPro = (interval: 'month' | 'year') =>
      app.collections.users.countDocuments({
        _id: { $nin: adminIds },
        'pro.interval': interval,
        'pro.status': { $in: [...PRO_LIVE_STATUSES] },
        'pro.periodEnd': { $gt: new Date() },
        'pro.subscriptionId': { $ne: SIMULATED_SUBSCRIPTION },
      })
    const cohort = (
      await app.collections.users
        .find({ createdAt: { $gte: since }, _id: { $nin: adminIds } }, { projection: { _id: 1 } })
        .toArray()
    ).map((user) => user._id)
    const inCohort = { userId: { $in: cohort } }
    const [avatarReady, styled, triedOn, purchased, purchases, proMonthly, proAnnual, arrivals] = await Promise.all([
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
      countPro('month'),
      countPro('year'),
      app.collections.arrivals
        .aggregate<{ _id: string; count: number; inApp: number }>([
          { $match: { at: { $gte: since } } },
          { $group: { _id: '$stage', count: { $sum: 1 }, inApp: { $sum: { $cond: ['$inApp', 1, 0] } } } },
        ])
        .toArray(),
    ])
    const stage = (name: string) => arrivals.find((row) => row._id === name)

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
      // Visits from Meta ads, counted by us: the request reached the site,
      // the page ran, the click became an account.
      ads: {
        arrived: stage('arrived')?.count ?? 0,
        loaded: stage('loaded')?.count ?? 0,
        registered: stage('registered')?.count ?? 0,
        inAppArrived: stage('arrived')?.inApp ?? 0,
      },
      pro: {
        monthly: proMonthly,
        annual: proAnnual,
        // Annual plans count a twelfth of their price.
        mrr: Math.round(proMonthly * env.PRICE_PRO_MONTHLY_CENTS + (proAnnual * env.PRICE_PRO_ANNUAL_CENTS) / 12),
      },
    }
  })

  // Puts an admin's own account in a plan stage (and in test mode), with
  // today's usage cleared. 'free' is a brand-new account. Refused while a
  // real Pro subscription is live: its next invoice would undo it.
  async function simulate(userId: ObjectId, stage: (typeof SIMULATED_STAGES)[number]) {
    const [updated] = await Promise.all([
      app.collections.users.findOneAndUpdate(
        { _id: userId },
        {
          $unset: {
            credits: '',
            styleKitUntil: '',
            colorReportAt: '',
            styleReportAt: '',
            pro: '',
            paidAt: '',
            freeAvatarRuns: '',
          },
          $set: { compPaused: true, updatedAt: new Date() },
        },
        { returnDocument: 'after' },
      ),
      app.collections.usageCounters.deleteMany({ userId, day: new Date().toISOString().slice(0, 10) }),
    ])
    const fields = stageFields(stage)

    if (Object.keys(fields).length === 0) {
      return updated
    }

    return app.collections.users.findOneAndUpdate({ _id: userId }, { $set: fields }, { returnDocument: 'after' })
  }

  for (const path of ['/admin/reset', '/admin/simulate']) {
    app.post(path, { preHandler: authenticate }, async (request, reply) => {
      const userId = requireUserId(request)
      const user = await loadBillingUser(app, userId)

      if (!user || !isAdmin(user)) {
        return reply.code(403).send({ message: 'Only admins can do this.' })
      }

      const parsed =
        path === '/admin/reset'
          ? { ok: true as const, data: { stage: 'free' as const } }
          : parseBody(simulateSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      if (billingState(user).proLive && !user.pro?.cancelAtPeriodEnd && !isSimulated(user.pro?.subscriptionId)) {
        return reply.code(409).send({ message: 'Cancel your real Pro subscription first.' })
      }

      const updated = await simulate(userId, parsed.data.stage)

      return { user: updated ? serializeUser(updated) : null }
    })
  }

  // Pro: cancel at the end of the paid period, or keep it after all.
  for (const [path, cancel] of [
    ['/pro/cancel', true],
    ['/pro/resume', false],
  ] as const) {
    app.post(
      path,
      { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const userId = requireUserId(request)
        const user = await loadBillingUser(app, userId)
        const subscriptionId = user?.pro?.subscriptionId

        if (!subscriptionId || !billingState(user).proLive) {
          return reply.code(404).send({ message: 'There is no active Pro subscription.' })
        }

        try {
          if (isSimulated(subscriptionId)) {
            await app.collections.users.updateOne({ _id: userId }, { $set: { 'pro.cancelAtPeriodEnd': cancel } })
          } else {
            await setProCancellation(app, subscriptionId, cancel)
          }
        } catch (error) {
          request.log.error({ err: errorMessage(error) }, 'Pro cancellation change failed')
          return reply.code(502).send({ message: 'Billing is not responding. Try again in a moment.' })
        }

        const updated = await app.collections.users.findOne({ _id: userId })
        return { user: updated ? serializeUser(updated) : null }
      },
    )
  }

  // Monthly to annual: charged now (minus the unused part of the month),
  // with both reports and a new year of monthly looks.
  app.post(
    '/pro/annual',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const user = await loadBillingUser(app, userId)
      const state = user ? billingState(user) : null
      const subscriptionId = user?.pro?.subscriptionId

      if (!user || !state?.proLive || !subscriptionId) {
        return reply.code(404).send({ message: 'There is no active Pro subscription.' })
      }

      if (state.proInterval === 'year') {
        return reply.code(409).send({ message: 'You already have Pro annual.' })
      }

      try {
        if (isSimulated(subscriptionId)) {
          const now = new Date()
          await app.collections.users.updateOne(
            { _id: userId },
            {
              $set: {
                'pro.interval': 'year',
                'pro.periodEnd': addMonths(now, 12),
                'pro.cancelAtPeriodEnd': false,
                'pro.nextCreditsAt': addMonths(now, 1),
                colorReportAt: user.colorReportAt ?? now,
                styleReportAt: user.styleReportAt ?? now,
              },
              $inc: { credits: env.PRO_MONTHLY_CREDITS },
            },
          )
        } else {
          await switchToAnnual(app, subscriptionId)
        }
      } catch (error) {
        if (error instanceof SwitchDeclinedError) {
          return reply.code(402).send({ message: `Your card was declined: ${error.message}` })
        }

        request.log.error({ err: errorMessage(error) }, 'Switch to annual failed')
        return reply.code(502).send({ message: 'Billing is not responding. Try again in a moment.' })
      }

      const updated = await app.collections.users.findOne({ _id: userId })
      return { user: updated ? serializeUser(updated) : null }
    },
  )
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
