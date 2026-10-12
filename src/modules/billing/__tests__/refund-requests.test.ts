import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type LogLine } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ProSubscription, PurchaseDocument, RefundRequestDocument } from '../../../types/mongo.js'
import {
  RefundRequestError,
  approveRefundRequest,
  createGuideRefundRequest,
  createRefundRequest,
  forgetRefundRequests,
  planRefund,
  purchasesFor,
  rejectRefundRequest,
  sendRefundReminders,
  type RequestDeps,
} from '../refund-requests.js'
import { handleChargeRefunded, type RefundDeps } from '../refunds.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms)
const FOUNDER = 'founder@example.test'
const WHY = 'The season it gave me is wrong: warm colors make my face look grey and tired in every photo I take.'

const saved = { refunds: env.REFUNDS_EMAIL, allow: env.EMAIL_DEV_ALLOWLIST, since: env.REFUND_TERMS_SINCE, stripe: env.STRIPE_SECRET_KEY }

before(() => {
  // Nothing in these tests can reach a real inbox or Stripe.
  env.REFUNDS_EMAIL = [FOUNDER]
  env.EMAIL_DEV_ALLOWLIST = []
  env.REFUND_TERMS_SINCE = new Date('2026-01-01T00:00:00Z')
  env.STRIPE_SECRET_KEY = undefined
})

after(() => {
  env.REFUNDS_EMAIL = saved.refunds
  env.EMAIL_DEV_ALLOWLIST = saved.allow
  env.REFUND_TERMS_SINCE = saved.since
  env.STRIPE_SECRET_KEY = saved.stripe
})

// Stripe, as far as requests and refunds go.
function stripe(card: { country?: string; fingerprint?: string; disputed?: boolean } = {}) {
  const refunded: string[] = []
  const cancelled: string[] = []
  const renewals: [string, boolean][] = []
  const facts: unknown[] = []
  let users: (() => Record<string, unknown>[]) | null = null
  const refunds: RefundDeps = {
    refundPayment: async (paymentIntentId) => {
      refunded.push(paymentIntentId)
      return `re_${paymentIntentId}`
    },
    refundInvoice: async (invoiceId) => {
      refunded.push(invoiceId)
      return { refundId: `re_${invoiceId}`, paymentIntentId: `pi_of_${invoiceId}` }
    },
    cancelProNow: async (subscriptionId) => {
      cancelled.push(subscriptionId)
    },
    paymentOf: async () => 'pi_from_session',
  }
  const requests: RequestDeps = {
    paymentFacts: async (source) => {
      facts.push(source)
      return { brand: 'visa', last4: '4242', country: card.country ?? 'US', fingerprint: card.fingerprint ?? 'fp_1', disputed: Boolean(card.disputed) }
    },
    // As Stripe's subscription event would: the renewal set on the account.
    setProCancellation: async (_app, subscriptionId, cancel) => {
      renewals.push([subscriptionId, cancel])
      const user = users?.().find((doc) => (doc.pro as ProSubscription | undefined)?.subscriptionId === subscriptionId)

      if (user) {
        ;(user.pro as ProSubscription).cancelAtPeriodEnd = cancel
      }
    },
  }

  return { refunds, requests, refunded, cancelled, renewals, facts, watch: (docs: () => Record<string, unknown>[]) => (users = docs) }
}

type Seed = { user?: Record<string, unknown>; purchases?: Record<string, unknown>[]; guideOrders?: Record<string, unknown>[]; others?: Record<string, unknown[]> }

function world(seed: Seed = {}) {
  const userId = new ObjectId()
  const adminId = new ObjectId()
  const { app, collection, logs } = fakeApp({
    users: [
      { _id: userId, email: 'nora@example.com', firstName: 'Nora', locale: 'en', createdAt: ago(30 * DAY), location: { country: 'US', region: 'TX' }, ...seed.user },
      { _id: adminId, email: 'admin@example.test', firstName: 'Admin', createdAt: ago(300 * DAY) },
    ],
    purchases: (seed.purchases ?? []).map((purchase) => ({
      _id: new ObjectId(),
      userId,
      stripeSessionId: `cs_${Math.random()}`,
      stripePaymentIntentId: `pi_${Math.random()}`,
      amountTotal: 499,
      currency: 'usd',
      credits: 0,
      createdAt: ago(DAY),
      refundedAt: null,
      ...purchase,
    })),
    guideOrders: (seed.guideOrders ?? []).map((order) => ({ _id: new ObjectId(), userId: null, downloads: 0, lastDownloadAt: null, ...order })),
    ...(seed.others as Record<string, Record<string, unknown>[]>),
  })
  const users = () => collection('users').docs
  const user = () => users()[0] as Record<string, unknown> & { pro?: ProSubscription; credits?: number }
  const purchases = () => collection('purchases').docs as unknown as PurchaseDocument[]
  const requests = () => collection('refundRequests').docs as unknown as RefundRequestDocument[]
  const admin = { adminId, adminEmail: 'admin@example.test' }

  return { app, collection, logs, userId, users, user, purchases, requests, admin }
}

const sent = (logs: LogLine[], to: string) =>
  logs
    .filter((line) => line.msg === 'Dev email (not sent)' && (line.obj as { email: string }).email === to)
    .map((line) => (line.obj as { subject: string }).subject)

const ask = (userId: ObjectId, purchaseId: ObjectId, fields: Partial<{ category: string; explanation: string; acknowledge: unknown; locale: 'en' | 'pt-BR' | 'es' }> = {}) => ({
  userId,
  purchaseId,
  category: fields.category ?? 'not_accurate',
  explanation: fields.explanation ?? WHY,
  acknowledge: fields.acknowledge ?? true,
  locale: fields.locale ?? ('en' as const),
  requestCountry: null,
})

async function refused(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof RefundRequestError && error.status === status)
}

describe('asking for a refund', () => {
  it('stores a pending request, refunds nothing, and emails the founder and the customer once', async () => {
    const s = stripe()
    const w = world({ user: { colorReportAt: ago(DAY) }, purchases: [{ product: 'color_report', stripePaymentIntentId: 'pi_color' }] })

    const { request, created, notified } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)
    await notified

    assert.equal(created, true)
    assert.equal(request.status, 'pending')
    assert.match(request.ref, /^R-[0-9A-Z]{6}$/)
    assert.deepEqual(s.refunded, [])
    assert.ok(w.user().colorReportAt)
    assert.equal(w.purchases()[0]?.refundedAt, null)
    // What it covers, as it was: refundable even if the account goes.
    assert.equal(request.covers[0]?.stripePaymentIntentId, 'pi_color')
    assert.equal(request.amount, 499)
    assert.equal(request.email, 'nora@example.com')
    assert.equal(request.market.card?.last4, '4242')
    assert.equal(request.usage.hoursSincePurchase, 24)
    assert.equal(request.history.purchases, 1)
    assert.equal(request.openKey, `p:${w.purchases()[0]!._id.toString()}`)
    assert.deepEqual(sent(w.logs, FOUNDER).length, 1)
    assert.match(sent(w.logs, FOUNDER)[0]!, /^Reembolso R-[0-9A-Z]{6}: Asesor de Color · US\$ 4\.99 · nora@example\.com$/)
    assert.deepEqual(sent(w.logs, 'nora@example.com'), ['We got your refund request'])

    // The tick doesn't send them again.
    await sendRefundReminders(w.app, new Date(Date.now() + 10 * 60 * 1000))
    assert.equal(sent(w.logs, FOUNDER).length, 1)
    assert.equal(sent(w.logs, 'nora@example.com').length, 1)
  })

  it('gives the same request back when asked twice, and none for what was answered already', async () => {
    const s = stripe()
    const w = world({ purchases: [{ product: 'style_report' }] })
    const purchaseId = w.purchases()[0]!._id

    const first = await createRefundRequest(w.app, ask(w.userId, purchaseId), s.requests)
    const second = await createRefundRequest(w.app, ask(w.userId, purchaseId), s.requests)

    assert.equal(second.created, false)
    assert.ok(second.request._id.equals(first.request._id))
    assert.equal(w.requests().length, 1)

    await rejectRefundRequest(w.app, { ...w.admin, id: first.request._id, code: 'works_as_described', note: null, cdcOverride: false }, s.requests)
    await refused(createRefundRequest(w.app, ask(w.userId, purchaseId), s.requests), 409)
  })

  it('refuses one past the 7 days, one already refunded and someone else’s purchase', async () => {
    const s = stripe()
    const w = world({
      purchases: [
        { product: 'color_report', createdAt: ago(8 * DAY) },
        { product: 'magazine', refundedAt: ago(HOUR) },
        { product: 'event_pass', userId: new ObjectId() },
      ],
    })
    const [old, refunded, theirs] = w.purchases()

    await refused(createRefundRequest(w.app, ask(w.userId, old!._id), s.requests), 409)
    await refused(createRefundRequest(w.app, ask(w.userId, refunded!._id), s.requests), 409)
    await refused(createRefundRequest(w.app, ask(w.userId, theirs!._id), s.requests), 404)
    assert.equal(w.requests().length, 0)
  })

  it('checks the form: a category, their own words, the acknowledgement', async () => {
    const s = stripe()
    const w = world({ purchases: [{ product: 'color_report' }] })
    const purchaseId = w.purchases()[0]!._id

    await refused(createRefundRequest(w.app, ask(w.userId, purchaseId, { category: '' }), s.requests), 400)
    await refused(createRefundRequest(w.app, ask(w.userId, purchaseId, { explanation: 'It is not good.' }), s.requests), 400)
    await refused(createRefundRequest(w.app, ask(w.userId, purchaseId, { acknowledge: false }), s.requests), 400)
    assert.equal(w.requests().length, 0)
  })

  it('takes at most 3 requests a month, except Brazil’s withdrawals', async () => {
    const s = stripe()
    const products = ['color_report', 'style_report', 'hair_advisor', 'magazine', 'event_pass']
    const w = world({ purchases: products.map((product) => ({ product })) })
    const ids = w.purchases().map((purchase) => purchase._id)

    for (const id of ids.slice(0, 3)) {
      await createRefundRequest(w.app, ask(w.userId, id), s.requests)
    }

    await refused(createRefundRequest(w.app, ask(w.userId, ids[3]!), s.requests), 429)

    // The same person in Brazil (a Brazilian card): their right, whatever the count.
    const br = stripe({ country: 'BR' })
    const { request } = await createRefundRequest(w.app, ask(w.userId, ids[4]!, { explanation: 'Desisti da compra, obrigado.' }), br.requests)
    assert.equal(request.statutory?.law, 'br_cdc_49')
  })

  it('flags a Brazilian purchase within its 7 days as a withdrawal, and an old-Terms one as the old guarantee', async () => {
    const s = stripe()
    const w = world({
      user: { locale: 'pt-BR', location: { country: 'BR', region: 'SP' } },
      purchases: [
        { product: 'color_report', currency: 'brl', amountTotal: 1490 },
        { product: 'magazine', currency: 'brl', amountTotal: 2490, createdAt: ago(2 * DAY) },
      ],
    })
    const [color, magazine] = w.purchases()

    const { request, notified } = await createRefundRequest(w.app, ask(w.userId, color!._id, { explanation: 'Não quero mais esta compra.', locale: 'pt-BR' }), s.requests)
    await notified

    assert.ok(request.statutory)
    assert.equal(request.locale, 'pt-BR')
    assert.match(sent(w.logs, FOUNDER)[0]!, /^\[BR art\. 49\] Reembolso R-/)
    assert.deepEqual(sent(w.logs, 'nora@example.com'), ['Recebemos seu pedido de reembolso'])

    // The new Terms went live yesterday: the magazine was bought under the old ones.
    env.REFUND_TERMS_SINCE = new Date(Date.now() - DAY)

    try {
      const { request: guaranteed } = await createRefundRequest(w.app, ask(w.userId, magazine!._id, { explanation: 'Não quero mais esta revista.' }), s.requests)

      assert.equal(guaranteed.oldGuarantee, true)
      assert.ok(guaranteed.flags.includes('old_guarantee'))
    } finally {
      env.REFUND_TERMS_SINCE = new Date('2026-01-01T00:00:00Z')
    }
  })
})

describe('approving a request', () => {
  it('refunds once, takes back what it gave, marks the purchase and tells the customer', async () => {
    const s = stripe()
    const w = world({ user: { colorReportAt: ago(DAY), paidAt: ago(DAY) }, purchases: [{ product: 'color_report', stripePaymentIntentId: 'pi_color' }] })
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)

    await refused(approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 999, note: null }, s.refunds), 409)
    const approved = await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: 'Looks fair.' }, s.refunds)

    assert.equal(approved.status, 'refunded')
    assert.deepEqual(approved.refund?.stripeRefundIds, ['re_pi_color'])
    assert.equal(approved.refund?.via, 'admin')
    assert.equal(approved.openKey, undefined)
    assert.equal(approved.decision?.adminEmail, 'admin@example.test')
    assert.deepEqual(s.refunded, ['pi_color'])
    assert.equal(w.user().colorReportAt, undefined)
    assert.equal(w.purchases()[0]?.refund?.source, 'admin')
    assert.ok(w.purchases()[0]?.refund?.requestId?.equals(request._id))
    assert.ok(sent(w.logs, 'nora@example.com').includes('Your refund is on its way'))

    // A second click, or a second admin: no second refund.
    await refused(approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: null }, s.refunds), 409)
    assert.deepEqual(s.refunded, ['pi_color'])
    // Its own webhook closes nothing again.
    await handleChargeRefunded(w.app, { payment_intent: 'pi_color', refunded: true, amount_refunded: 499 }, async () => null, s.refunds)
    assert.equal(sent(w.logs, 'nora@example.com').filter((subject) => subject === 'Your refund is on its way').length, 1)
  })

  it('works after the 7 days for a request made within them', async () => {
    const s = stripe()
    const paidAt = ago(9 * DAY)
    const w = world({ purchases: [{ product: 'look_pack', credits: 10, createdAt: paidAt, stripePaymentIntentId: 'pi_pack' }], user: { credits: 10 } })
    const asked = { ...s.requests, now: () => new Date(paidAt.getTime() + 6 * DAY) }
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), asked)

    await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: null }, s.refunds)

    assert.deepEqual(s.refunded, ['pi_pack'])
    assert.equal(w.user().credits, 0)
  })

  it('leaves it failed with nothing taken when Stripe refuses, and Try again refunds it', async () => {
    const s = stripe()
    const w = world({ user: { colorReportAt: ago(DAY) }, purchases: [{ product: 'color_report', stripePaymentIntentId: 'pi_color' }] })
    const { request, notified } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)
    await notified
    const down = { ...s.refunds, refundPayment: async () => Promise.reject(new Error('Your card was declined.')) }

    await refused(approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: null }, down), 502)

    const failed = w.requests()[0]!
    assert.equal(failed.status, 'failed')
    assert.equal(failed.attempts[0]?.error, 'Your card was declined.')
    assert.equal(w.purchases()[0]?.refundedAt, null)
    assert.ok(w.user().colorReportAt)
    assert.deepEqual(sent(w.logs, 'nora@example.com'), ['We got your refund request'])

    const retried = await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: null }, s.refunds)
    assert.equal(retried.status, 'refunded')
    assert.equal(retried.attempts.length, 2)
  })

  it('closes as refunded in Stripe when Stripe says the charge was refunded already', async () => {
    const s = stripe()
    const w = world({ purchases: [{ product: 'event_pass', stripePaymentIntentId: 'pi_event' }], user: { eventCredits: 1 } })
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)
    const done = { ...s.refunds, refundPayment: async () => Promise.reject(Object.assign(new Error('Charge already refunded.'), { code: 'charge_already_refunded' })) }

    const closed = await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: null }, done)

    assert.equal(closed.status, 'refunded')
    assert.equal(closed.refund?.via, 'stripe')
    assert.equal(w.user().eventCredits, 0)
  })
})

describe('Pro’s first week', () => {
  const live = (fields: Partial<ProSubscription> = {}): ProSubscription => ({
    subscriptionId: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    interval: 'month',
    periodEnd: new Date(Date.now() + 28 * DAY),
    cancelAtPeriodEnd: false,
    ...fields,
  })

  it('pauses the renewal while under review, and approving refunds every first-week payment and ends Pro', async () => {
    const s = stripe()
    const w = world({
      user: { credits: 35, pro: live() },
      purchases: [
        { product: 'pro_trial', amountTotal: 490, credits: 10, createdAt: ago(5 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_trial' },
        { product: 'pro_monthly', amountTotal: 799, credits: 30, createdAt: ago(2 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_month' },
      ],
    })
    s.watch(w.users)
    const { request, notified } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[1]!._id, { category: 'quality' }), s.requests)
    await notified

    assert.equal(request.covers.length, 2)
    assert.equal(request.amount, 1289)
    assert.deepEqual(s.renewals, [['sub_1', true]])
    assert.equal(w.user().pro?.cancelAtPeriodEnd, true)
    assert.equal(request.proPause?.wasCancelAtPeriodEnd, false)
    assert.ok(sent(w.logs, 'nora@example.com').length === 1)

    const plan = await planRefund(w.app, request)
    assert.equal(plan.total, 1289)
    assert.equal(plan.endsPro, true)

    await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 1289, note: null }, s.refunds)

    assert.deepEqual(s.refunded, ['in_trial', 'in_month'])
    assert.deepEqual(s.cancelled, ['sub_1'])
    assert.equal(w.user().pro?.status, 'canceled')
    assert.equal(w.user().credits, 0)
  })

  it('puts the renewal back on rejection, unless it was already set to cancel', async () => {
    const s = stripe()
    const w = world({ user: { pro: live() }, purchases: [{ product: 'pro_monthly', amountTotal: 799, credits: 30, createdAt: ago(DAY) }] })
    s.watch(w.users)
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id, { category: 'quality' }), s.requests)

    const rejected = await rejectRefundRequest(w.app, { ...w.admin, id: request._id, code: 'resolved', note: null, cdcOverride: false }, s.requests)

    assert.deepEqual(s.renewals, [['sub_1', true], ['sub_1', false]])
    assert.ok(rejected.proPause?.restoredAt)
    assert.equal(w.user().pro?.cancelAtPeriodEnd, false)
    assert.match(sent(w.logs, 'nora@example.com').join('|'), /About your refund request/)

    const t = stripe()
    const cancelling = world({ user: { pro: live({ cancelAtPeriodEnd: true }) }, purchases: [{ product: 'pro_monthly', amountTotal: 799, createdAt: ago(DAY) }] })
    t.watch(cancelling.users)
    const asked = await createRefundRequest(cancelling.app, ask(cancelling.userId, cancelling.purchases()[0]!._id), t.requests)
    await rejectRefundRequest(cancelling.app, { ...cancelling.admin, id: asked.request._id, code: 'used', note: null, cdcOverride: false }, t.requests)

    assert.deepEqual(t.renewals, [])
    assert.equal(cancelling.user().pro?.cancelAtPeriodEnd, true)
  })

  it('adds a Pro charge made during the review to the plan, and flags it', async () => {
    const s = stripe()
    const w = world({ user: { pro: live({ status: 'trialing' }) }, purchases: [{ product: 'pro_trial', amountTotal: 490, createdAt: ago(5 * DAY), stripePaymentIntentId: 'pi_trial' }] })
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)
    // The pause failed somehow, and the trial turned into a month.
    await w.collection('purchases').insertOne({
      _id: new ObjectId(),
      userId: w.userId,
      product: 'pro_monthly',
      stripeSessionId: 'in_month',
      stripePaymentIntentId: 'pi_month',
      amountTotal: 799,
      currency: 'usd',
      credits: 30,
      createdAt: new Date(),
      refundedAt: null,
    })

    const plan = await planRefund(w.app, request)

    assert.equal(plan.total, 1289)
    assert.ok(plan.payments.some((payment) => payment.duringReview && payment.amount === 799))
    assert.ok(plan.warnings.some((warning) => warning.startsWith('Charged during review: Avarobe Pro')))

    await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 1289, note: null }, s.refunds)
    assert.deepEqual(s.refunded, ['pi_trial', 'pi_month'])
  })
})

describe('rejecting a request', () => {
  it('needs a note for “other”, and the override for a Brazilian withdrawal', async () => {
    const s = stripe({ country: 'BR' })
    const w = world({ user: { locale: 'pt-BR' }, purchases: [{ product: 'color_report', currency: 'brl', amountTotal: 1490 }] })
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id, { explanation: 'Não era o que eu queria.' }), s.requests)

    await refused(rejectRefundRequest(w.app, { ...w.admin, id: request._id, code: 'other', note: 'Too short', cdcOverride: true }, s.requests), 400)
    await refused(rejectRefundRequest(w.app, { ...w.admin, id: request._id, code: 'duplicate', note: null, cdcOverride: false }, s.requests), 409)

    const rejected = await rejectRefundRequest(
      w.app,
      { ...w.admin, id: request._id, code: 'other', note: 'Você pagou duas vezes e já devolvemos a outra cobrança.', cdcOverride: true },
      s.requests,
    )

    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.decision?.cdcOverride, true)
    assert.equal(rejected.openKey, undefined)
    assert.deepEqual(s.refunded, [])
    assert.ok(sent(w.logs, 'nora@example.com').includes('Sobre o seu pedido de reembolso'))
  })
})

describe('refunds made in Stripe’s dashboard', () => {
  it('close the open request as refunded, with the approved email once', async () => {
    const s = stripe()
    const w = world({ user: { colorReportAt: ago(DAY) }, purchases: [{ product: 'color_report', stripePaymentIntentId: 'pi_color' }] })
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)

    await handleChargeRefunded(w.app, { payment_intent: 'pi_color', refunded: true, amount_refunded: 499 }, async () => null, s.refunds)
    await handleChargeRefunded(w.app, { payment_intent: 'pi_color', refunded: true, amount_refunded: 499 }, async () => null, s.refunds)

    const closed = w.requests().find((doc) => doc._id.equals(request._id))!
    assert.equal(closed.status, 'refunded')
    assert.equal(closed.decision?.by, 'stripe')
    assert.equal(closed.refund?.via, 'stripe')
    assert.equal(w.user().colorReportAt, undefined)
    assert.equal(sent(w.logs, 'nora@example.com').filter((subject) => subject === 'Your refund is on its way').length, 1)
  })
})

describe('the Outfit Formula Book', () => {
  it('is requested by a guest from its link, and approving refunds the order and stops the link', async () => {
    const s = stripe()
    const w = world({
      guideOrders: [
        { sessionId: 'cs_book', email: 'guest@example.com', token: 'tok_download', refundToken: 'ref_book', amount: 1490, currency: 'usd', paymentIntentId: 'pi_book', createdAt: ago(DAY), refundedAt: null, downloads: 1 },
      ],
    })
    const book = { token: 'ref_book', category: 'not_expected', explanation: WHY, acknowledge: true, locale: 'es' as const, requestCountry: 'MX' }

    await refused(createGuideRefundRequest(w.app, { ...book, token: 'tok_download' }, s.requests), 404)
    const { request, notified } = await createGuideRefundRequest(w.app, book, s.requests)
    await notified

    assert.equal(request.source, 'guide_link')
    assert.equal(request.userId, null)
    assert.equal(request.locale, 'es')
    assert.equal(request.usage.guideDownloads, 1)
    assert.deepEqual(sent(w.logs, 'guest@example.com'), ['Recibimos tu solicitud de reembolso'])

    await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 1490, note: null }, s.refunds)

    assert.deepEqual(s.refunded, ['pi_book'])
    assert.ok(w.collection('guideOrders').docs[0]?.refundedAt)
    assert.ok(sent(w.logs, 'guest@example.com').includes('Tu reembolso va en camino'))
  })

  it('bought signed in, is one request from the account page and the link', async () => {
    const s = stripe()
    const w = world({ purchases: [{ product: 'outfit_guide', amountTotal: 1490, stripeSessionId: 'cs_mine', stripePaymentIntentId: 'pi_mine' }] })
    await w.collection('guideOrders').insertOne({
      _id: new ObjectId(),
      sessionId: 'cs_mine',
      email: 'nora@example.com',
      userId: w.userId,
      token: 'tok_mine',
      refundToken: 'ref_mine',
      amount: 1490,
      currency: 'usd',
      paymentIntentId: 'pi_mine',
      createdAt: ago(DAY),
      refundedAt: null,
      downloads: 0,
    })

    const fromAccount = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id, { category: 'mistake' }), s.requests)
    const fromLink = await createGuideRefundRequest(
      w.app,
      { token: 'ref_mine', category: 'mistake', explanation: WHY, acknowledge: true, locale: 'en', requestCountry: null },
      s.requests,
    )

    assert.equal(fromLink.created, false)
    assert.ok(fromLink.request._id.equals(fromAccount.request._id))
    assert.ok(fromAccount.request.guideOrderId)
  })
})

describe('an account deleted with a request open', () => {
  it('can still be approved: the money goes back by the payment kept, and the email to the address kept', async () => {
    const s = stripe()
    const w = world({ user: { colorReportAt: ago(DAY) }, purchases: [{ product: 'color_report', stripePaymentIntentId: 'pi_color' }] })
    const { request } = await createRefundRequest(w.app, ask(w.userId, w.purchases()[0]!._id), s.requests)

    // As DELETE /me does: requests first, then the account and its purchases.
    await forgetRefundRequests(w.app, w.userId)
    await w.collection('purchases').deleteMany({ userId: w.userId })
    await w.collection('users').deleteOne({ _id: w.userId })

    const plan = await planRefund(w.app, w.requests()[0]!)
    assert.ok(plan.warnings.includes('Account deleted: money back only'))

    await approveRefundRequest(w.app, { ...w.admin, id: request._id, expectedAmount: 499, note: null }, s.refunds)

    assert.deepEqual(s.refunded, ['pi_color'])
    assert.ok(sent(w.logs, 'nora@example.com').includes('Your refund is on its way'))
    // Scrubbed once its decision went out.
    const scrubbed = w.requests()[0]!
    assert.equal(scrubbed.email, null)
    assert.equal(scrubbed.explanation, '')
    assert.ok(scrubbed.emailHash)
  })
})

describe('the account page', () => {
  it('lists each purchase with its request, and never offers a refund already requested', async () => {
    const s = stripe()
    const w = world({
      purchases: [
        { product: 'pro_monthly', amountTotal: 799, createdAt: ago(32 * DAY) },
        { product: 'pro_monthly', amountTotal: 799, createdAt: ago(2 * DAY) },
        { product: 'magazine', amountTotal: 990, createdAt: ago(2 * DAY) },
        { product: 'color_report', amountTotal: 499, createdAt: ago(DAY) },
      ],
    })
    const [, , magazine, color] = w.purchases()
    await createRefundRequest(w.app, ask(w.userId, color!._id), s.requests)

    const listed = await purchasesFor(w.app, w.userId)
    const byProduct = Object.fromEntries(listed.map((item) => [item.product, item]))

    // Pro's renewal isn't refundable; the color report's has its request.
    assert.deepEqual(
      listed.filter((item) => item.refundableUntil).map((item) => item.product),
      ['magazine'],
    )
    assert.equal(byProduct.color_report?.refundRequest?.status, 'pending')
    assert.equal(byProduct.color_report?.refundableUntil, null)
    assert.equal(byProduct.magazine?.withdrawal, null)
    assert.ok(magazine)
  })

  it('says the whole first week’s Pro amount on each of its payments, and Brazil’s withdrawal while it lasts', async () => {
    const w = world({
      user: { location: { country: 'BR', region: 'SP' } },
      purchases: [
        { product: 'pro_monthly', amountTotal: 2490, currency: 'brl', createdAt: ago(3 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_m' },
        { product: 'pro_annual', amountTotal: 9990, currency: 'brl', createdAt: ago(2 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_a' },
        { product: 'look_pack', amountTotal: 1490, currency: 'brl', createdAt: ago(DAY) },
      ],
    })
    const listed = await purchasesFor(w.app, w.userId)
    const amounts = Object.fromEntries(listed.map((item) => [item.product, [item.amount, item.refundAmount]]))

    assert.deepEqual(amounts, { pro_monthly: [2490, 12480], pro_annual: [9990, 12480], look_pack: [1490, 1490] })
    assert.equal(listed.find((item) => item.product === 'look_pack')?.withdrawal?.law, 'br_cdc_49')
  })
})
