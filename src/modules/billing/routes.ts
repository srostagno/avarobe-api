import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import type { PurchaseProduct, RefundReason, UserDocument } from '../../types/mongo.js'
import { serializeUser } from '../../utils/serializers.js'
import { optionalUserId, trackServerEvent } from '../analytics/service.js'
import { deleteUserContent } from '../me/content.js'
import { attributionMetadata } from './conversions.js'
import { PRO_LIVE_STATUSES, adminUserIds, billingState, isAdmin, loadBillingUser } from './entitlements.js'
import { type PricingRegion, pricingRegion, REGION_CURRENCY, regionalAmount, regionalPrice } from './pricing.js'
import { REFUND_REASONS, RefundError, handleChargeRefunded, purchasesFor, requestRefund } from './refunds.js'
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
  startProNow,
  stripeConfigured,
  switchToAnnual,
  verifyWebhook,
} from './stripe.js'

// Meta's _fbc carries the whole ad click id, often well over 200 characters.
// An id that doesn't fit is dropped, never a reason to refuse a checkout
// (the same bug cost sign-ups in Sep 2026). attributionMetadata keeps what
// fits in Stripe's metadata.
const idField = z.string().regex(/^[A-Za-z0-9._-]{1,1024}$/).optional().catch(undefined)

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
    'pro_trial',
    'color_mirror',
    'hair_advisor',
    'advisors_bundle',
    'event_pass',
    'magazine',
  ]),
  // Browser analytics ids for server-side purchase events; absent when the
  // visitor opted out.
  attribution: z
    .object({ gaClientId: idField, fbp: idField, fbc: idField })
    .optional()
    .catch(undefined),
  // Which offer led here (first-party analytics), e.g. new_look_results.
  placement: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  // Stripe's form inside our page (the web asks in Instagram's browser).
  embedded: z.boolean().optional(),
  // Where to come back to if they cancel; only paths inside the studio.
  returnPath: z
    .string()
    .regex(/^\/studio(\/[\w\-/]*)?$/)
    .default('/studio'),
})

const previewSchema = z.object({ asCustomer: z.boolean() })

const refundSchema = z.object({
  purchaseId: z.string().regex(/^[a-f0-9]{24}$/),
  reason: z.enum(REFUND_REASONS as [RefundReason, ...RefundReason[]]),
  note: z.string().trim().max(500).optional(),
})

// Plan stages an admin can jump to, to see each offer without buying.
const SIMULATED_STAGES = [
  'free',
  'free_used',
  'pro_trial',
  'color_report',
  'style_report',
  'reports',
  'mirror',
  'hair_advisor',
  'advisors',
  'event_pass',
  'pack',
  'pro_monthly',
  'pro_low',
  'pro_ending',
  'pro_annual',
] as const

const simulateSchema = z.object({ stage: z.enum(SIMULATED_STAGES) })

// Where an admin starting over as a new user "arrived" from: a Colors ad
// (colors first: selfie, then colors) or the home page (avatar first).
const startOverSchema = z.object({ arrival: z.enum(['colors_ad', 'home']) })

const ARRIVALS = {
  colors_ad: { channel: 'meta', source: 'meta', medium: 'paid_social', campaign: 'launch_us', content: 'colors_black_a', landing: '/color-analysis' },
  home: { channel: 'direct', source: null, medium: null, campaign: null, content: null, landing: '/' },
} as const

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
    // A brand-new account: its sign-up looks.
    case 'free':
      return { credits: env.SIGNUP_CREDITS }
    case 'free_used':
      return { credits: 0 }
    case 'pro_trial': {
      const trialEnd = new Date(now.getTime() + env.PRO_TRIAL_DAYS * day)
      return {
        credits: env.PRO_TRIAL_CREDITS,
        paidAt: now,
        proTrialAt: now,
        pro: {
          subscriptionId: SIMULATED_SUBSCRIPTION,
          customerId: null,
          status: 'trialing',
          interval: 'month' as const,
          periodEnd: trialEnd,
          cancelAtPeriodEnd: false,
          nextCreditsAt: null,
          trialEnd,
        },
      }
    }
    case 'color_report':
      return { credits: 0, colorReportAt: now, paidAt: now }
    case 'style_report':
      return { credits: 0, styleReportAt: now, styleWithoutHair: true, paidAt: now }
    case 'reports':
      return { credits: 0, colorReportAt: now, styleReportAt: now, styleWithoutHair: true, paidAt: now }
    case 'mirror':
      return { credits: 0, colorMirrorAt: now, paidAt: now }
    case 'hair_advisor':
      return { credits: 0, hairAdvisorAt: now, paidAt: now }
    case 'advisors':
      return { credits: 0, colorReportAt: now, styleReportAt: now, hairAdvisorAt: now, paidAt: now }
    case 'event_pass':
      return { credits: 0, eventCredits: 1, paidAt: now }
    case 'pack':
      return { credits: 10, paidAt: now }
    case 'pro_monthly':
      return pro('month', 30)
    case 'pro_low':
      return pro('month', 2)
    case 'pro_ending':
      return pro('month', 12, { ending: true })
    case 'pro_annual':
      return { ...pro('year', 30), colorReportAt: now, styleReportAt: now, hairAdvisorAt: now }
    default:
      return {}
  }
}

const isSimulated = (subscriptionId: string | undefined) => subscriptionId === SIMULATED_SUBSCRIPTION

const funnelSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

const confirmSchema = z.object({
  sessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/),
})

function offer(region: PricingRegion) {
  return Object.fromEntries(
    Object.entries(PRODUCTS).map(([id, product]) => [
      id,
      {
        ...regionalPrice(id as PurchaseProduct, region),
        credits: product.credits(),
        interval: product.recurring ?? null,
      },
    ]),
  )
}

// The reports bought in the last days, counted toward Pro annual, at the
// prices of the buyer's region (billingState counts in US dollars).
function regionalReportCredit(user: Pick<UserDocument, 'colorReportAt' | 'styleReportAt'>, state: ReturnType<typeof billingState>, region: PricingRegion) {
  if (state.reportCreditCents === 0) {
    return 0
  }

  if (region === 'us') {
    return state.reportCreditCents
  }

  const windowMs = env.REPORT_CREDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const recent = (at: Date | null | undefined) => Boolean(at && at.getTime() + windowMs > Date.now())

  return Math.min(
    regionalAmount('reports_bundle', region),
    (recent(user.colorReportAt) ? regionalAmount('color_report', region) : 0) + (recent(user.styleReportAt) ? regionalAmount('style_report', region) : 0),
  )
}

// Who can buy what: nobody buys what they already have, the add-ons follow
// a recent report, and a monthly plan moves to annual from the account (a
// plan switch, not a second subscription).
function ineligibility(product: PurchaseProduct, state: ReturnType<typeof billingState>) {
  switch (product) {
    case 'color_report':
      return state.colorReport ? 'You already have your Color Advisor.' : null
    case 'style_report':
      return state.styleReport ? 'You already have your Style Advisor.' : null
    case 'reports_bundle':
      return state.colorReport || state.styleReport ? 'You already have one of the reports. Add the other one on its own.' : null
    case 'color_addon':
      return state.colorAddonUntil ? null : 'This price has ended. The Color Advisor is still available.'
    case 'style_addon':
      return state.styleAddonUntil ? null : 'This price has ended. The Style Advisor is still available.'
    case 'color_mirror':
      return state.colorMirror ? 'You already have the Color Advisor and its mirror.' : null
    case 'hair_advisor':
      return state.hairAdvisor ? 'You already have your Hair & Grooming Advisor.' : null
    case 'advisors_bundle':
      return state.colorReport && state.styleReport && state.hairAdvisor
        ? 'You already have all three advisors.'
        : state.colorReport || state.styleReport || state.hairAdvisor
          ? 'You already have one of the advisors. Add the others on their own.'
          : null
    case 'event_pass':
      return state.comp ? 'Your account already has unlimited events.' : null
    case 'magazine':
      return state.comp ? 'Your account already makes magazines free.' : null
    case 'look_pack':
      return state.comp ? 'Your account already has unlimited looks.' : null
    case 'pro_monthly':
      return state.proLive || state.comp ? 'You already have Avarobe Pro.' : null
    case 'pro_trial':
      return state.proLive || state.comp
        ? 'You already have Avarobe Pro.'
        : state.trialEligible
          ? null
          : !env.PRO_TRIAL
            ? 'The trial isn’t offered right now. Pro monthly is available.'
            : 'Your trial has been used. Pro monthly is still available.'
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
  // Prices where the visitor is (or, signed in, where they signed up).
  app.get('/offer', async (request) => {
    const userId = await optionalUserId(request)
    const user = userId ? await app.collections.users.findOne({ _id: userId }, { projection: { location: 1 } }) : null
    const region = pricingRegion(request, user)

    return {
    available: stripeConfigured(),
    region,
    currency: REGION_CURRENCY[region],
    products: offer(region),
    free: { credits: env.SIGNUP_CREDITS, avatarRuns: env.FREE_AVATAR_RUNS },
    // null while the trial is off: the web leads with the Color Advisor then.
    trial: env.PRO_TRIAL ? { days: env.PRO_TRIAL_DAYS, credits: env.PRO_TRIAL_CREDITS } : null,
    reportCreditDays: env.REPORT_CREDIT_WINDOW_DAYS,
    }
  })

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

      // A guest saves with their email first (the web asks before checkout),
      // so the receipt, the purchase and their way back in all have one.
      if (user.guest) {
        return reply.code(409).send({ code: 'email_required', message: 'Add your email to continue.' })
      }

      const state = billingState(user)
      const reason = ineligibility(parsed.data.product, state)

      if (reason) {
        return reply.code(409).send({ message: reason })
      }

      try {
        const location = await app.collections.users.findOne({ _id: userId }, { projection: { location: 1 } })
        const region = pricingRegion(request, location)
        const discountCents = parsed.data.product === 'pro_annual' ? regionalReportCredit(user, state, region) : 0
        const { url, clientSecret } = await createCheckout({
          user,
          product: parsed.data.product,
          returnPath: parsed.data.returnPath,
          discountCents,
          embedded: parsed.data.embedded,
          region,
          // An admin's own test purchase never reaches Meta or Google as a
          // conversion: without the browser ids there's nothing to report.
          attribution: isAdmin(user) ? {} : attributionMetadata(parsed.data.attribution, request),
        })
        void trackServerEvent(app, {
          name: 'checkout_created',
          userId,
          props: {
            product: parsed.data.product,
            amount: Math.max(0, regionalAmount(parsed.data.product, region) - discountCents),
            currency: REGION_CURRENCY[region],
            placement: parsed.data.placement ?? 'unknown',
            ui: parsed.data.embedded ? 'embedded' : 'hosted',
          },
        })
        return { url, clientSecret }
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
          // The id the server reports this purchase to Meta and GA with
          // (reportSession): a subscription's first invoice, the checkout
          // otherwise. The page's browser events use it, so the two merge.
          eventId: (typeof session.invoice === 'string' ? session.invoice : session.invoice?.id) ?? session.id,
        },
      }
    },
  )

  // Their purchases, for the account page, with the 7-day refund where it
  // still applies.
  app.get('/purchases', { preHandler: authenticate }, async (request) => {
    const userId = requireUserId(request)
    return { purchases: await purchasesFor(app, userId) }
  })

  app.post(
    '/refund',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(refundSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      try {
        await requestRefund(app, {
          userId,
          purchaseId: new ObjectId(parsed.data.purchaseId),
          reason: parsed.data.reason,
          note: parsed.data.note || null,
        })
      } catch (error) {
        if (error instanceof RefundError) {
          return reply.code(409).send({ message: error.message })
        }

        request.log.error({ err: errorMessage(error) }, 'Refund failed')
        return reply.code(502).send({ message: 'The refund didn’t go through. Try again in a moment, or write to hello@avarobe.com.' })
      }

      const user = await app.collections.users.findOne({ _id: userId })
      return { user: user ? serializeUser(user) : null, purchases: await purchasesFor(app, userId) }
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
    // Trials are counted apart: they aren't monthly revenue yet.
    const countPro = (interval: 'month' | 'year' | 'trial') =>
      app.collections.users.countDocuments({
        _id: { $nin: adminIds },
        ...(interval === 'trial'
          ? { 'pro.status': 'trialing' }
          : { 'pro.interval': interval, 'pro.status': { $in: [...PRO_LIVE_STATUSES].filter((status) => status !== 'trialing') } }),
        'pro.periodEnd': { $gt: new Date() },
        'pro.subscriptionId': { $ne: SIMULATED_SUBSCRIPTION },
      })
    // Everyone who started in the period, guests (trying before an account)
    // included; sign-ups are the ones with an account.
    const started = await app.collections.users
      .find({ createdAt: { $gte: since }, _id: { $nin: adminIds } }, { projection: { _id: 1, guest: 1 } })
      .toArray()
    const cohort = started.map((user) => user._id)
    const inCohort = { userId: { $in: cohort } }
    const [avatarReady, styled, triedOn, purchased, purchases, proMonthly, proAnnual, proTrials, arrivals] = await Promise.all([
      app.collections.avatars.countDocuments({ ...inCohort, readyAt: { $ne: null } }),
      app.collections.looks.distinct('userId', inCohort),
      app.collections.looks.distinct('userId', { ...inCohort, source: 'tryon' }),
      app.collections.purchases.distinct('userId', { ...inCohort, refundedAt: null }),
      app.collections.purchases
        .aggregate<{ _id: string; count: number; revenue: number; buyers: unknown[] }>([
          { $match: { createdAt: { $gte: since }, userId: { $nin: adminIds }, refundedAt: null } },
          { $group: { _id: '$product', count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$amountUsd', '$amountTotal'] } }, buyers: { $addToSet: '$userId' } } },
        ])
        .toArray(),
      countPro('month'),
      countPro('year'),
      countPro('trial'),
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
        started: cohort.length,
        signups: started.filter((user) => !user.guest).length,
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
        trials: proTrials,
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
            proTrialAt: '',
            styleKitUntil: '',
            colorReportAt: '',
            styleReportAt: '',
            colorMirrorAt: '',
            hairAdvisorAt: '',
            styleWithoutHair: '',
            eventCredits: '',
            magazineCredits: '',
            pro: '',
            paidAt: '',
            freeAvatarRuns: '',
            freeHairRuns: '',
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

  // Admins only: start over as a brand-new user, to walk the whole flow
  // again (selfie, colors, avatar, looks, offers). Wipes what they made, as
  // deleting the account would, keeps the account and its purchases, and
  // sets the plan back to a new account's in test mode.
  app.post('/admin/start-over', { preHandler: authenticate }, async (request, reply) => {
    const userId = requireUserId(request)
    const user = await loadBillingUser(app, userId)
    const parsed = parseBody(startOverSchema, request.body)

    if (!user || !isAdmin(user)) {
      return reply.code(403).send({ message: 'Only admins can do this.' })
    }

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    if (billingState(user).proLive && !user.pro?.cancelAtPeriodEnd && !isSimulated(user.pro?.subscriptionId)) {
      return reply.code(409).send({ message: 'Cancel your real Pro subscription first.' })
    }

    await deleteUserContent(app, userId)
    await app.collections.users.updateOne(
      { _id: userId },
      {
        $set: { acquisition: { visitorId: null, term: null, ...ARRIVALS[parsed.data.arrival] }, updatedAt: new Date() },
        $unset: { lifecycleEmails: '', lifecycleEmailLastAt: '', editEmails: '' },
      },
    )
    const updated = await simulate(userId, 'free')

    return { user: updated ? serializeUser(updated) : null }
  })

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
                hairAdvisorAt: user.hairAdvisorAt ?? now,
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

  // A trial that starts Pro early (when its looks run out): the first
  // monthly charge now, and the month's looks right away.
  app.post(
    '/pro/start',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const user = await loadBillingUser(app, userId)
      const state = user ? billingState(user) : null
      const subscriptionId = user?.pro?.subscriptionId

      if (!user || !state?.proLive || !subscriptionId) {
        return reply.code(404).send({ message: 'There is no active Pro subscription.' })
      }

      if (!state.trialing) {
        return reply.code(409).send({ message: 'Your Pro plan has already started.' })
      }

      try {
        if (isSimulated(subscriptionId)) {
          await app.collections.users.updateOne(
            { _id: userId },
            {
              $set: {
                'pro.status': 'active',
                'pro.periodEnd': addMonths(new Date(), 1),
                'pro.cancelAtPeriodEnd': false,
                'pro.trialEnd': null,
              },
              $inc: { credits: env.PRO_MONTHLY_CREDITS },
            },
          )
        } else {
          await startProNow(app, subscriptionId)
        }
      } catch (error) {
        if (error instanceof SwitchDeclinedError) {
          return reply.code(402).send({ message: `Your card was declined: ${error.message}` })
        }

        request.log.error({ err: errorMessage(error) }, 'Starting Pro early failed')
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
        case 'charge.refunded':
          await handleChargeRefunded(app, event.data.object)
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
