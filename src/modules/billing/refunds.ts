import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type {
  GuideOrderDocument,
  PurchaseDocument,
  PurchaseProduct,
  RefundCover,
  RefundReason,
  RefundRequestFlag,
  UserDocument,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { trackServerEvent } from '../analytics/service.js'
import { adminUserIds } from './entitlements.js'
import { toUsdCents } from './pricing.js'
import { closeRequestsOnStripeRefund } from './refund-requests.js'
import { PRODUCTS, alreadyRefunded, cancelProNow, invoiceOfPayment, refundInvoice, refundPayment, retrieveSession } from './stripe.js'

// Money back (Oct 2026). Refunds are requested and reviewed: the customer
// asks with a reason (billing/refund-requests.ts), the founder approves in
// Admin → Refunds, and only then is the money given back here and what the
// purchase gave taken away (refundCovers). Nothing a customer does refunds
// money on its own. A refund made in Stripe's dashboard takes access away
// too (handleChargeRefunded) and closes its open request.
//
// What can be asked for: every one-time product and the book within 7 days
// of paying, and Pro's first week (every Pro payment in the 7 days after
// their first one), never a renewal. Brazil's right of withdrawal (CDC
// art. 49) counts 7 calendar days, São Paulo time, after the day of purchase.
export const REFUND_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = REFUND_WINDOW_DAYS * DAY_MS
// São Paulo is UTC-03:00 all year (Brazil dropped daylight time in 2019).
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000

export const PRO_PRODUCTS = new Set<PurchaseProduct>(['pro_monthly', 'pro_annual', 'pro_trial'])

export const REFUNDABLE = new Set<PurchaseProduct>([
  'color_report',
  'style_report',
  'reports_bundle',
  'color_addon',
  'style_addon',
  'color_mirror',
  'hair_advisor',
  'advisors_bundle',
  'event_pass',
  'magazine',
  'look_pack',
  'outfit_guide',
  ...PRO_PRODUCTS,
])

export const isPro = (product: string) => PRO_PRODUCTS.has(product as PurchaseProduct)

type RefundablePurchase = Pick<PurchaseDocument, 'product' | 'amountTotal' | 'stripePaymentIntentId' | 'stripeSessionId' | 'createdAt' | 'refundedAt'>

// How the money goes back: its payment, or (Pro payments recorded before
// purchases kept it) its invoice's.
export const hasRefundablePayment = (purchase: Pick<PurchaseDocument, 'product' | 'stripePaymentIntentId' | 'stripeSessionId'>) =>
  Boolean(purchase.stripePaymentIntentId) || (isPro(purchase.product) && purchase.stripeSessionId.startsWith('in_'))

// The end of Brazil's 7 days to withdraw from a purchase (CDC art. 49): the
// purchase day doesn't count, so it's the end of the 7th calendar day after
// it, São Paulo time. Oct 1 at 23:30 → Oct 8 at 23:59:59.999 (−03:00).
export function brazilWithdrawalUntil(paidAt: Date) {
  const local = new Date(paidAt.getTime() - SAO_PAULO_OFFSET_MS)
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + REFUND_WINDOW_DAYS, 23, 59, 59, 999)

  return new Date(end + SAO_PAULO_OFFSET_MS)
}

// When the 7 days to ask for a refund of a payment made at `paidAt` end: 7 ×
// 24 h, or in Brazil the later of that and the end of the 7th calendar day.
export function windowEnd(paidAt: Date, brazil = false) {
  const hours = paidAt.getTime() + WINDOW_MS
  return new Date(brazil ? Math.max(hours, brazilWithdrawalUntil(paidAt).getTime()) : hours)
}

// Until when a refund of this purchase can still be asked for (null: it
// can't). Pro: only payments in the first 7 days of their first Pro
// (`firstProAt`, their earliest Pro purchase), never a renewal. `brazil`:
// a Brazilian purchase, whose window counts calendar days.
export function refundableUntil(purchase: RefundablePurchase, context: { firstProAt?: Date | null; brazil?: boolean } = {}, now = Date.now()) {
  if (!REFUNDABLE.has(purchase.product as PurchaseProduct) || purchase.refundedAt || purchase.amountTotal <= 0 || !hasRefundablePayment(purchase)) {
    return null
  }

  if (isPro(purchase.product)) {
    const first = context.firstProAt ?? purchase.createdAt

    if (purchase.createdAt.getTime() >= first.getTime() + WINDOW_MS) {
      return null
    }
  }

  const until = windowEnd(purchase.createdAt, context.brazil)
  return until.getTime() > now ? until : null
}

export async function firstProAt(app: FastifyInstance, userId: ObjectId) {
  const first = await app.collections.purchases.findOne(
    { userId, product: { $in: [...PRO_PRODUCTS] } },
    { sort: { createdAt: 1 }, projection: { createdAt: 1 } },
  )

  return first?.createdAt ?? null
}

// Pro's first week: every Pro payment in the 7 days after their first one
// (a trial, then the switch to monthly or annual), not refunded yet. A
// request for one of them covers them all.
export async function proFirstWeek(app: FastifyInstance, userId: ObjectId, firstPro: Date) {
  const payments = await app.collections.purchases
    .find({
      userId,
      product: { $in: [...PRO_PRODUCTS] },
      refundedAt: null,
      amountTotal: { $gt: 0 },
      createdAt: { $lt: new Date(firstPro.getTime() + WINDOW_MS) },
    })
    .sort({ createdAt: 1 })
    .toArray()

  return payments.filter(hasRefundablePayment)
}

// What a purchase gave, taken back: the advisors it unlocked (unless another
// purchase that's kept unlocks them too), its credits, passes and magazines
// (as far as they're left), the book's download link, and the "paid" mark if
// nothing paid is left.
export async function revokePurchase(app: FastifyInstance, purchase: PurchaseDocument) {
  const [user, kept] = await Promise.all([
    app.collections.users.findOne({ _id: purchase.userId }),
    app.collections.purchases
      .find({ userId: purchase.userId, _id: { $ne: purchase._id }, refundedAt: null, amountTotal: { $gt: 0 } })
      .toArray(),
  ])

  if (purchase.product === 'outfit_guide') {
    await app.collections.guideOrders.updateOne({ sessionId: purchase.stripeSessionId, refundedAt: null }, { $set: { refundedAt: purchase.refundedAt ?? new Date() } })
  }

  if (!user) {
    return
  }

  const config = PRODUCTS[purchase.product as PurchaseProduct]
  const keeps = { color: false, style: false, hair: false, mirror: false }

  for (const other of kept) {
    const unlocks = PRODUCTS[other.product as PurchaseProduct]?.unlocks

    keeps.color ||= Boolean(unlocks?.color)
    keeps.style ||= Boolean(unlocks?.style)
    keeps.hair ||= Boolean(unlocks?.hair)
    keeps.mirror ||= Boolean(unlocks?.mirror)
  }

  const unlocks = config?.unlocks ?? {}
  const unset: Partial<Record<keyof UserDocument, ''>> = {}

  if (unlocks.color && !keeps.color) unset.colorReportAt = ''
  if (unlocks.style && !keeps.style) unset.styleReportAt = ''
  if (unlocks.hair && !keeps.hair) unset.hairAdvisorAt = ''
  if (unlocks.mirror && !keeps.mirror) unset.colorMirrorAt = ''
  if (kept.length === 0 && !user.pro) unset.paidAt = ''

  const take = (have: number | undefined, amount: number) => Math.max(0, (have ?? 0) - amount)
  const set: Partial<UserDocument> = { updatedAt: new Date() }

  if (purchase.credits > 0) set.credits = take(user.credits, purchase.credits)
  if (config?.events) set.eventCredits = take(user.eventCredits, config.events)
  if (config?.magazines) set.magazineCredits = take(user.magazineCredits, config.magazines)

  await app.collections.users.updateOne(
    { _id: purchase.userId },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
  )
}

// What refunds go through, so tests can stand in for Stripe. `paymentOf`:
// the payment of a book order from before orders kept it (its checkout's).
// The third argument of the refunds is the Stripe idempotency key
// (refundKey).
export type RefundDeps = {
  refundPayment: typeof refundPayment
  refundInvoice: typeof refundInvoice
  cancelProNow: typeof cancelProNow
  paymentOf?: (order: GuideOrderDocument) => Promise<string | null>
}

// The idempotency key of one payment in one approval attempt: a retried
// network call refunds once, and a new attempt (Try again after a Stripe
// error, or finishing an approval that stopped halfway) is never answered
// with an earlier attempt's result (Stripe keeps a key's answer for 24
// hours, the errors it got as far as processing included) nor refused for
// sending other metadata under the same key. A second refund of the same
// payment is stopped by the purchase marked first and by Stripe's
// charge_already_refunded.
export const refundKey = (requestId: ObjectId, attempt: string, paymentId: string) => `avarobe_refund_${requestId.toString()}_${attempt}_${paymentId}`

// What every refund carries in Stripe, whichever way its money goes back
// (the purchase, the book order, the payment a deleted account's request
// kept).
export function refundMetadata(input: {
  requestId: ObjectId
  attempt: string
  product: string
  userId: ObjectId | null
  purchaseId: ObjectId | null
  guideOrderId: ObjectId | null
}): Record<string, string> {
  return {
    requestId: input.requestId.toString(),
    attempt: input.attempt,
    product: input.product,
    ...(input.userId ? { userId: input.userId.toString() } : {}),
    ...(input.purchaseId ? { purchaseId: input.purchaseId.toString() } : {}),
    ...(input.guideOrderId ? { guideOrderId: input.guideOrderId.toString() } : {}),
  }
}

type MarkedRefund = { refundedAt?: Date | null; refund?: { source: string; requestId?: ObjectId | null; stripeRefundId: string | null } | null }

// A purchase (or book order) this same request marked in an earlier
// approval that stopped halfway (a crash, a restart): 'refunded' when Stripe
// gave its refund id back, 'unsent' when it may never have been called (the
// next attempt calls it again; a refund made meanwhile answers
// charge_already_refunded). Null when it isn't this request's.
export function earlierAttempt(doc: MarkedRefund, requestId: ObjectId): 'refunded' | 'unsent' | null {
  if (!doc.refundedAt || doc.refund?.source !== 'admin' || !doc.refund.requestId?.equals(requestId)) {
    return null
  }

  return doc.refund.stripeRefundId ? 'refunded' : 'unsent'
}

// A book order from before orders kept their payment: its checkout's.
async function sessionPayment(order: GuideOrderDocument) {
  const session = await retrieveSession(order.sessionId)
  const payment = session.payment_intent
  return typeof payment === 'string' ? payment : (payment?.id ?? null)
}

export const STRIPE_REFUNDS: RefundDeps = { refundPayment, refundInvoice, cancelProNow, paymentOf: sessionPayment }

// The money back for one purchase: by its payment, or its invoice's.
async function refundMoney(
  purchase: Pick<PurchaseDocument, 'stripePaymentIntentId' | 'stripeSessionId'>,
  metadata: Record<string, string>,
  key: (paymentId: string) => string,
  deps: RefundDeps,
) {
  if (purchase.stripePaymentIntentId) {
    const paymentIntentId = purchase.stripePaymentIntentId
    return { refundId: await deps.refundPayment(paymentIntentId, metadata, key(paymentIntentId)), paymentIntentId }
  }

  return deps.refundInvoice(purchase.stripeSessionId, metadata, key(purchase.stripeSessionId))
}

// The report credit at work: a report refunded after it counted toward a Pro
// annual they keep (bought within the credit window after it). Pro itself
// unlocks the reports too, but it's what the credit paid for, not a report.
export async function creditUsed(app: FastifyInstance, purchase: Pick<PurchaseDocument, '_id' | 'userId' | 'product' | 'createdAt'>) {
  const unlocks = PRODUCTS[purchase.product as PurchaseProduct]?.unlocks

  if (isPro(purchase.product) || (!unlocks?.color && !unlocks?.style)) {
    return false
  }

  const annual = await app.collections.purchases.findOne(
    {
      userId: purchase.userId,
      _id: { $ne: purchase._id },
      product: 'pro_annual',
      refundedAt: null,
      createdAt: { $gte: purchase.createdAt, $lte: new Date(purchase.createdAt.getTime() + env.REPORT_CREDIT_WINDOW_DAYS * DAY_MS) },
    },
    { projection: { _id: 1 } },
  )

  return Boolean(annual)
}

// One payment a refund gives back (a request's cover, or a Pro charge made
// while it was under review).
export type CoverToRefund = Pick<
  RefundCover,
  'purchaseId' | 'guideOrderId' | 'product' | 'amount' | 'currency' | 'paidAt' | 'stripePaymentIntentId' | 'stripeInvoiceId'
>

export type CoverRefunded = { cover: CoverToRefund; stripeRefundId: string | null; amount: number; inStripe: boolean }
export type CoverFailed = { cover: CoverToRefund; error: string }

// An approved refund request, paid back: each payment in Stripe, then what
// it gave taken away. Each purchase (and book order) is marked first, so a
// second approval (or the refund webhook that follows) can't refund or
// revoke it twice; a Stripe error unmarks it. A purchase this same request
// marked in an approval that stopped halfway (earlierAttempt) is finished:
// refunded in Stripe if it never got its refund id (a refund made meanwhile
// counts), and taken back if it wasn't yet (`refund.revokedAt`). A deleted
// account's purchase is marked the same way, with nothing left to take
// away; one that's gone (deleted with its account, before they were kept in
// October 2026) is refunded by the payment the request kept. Stripe saying
// the charge was refunded already (in its dashboard) counts as refunded. No
// window here: the request was made within it, and the review can take
// days.
// `attempt`: this approval's own id, in each refund's idempotency key.
export async function refundCovers(
  app: FastifyInstance,
  input: {
    userId: ObjectId | null
    covers: CoverToRefund[]
    reason: RefundReason
    note: string | null
    requestId: ObjectId
    flags: RefundRequestFlag[]
    attempt: string
  },
  deps: RefundDeps = STRIPE_REFUNDS,
) {
  const refundedAt = new Date()
  // Every earlier refund counts: the instant ones, approved requests and
  // refunds made in Stripe (not this request's own, from an attempt that
  // stopped halfway).
  const priorRefunds = input.userId
    ? await app.collections.purchases.countDocuments({ userId: input.userId, refundedAt: { $ne: null }, 'refund.requestId': { $ne: input.requestId } })
    : 0
  const flags = [...new Set<RefundRequestFlag>([...input.flags, ...(priorRefunds > 0 ? (['repeat'] as const) : [])])]
  const refunded: CoverRefunded[] = []
  const skipped: CoverToRefund[] = []
  const failed: CoverFailed[] = []
  const revoke: PurchaseDocument[] = []
  const key = (paymentId: string) => refundKey(input.requestId, input.attempt, paymentId)

  for (const cover of input.covers) {
    const metadata = refundMetadata({
      requestId: input.requestId,
      attempt: input.attempt,
      product: cover.product,
      userId: input.userId,
      purchaseId: cover.purchaseId,
      guideOrderId: cover.guideOrderId,
    })
    const found = cover.purchaseId ? await app.collections.purchases.findOne({ _id: cover.purchaseId }) : null

    if (found) {
      const claimed = await app.collections.purchases.updateOne(
        { _id: found._id, refundedAt: null },
        {
          $set: {
            refundedAt,
            refund: {
              source: 'admin',
              requestId: input.requestId,
              reason: input.reason,
              note: input.note,
              amount: found.amountTotal,
              stripeRefundId: null,
              flags,
              priorRefunds,
            },
          },
        },
      )
      let purchase = found

      if (claimed.modifiedCount === 0) {
        // Marked already: by this request's approval that stopped halfway
        // (finished here), or refunded meanwhile in Stripe or by another
        // approval (nothing to do).
        const marked = await app.collections.purchases.findOne({ _id: found._id })
        const earlier = marked ? earlierAttempt(marked, input.requestId) : null

        if (!marked || !earlier) {
          skipped.push(cover)
          continue
        }

        purchase = marked

        if (earlier === 'refunded') {
          refunded.push({ cover, stripeRefundId: marked.refund?.stripeRefundId ?? null, amount: marked.amountTotal, inStripe: false })

          if (!marked.refund?.revokedAt) {
            revoke.push(marked)
          }

          continue
        }
      }

      const resumed = purchase !== found
      // The book bought signed in: its order loses its link with it.
      const order =
        purchase.product === 'outfit_guide'
          ? ((await app.collections.guideOrders.findOneAndUpdate(
              { sessionId: purchase.stripeSessionId, refundedAt: null },
              {
                $set: {
                  refundedAt,
                  refund: { source: 'admin', requestId: input.requestId, reason: input.reason, amount: purchase.amountTotal, stripeRefundId: null },
                },
              },
              { returnDocument: 'after' },
            )) ?? (resumed ? await app.collections.guideOrders.findOne({ sessionId: purchase.stripeSessionId, 'refund.requestId': input.requestId }) : null))
          : null

      try {
        const { refundId, paymentIntentId } = await refundMoney(purchase, metadata, key, deps)

        await app.collections.purchases.updateOne(
          { _id: purchase._id },
          { $set: { 'refund.stripeRefundId': refundId, ...(purchase.stripePaymentIntentId ? {} : { stripePaymentIntentId: paymentIntentId }) } },
        )

        if (order) {
          await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { 'refund.stripeRefundId': refundId } })
        }

        refunded.push({ cover, stripeRefundId: refundId, amount: purchase.amountTotal, inStripe: false })
      } catch (error) {
        if (!alreadyRefunded(error)) {
          await app.collections.purchases.updateOne({ _id: purchase._id }, { $set: { refundedAt: null, refund: null } })

          if (order) {
            await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { refundedAt: null, refund: null } })
          }

          app.log.error({ err: errorMessage(error), purchaseId: purchase._id.toString(), requestId: input.requestId.toString() }, 'Refund request: Stripe did not refund a payment')
          failed.push({ cover, error: errorMessage(error) })
          continue
        }

        refunded.push({ cover, stripeRefundId: null, amount: purchase.amountTotal, inStripe: true })
      }

      if (!purchase.refund?.revokedAt) {
        revoke.push({ ...purchase, refundedAt: purchase.refundedAt ?? refundedAt })
      }

      continue
    }

    if (cover.guideOrderId) {
      try {
        const done = await refundGuideCover(
          app,
          { orderId: cover.guideOrderId, reason: input.reason, requestId: input.requestId, attempt: input.attempt, userId: input.userId },
          deps,
        )

        if (done) {
          refunded.push({ cover, ...done })
        } else {
          skipped.push(cover)
        }
      } catch (error) {
        app.log.error({ err: errorMessage(error), guideOrderId: cover.guideOrderId.toString(), requestId: input.requestId.toString() }, 'Refund request: Stripe did not refund a book order')
        failed.push({ cover, error: errorMessage(error) })
      }

      continue
    }

    // The account was deleted with its purchases (before October 2026): the
    // payment the request kept, straight to Stripe (a refund made before, by
    // an attempt that stopped halfway or in the dashboard, answers
    // charge_already_refunded).
    try {
      const refundId = cover.stripePaymentIntentId
        ? await deps.refundPayment(cover.stripePaymentIntentId, metadata, key(cover.stripePaymentIntentId))
        : cover.stripeInvoiceId
          ? (await deps.refundInvoice(cover.stripeInvoiceId, metadata, key(cover.stripeInvoiceId))).refundId
          : null

      if (!refundId) {
        failed.push({ cover, error: 'This payment has nothing Stripe can refund it by.' })
        continue
      }

      refunded.push({ cover, stripeRefundId: refundId, amount: cover.amount, inStripe: false })
    } catch (error) {
      if (alreadyRefunded(error)) {
        refunded.push({ cover, stripeRefundId: null, amount: cover.amount, inStripe: true })
        continue
      }

      app.log.error({ err: errorMessage(error), requestId: input.requestId.toString() }, 'Refund request: Stripe did not refund a deleted account’s payment')
      failed.push({ cover, error: errorMessage(error) })
    }
  }

  // Pro ends with a Pro payment taken back now (not again when an attempt
  // that stopped halfway had taken it back already).
  if (input.userId && revoke.some((purchase) => isPro(purchase.product))) {
    await endPro(app, input.userId, deps)
  }

  for (const purchase of revoke) {
    await revokePurchase(app, purchase)
    await app.collections.purchases.updateOne({ _id: purchase._id }, { $set: { 'refund.revokedAt': new Date() } })
  }

  for (const item of refunded) {
    void trackServerEvent(app, {
      name: 'refund_completed',
      userId: input.userId,
      props: {
        product: item.cover.product,
        amount: item.amount,
        reason: input.reason,
        source: 'admin',
        requestId: input.requestId.toString(),
        hours: Math.round((refundedAt.getTime() - item.cover.paidAt.getTime()) / 3_600_000),
        priorRefunds,
        ...(item.inStripe ? { inStripe: true } : {}),
        ...(flags.length ? { flags: flags.join(',') } : {}),
      },
    })
  }

  return { refunded, skipped, failed, refundedAt }
}

// Pro refunded: the subscription ends now, in Stripe and here, with the
// first week's held looks (the looks it gave are taken back by
// revokePurchase). Admins' simulated plans never reach Stripe.
export async function endPro(app: FastifyInstance, userId: ObjectId, deps: Pick<RefundDeps, 'cancelProNow'>) {
  const user = await app.collections.users.findOne({ _id: userId }, { projection: { pro: 1 } })
  const subscriptionId = user?.pro?.subscriptionId

  if (subscriptionId && subscriptionId !== 'sim_admin') {
    try {
      await deps.cancelProNow(subscriptionId)
    } catch (error) {
      // The money is back already: Pro ends here regardless, and the founder
      // has to cancel it in Stripe before it renews.
      app.log.error({ err: error, userId: userId.toString(), subscriptionId }, 'Refunded Pro, but Stripe did not cancel the subscription: cancel it in Stripe')
    }
  }

  if (user?.pro) {
    const now = new Date()

    await app.collections.users.updateOne(
      { _id: userId },
      { $set: { 'pro.status': 'canceled', 'pro.periodEnd': now, 'pro.cancelAtPeriodEnd': false, updatedAt: now }, $unset: { 'pro.heldCredits': '' } },
    )
  }
}

type RefundedCharge = { payment_intent: string | { id: string } | null; refunded: boolean; amount_refunded: number }

// A full refund made in Stripe (charge.refunded): the purchase is marked and
// revoked the same way, and a guest's book order loses its link; an open
// refund request for it is closed as refunded (its customer told once).
// Ours arrive here too, already marked, and are skipped (their request is
// closed by the approval). A Pro payment recorded before purchases kept
// their payment is found by its invoice. Pro's latest payment refunded ends
// Pro as an approved refund does (a refunded year isn't a free one); an
// older one refunded leaves the current period alone.
export async function handleChargeRefunded(
  app: FastifyInstance,
  charge: RefundedCharge,
  findInvoice: (paymentIntentId: string) => Promise<string | null> = invoiceOfPayment,
  deps: Pick<RefundDeps, 'cancelProNow'> = STRIPE_REFUNDS,
) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id

  if (!paymentIntentId || !charge.refunded) {
    return
  }

  const refundedAt = new Date()

  const order = await app.collections.guideOrders.findOneAndUpdate(
    { paymentIntentId, refundedAt: null },
    { $set: { refundedAt, refund: { source: 'stripe', reason: null, amount: charge.amount_refunded, stripeRefundId: null } } },
    { returnDocument: 'after' },
  )

  let purchase = await app.collections.purchases.findOne({ stripePaymentIntentId: paymentIntentId, refundedAt: null })

  if (!purchase) {
    // The account is shared with Trimry: most charges here aren't ours.
    const invoiceId = await findInvoice(paymentIntentId).catch(() => null)
    purchase = invoiceId ? await app.collections.purchases.findOne({ stripeSessionId: invoiceId, refundedAt: null }) : null
  }

  if (!purchase) {
    // A guest's book, or the payment of an account deleted with its
    // purchases (before October 2026) and a request still open (the request
    // kept the payment).
    await closeRequestsOnStripeRefund(app, { paymentIntentId, guideOrderId: order?._id ?? null })
    return
  }

  const claimed = await app.collections.purchases.updateOne(
    { _id: purchase._id, refundedAt: null },
    {
      $set: {
        refundedAt,
        stripePaymentIntentId: paymentIntentId,
        refund: { source: 'stripe', reason: null, note: null, amount: charge.amount_refunded, stripeRefundId: null },
      },
    },
  )

  if (claimed.modifiedCount === 0) {
    return
  }

  if (isPro(purchase.product)) {
    const latest = await app.collections.purchases.findOne(
      { userId: purchase.userId, product: { $in: [...PRO_PRODUCTS] } },
      { sort: { createdAt: -1 }, projection: { _id: 1 } },
    )

    if (latest?._id.equals(purchase._id)) {
      app.log.warn({ userId: purchase.userId.toString(), purchaseId: purchase._id.toString() }, 'Pro refunded in Stripe: Pro ended and the subscription cancelled')
      await endPro(app, purchase.userId, deps)
    }
  }

  await revokePurchase(app, { ...purchase, refundedAt })
  void trackServerEvent(app, {
    name: 'refund_completed',
    userId: purchase.userId,
    props: { product: purchase.product, amount: charge.amount_refunded, reason: 'stripe', source: 'stripe' },
  })
  await closeRequestsOnStripeRefund(app, { paymentIntentId, purchaseId: purchase._id, guideOrderId: order?._id ?? null })
}

// A book order's money back, for an approved request (a guest's, or one
// whose account is gone): the order is marked first (its link stops), then
// refunded by its payment (or its checkout's, for orders from before they
// kept it). A signed-in buyer's purchase is marked too. An order this same
// request marked in an approval that stopped halfway is finished
// (earlierAttempt). Null when it was refunded meanwhile.
export async function refundGuideCover(
  app: FastifyInstance,
  input: { orderId: ObjectId; reason: RefundReason | null; requestId: ObjectId; attempt: string; userId?: ObjectId | null },
  deps: Pick<RefundDeps, 'refundPayment' | 'paymentOf'> = STRIPE_REFUNDS,
): Promise<{ stripeRefundId: string | null; amount: number; inStripe: boolean } | null> {
  const order = await app.collections.guideOrders.findOne({ _id: input.orderId })

  if (!order) {
    throw new Error('The book order is gone.')
  }

  const earlier = earlierAttempt(order, input.requestId)

  if (order.refundedAt && !earlier) {
    return null
  }

  if (earlier === 'refunded') {
    return { stripeRefundId: order.refund?.stripeRefundId ?? null, amount: order.amount, inStripe: false }
  }

  const paymentOf = deps.paymentOf ?? sessionPayment
  const paymentIntentId = order.paymentIntentId ?? (await paymentOf(order).catch(() => null))

  if (!paymentIntentId) {
    throw new Error('This book order has no payment Stripe can refund it by.')
  }

  const refundedAt = order.refundedAt ?? new Date()

  if (!earlier) {
    const claimed = await app.collections.guideOrders.updateOne(
      { _id: order._id, refundedAt: null },
      {
        $set: {
          refundedAt,
          paymentIntentId,
          refund: { source: 'admin', requestId: input.requestId, reason: input.reason, amount: order.amount, stripeRefundId: null },
        },
      },
    )

    if (claimed.modifiedCount === 0) {
      return null
    }
  }

  let stripeRefundId: string | null = null
  let inStripe = false
  const metadata = refundMetadata({
    requestId: input.requestId,
    attempt: input.attempt,
    product: 'outfit_guide',
    userId: input.userId ?? order.userId ?? null,
    purchaseId: null,
    guideOrderId: order._id,
  })

  try {
    stripeRefundId = await deps.refundPayment(paymentIntentId, metadata, refundKey(input.requestId, input.attempt, paymentIntentId))
  } catch (error) {
    if (!alreadyRefunded(error)) {
      await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { refundedAt: null, refund: null } })
      throw error
    }

    inStripe = true
  }

  await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { 'refund.stripeRefundId': stripeRefundId } })

  // Bought signed in: the purchase in their account is refunded with it.
  await app.collections.purchases.updateOne(
    { stripeSessionId: order.sessionId, refundedAt: null },
    {
      $set: {
        refundedAt,
        refund: { source: 'admin', requestId: input.requestId, reason: input.reason, note: null, amount: order.amount, stripeRefundId },
      },
    },
  )

  return { stripeRefundId, amount: order.amount, inStripe }
}

// Until when a refund of a book order can be asked for from its link (null:
// it can't). Brazil: calendar days.
export function guideRefundableUntil(order: Pick<GuideOrderDocument, 'amount' | 'createdAt' | 'refundedAt'>, now = Date.now(), brazil = false) {
  if (order.refundedAt || order.amount <= 0) {
    return null
  }

  const until = windowEnd(order.createdAt, brazil)
  return until.getTime() > now ? until : null
}

// The admin's Refunds tab, below the requests: every refund in the period
// (approved requests, the instant ones before Oct 12 and refunds made in
// Stripe), who asked and why, the flags, and the rate against the purchases
// it covers. Admins excluded.
export async function refundsReport(app: FastifyInstance, days: number) {
  const since = new Date(Date.now() - days * DAY_MS)
  const admins = await adminUserIds(app)
  const [refunded, covered] = await Promise.all([
    app.collections.purchases
      .find({ refundedAt: { $gte: since }, userId: { $nin: admins } })
      .sort({ refundedAt: -1 })
      .limit(500)
      .toArray(),
    app.collections.purchases.countDocuments({
      createdAt: { $gte: since },
      userId: { $nin: admins },
      amountTotal: { $gt: 0 },
      product: { $in: [...REFUNDABLE] },
    }),
  ])
  const users = await app.collections.users
    .find({ _id: { $in: refunded.map((purchase) => purchase.userId) } }, { projection: { email: 1, createdAt: 1 } })
    .toArray()
  const emails = new Map(users.map((user) => [user._id.toString(), user.email]))
  const requestIds = refunded.map((purchase) => purchase.refund?.requestId).filter((id): id is ObjectId => Boolean(id))
  const requests = requestIds.length
    ? await app.collections.refundRequests.find({ _id: { $in: requestIds } }, { projection: { ref: 1 } }).toArray()
    : []
  const refs = new Map(requests.map((request) => [request._id.toString(), request.ref]))
  const byReason: Record<string, number> = {}

  for (const purchase of refunded) {
    const key = purchase.refund?.reason ?? purchase.refund?.source ?? 'unknown'
    byReason[key] = (byReason[key] ?? 0) + 1
  }

  return {
    days,
    purchases: covered,
    refunds: refunded.length,
    // In rough US cents, so refunds in reais or pesos add up.
    refundedAmount: refunded.reduce((sum, purchase) => sum + toUsdCents(purchase.refund?.amount ?? purchase.amountTotal, purchase.currency), 0),
    byReason,
    rows: refunded.map((purchase) => ({
      id: purchase._id.toString(),
      userId: purchase.userId.toString(),
      email: emails.get(purchase.userId.toString()) ?? null,
      // The account was deleted since (its purchases are kept, anonymized).
      accountDeleted: !emails.has(purchase.userId.toString()),
      product: purchase.product,
      amount: purchase.refund?.amount ?? purchase.amountTotal,
      currency: purchase.currency,
      purchasedAt: purchase.createdAt.toISOString(),
      refundedAt: (purchase.refundedAt as Date).toISOString(),
      hoursAfter: Math.round(((purchase.refundedAt as Date).getTime() - purchase.createdAt.getTime()) / 3_600_000),
      // 'admin' (an approved request, `requestRef`), 'app' (instant, before
      // Oct 12, 2026) or 'stripe'.
      source: purchase.refund?.source ?? 'unknown',
      requestRef: purchase.refund?.requestId ? (refs.get(purchase.refund.requestId.toString()) ?? null) : null,
      reason: purchase.refund?.reason ?? null,
      note: purchase.refund?.note ?? null,
      // For review: 'repeat' (refunds before this one), 'credit_used', and an
      // approved request's own flags.
      flag: purchase.refund?.flags?.[0] ?? null,
      flags: purchase.refund?.flags ?? [],
      priorRefunds: purchase.refund?.priorRefunds ?? 0,
    })),
  }
}
