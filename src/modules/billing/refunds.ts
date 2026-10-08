import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { PurchaseDocument, PurchaseProduct, RefundReason, UserDocument } from '../../types/mongo.js'
import { currentLocale } from '../../utils/request-locale.js'
import { trackServerEvent } from '../analytics/service.js'
import { adminUserIds } from './entitlements.js'
import { toUsdCents } from './pricing.js'
import { PRODUCTS, productCopy, refundPayment } from './stripe.js'

// The 7-day money-back guarantee on one-time purchases: asked for in the
// account page (not on the offer), once per person, and paid back in full
// through Stripe. What the purchase unlocked goes away with it. Pro is
// cancelled instead; look packs (spent credits) and the guide aren't covered.
export const REFUND_WINDOW_DAYS = 7
export const REFUND_REASONS: RefundReason[] = ['not_accurate', 'not_expected', 'technical', 'mistake', 'other']

const DAY_MS = 24 * 60 * 60 * 1000

const REFUNDABLE = new Set<PurchaseProduct>([
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
])

export class RefundError extends Error {}

type RefundablePurchase = Pick<PurchaseDocument, 'product' | 'amountTotal' | 'stripePaymentIntentId' | 'createdAt' | 'refundedAt'>

// Until when this purchase can still be refunded in the app (null: it can't).
export function refundableUntil(purchase: RefundablePurchase, now = Date.now()) {
  if (
    !REFUNDABLE.has(purchase.product as PurchaseProduct) ||
    purchase.refundedAt ||
    purchase.amountTotal <= 0 ||
    !purchase.stripePaymentIntentId
  ) {
    return null
  }

  const until = new Date(purchase.createdAt.getTime() + REFUND_WINDOW_DAYS * DAY_MS)
  return until.getTime() > now ? until : null
}

// Their paid purchases, newest first, with whether each can be refunded.
// After one refund in the app, the next ones go through support.
export async function purchasesFor(app: FastifyInstance, userId: ObjectId) {
  const purchases = await app.collections.purchases
    .find({ userId, amountTotal: { $gt: 0 } })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray()
  const usedGuarantee = purchases.some((purchase) => purchase.refund?.source === 'app')
  // Named in the language of the page asking.
  const locale = currentLocale()

  return purchases.map((purchase) => {
    const until = usedGuarantee ? null : refundableUntil(purchase)

    return {
      id: purchase._id.toString(),
      product: purchase.product,
      name: purchase.product in PRODUCTS ? productCopy(purchase.product as PurchaseProduct, locale).name : purchase.product,
      amount: purchase.amountTotal,
      currency: purchase.currency,
      createdAt: purchase.createdAt.toISOString(),
      refundedAt: purchase.refundedAt?.toISOString() ?? null,
      refundableUntil: until?.toISOString() ?? null,
    }
  })
}

// What a purchase gave, taken back: the advisors it unlocked (unless another
// purchase that's kept unlocks them too), its credits, passes and magazines
// (as far as they're left), and the "paid" mark if nothing paid is left.
export async function revokePurchase(app: FastifyInstance, purchase: PurchaseDocument) {
  const [user, kept] = await Promise.all([
    app.collections.users.findOne({ _id: purchase.userId }),
    app.collections.purchases
      .find({ userId: purchase.userId, _id: { $ne: purchase._id }, refundedAt: null, amountTotal: { $gt: 0 } })
      .toArray(),
  ])

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

// The guarantee, asked for in the app: refunds in Stripe, then takes back
// what it unlocked. The purchase is marked first, so a double tap (or the
// refund webhook that follows) can't refund or revoke it twice.
export async function requestRefund(
  app: FastifyInstance,
  input: { userId: ObjectId; purchaseId: ObjectId; reason: RefundReason; note: string | null },
) {
  const purchase = await app.collections.purchases.findOne({ _id: input.purchaseId, userId: input.userId })

  if (!purchase || !refundableUntil(purchase)) {
    throw new RefundError('This purchase can no longer be refunded here. Write to us at hello@avarobe.com.')
  }

  const usedGuarantee = await app.collections.purchases.findOne(
    { userId: input.userId, 'refund.source': 'app' },
    { projection: { _id: 1 } },
  )

  if (usedGuarantee) {
    throw new RefundError('You already used your money-back guarantee. Write to us at hello@avarobe.com.')
  }

  const refundedAt = new Date()
  const claimed = await app.collections.purchases.updateOne(
    { _id: purchase._id, refundedAt: null },
    {
      $set: {
        refundedAt,
        refund: { source: 'app', reason: input.reason, note: input.note, amount: purchase.amountTotal, stripeRefundId: null },
      },
    },
  )

  if (claimed.modifiedCount === 0) {
    throw new RefundError('This purchase was already refunded.')
  }

  let stripeRefundId: string

  try {
    stripeRefundId = await refundPayment(purchase.stripePaymentIntentId as string, {
      userId: input.userId.toString(),
      purchaseId: purchase._id.toString(),
      product: purchase.product,
    })
  } catch (error) {
    await app.collections.purchases.updateOne({ _id: purchase._id }, { $set: { refundedAt: null, refund: null } })
    throw error
  }

  await app.collections.purchases.updateOne({ _id: purchase._id }, { $set: { 'refund.stripeRefundId': stripeRefundId } })
  await revokePurchase(app, { ...purchase, refundedAt })

  void trackServerEvent(app, {
    name: 'refund_completed',
    userId: input.userId,
    props: {
      product: purchase.product,
      amount: purchase.amountTotal,
      reason: input.reason,
      source: 'app',
      hours: Math.round((refundedAt.getTime() - purchase.createdAt.getTime()) / 3_600_000),
    },
  })
}

// A full refund made in Stripe (charge.refunded): the purchase is marked and
// revoked the same way. Ours arrive here too, already marked, and are skipped.
export async function handleChargeRefunded(
  app: FastifyInstance,
  charge: { payment_intent: string | { id: string } | null; refunded: boolean; amount_refunded: number },
) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id

  if (!paymentIntentId || !charge.refunded) {
    return
  }

  const purchase = await app.collections.purchases.findOne({ stripePaymentIntentId: paymentIntentId, refundedAt: null })

  if (!purchase) {
    return
  }

  const refundedAt = new Date()
  const claimed = await app.collections.purchases.updateOne(
    { _id: purchase._id, refundedAt: null },
    { $set: { refundedAt, refund: { source: 'stripe', reason: null, note: null, amount: charge.amount_refunded, stripeRefundId: null } } },
  )

  if (claimed.modifiedCount === 0) {
    return
  }

  await revokePurchase(app, { ...purchase, refundedAt })
  void trackServerEvent(app, {
    name: 'refund_completed',
    userId: purchase.userId,
    props: { product: purchase.product, amount: charge.amount_refunded, reason: 'stripe', source: 'stripe' },
  })
}

// The admin's Refunds tab: every refund in the period, who asked and why,
// and the rate against the one-time purchases it covers. Admins excluded.
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
      product: purchase.product,
      amount: purchase.refund?.amount ?? purchase.amountTotal,
      currency: purchase.currency,
      purchasedAt: purchase.createdAt.toISOString(),
      refundedAt: (purchase.refundedAt as Date).toISOString(),
      hoursAfter: Math.round(((purchase.refundedAt as Date).getTime() - purchase.createdAt.getTime()) / 3_600_000),
      source: purchase.refund?.source ?? 'unknown',
      reason: purchase.refund?.reason ?? null,
      note: purchase.refund?.note ?? null,
    })),
  }
}
