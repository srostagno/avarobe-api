import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { GuideOrderDocument, PurchaseDocument, PurchaseProduct, RefundFlag, RefundReason, UserDocument } from '../../types/mongo.js'
import { currentLocale } from '../../utils/request-locale.js'
import { trackServerEvent } from '../analytics/service.js'
import { adminUserIds } from './entitlements.js'
import { toUsdCents } from './pricing.js'
import { PRODUCTS, cancelProNow, invoiceOfPayment, productCopy, refundInvoice, refundPayment, retrieveSession } from './stripe.js'

// The 7-day refund (Oct 2026), asked for in the account page (not on the
// offer) and paid back in full through Stripe: every purchase, within 7 days
// of paying, however much was used and as often as they ask (Brazil's right
// of withdrawal, CDC art. 49, has no conditions). Pro's first payment is
// covered, never a renewal; refunding it ends Pro at once. What a purchase
// gave goes away with it. Repeat refunds are flagged for the admin, never
// refused. A guest's Outfit Formula Book refunds from its own link.
export const REFUND_WINDOW_DAYS = 7
export const REFUND_REASONS: RefundReason[] = ['not_accurate', 'not_expected', 'technical', 'mistake', 'other']

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = REFUND_WINDOW_DAYS * DAY_MS

const PRO_PRODUCTS = new Set<PurchaseProduct>(['pro_monthly', 'pro_annual', 'pro_trial'])

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
  'look_pack',
  'outfit_guide',
  ...PRO_PRODUCTS,
])

const isPro = (product: string) => PRO_PRODUCTS.has(product as PurchaseProduct)

export class RefundError extends Error {}

type RefundablePurchase = Pick<PurchaseDocument, 'product' | 'amountTotal' | 'stripePaymentIntentId' | 'stripeSessionId' | 'createdAt' | 'refundedAt'>

// How the money goes back: its payment, or (Pro payments recorded before
// purchases kept it) its invoice's.
const refundable = (purchase: RefundablePurchase) =>
  Boolean(purchase.stripePaymentIntentId) || (isPro(purchase.product) && purchase.stripeSessionId.startsWith('in_'))

// Until when this purchase can still be refunded in the app (null: it
// can't). Pro: only payments in the first 7 days of their first Pro
// (`firstProAt`, their earliest Pro purchase), never a renewal.
export function refundableUntil(purchase: RefundablePurchase, context: { firstProAt?: Date | null } = {}, now = Date.now()) {
  if (!REFUNDABLE.has(purchase.product as PurchaseProduct) || purchase.refundedAt || purchase.amountTotal <= 0 || !refundable(purchase)) {
    return null
  }

  if (isPro(purchase.product)) {
    const first = context.firstProAt ?? purchase.createdAt

    if (purchase.createdAt.getTime() >= first.getTime() + WINDOW_MS) {
      return null
    }
  }

  const until = new Date(purchase.createdAt.getTime() + WINDOW_MS)
  return until.getTime() > now ? until : null
}

async function firstProAt(app: FastifyInstance, userId: ObjectId) {
  const first = await app.collections.purchases.findOne(
    { userId, product: { $in: [...PRO_PRODUCTS] } },
    { sort: { createdAt: 1 }, projection: { createdAt: 1 } },
  )

  return first?.createdAt ?? null
}

// Their paid purchases, newest first, with whether each can be refunded.
export async function purchasesFor(app: FastifyInstance, userId: ObjectId) {
  const [purchases, firstPro] = await Promise.all([
    app.collections.purchases.find({ userId, amountTotal: { $gt: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
    firstProAt(app, userId),
  ])
  // Named in the language of the page asking.
  const locale = currentLocale()

  return purchases.map((purchase) => {
    const until = refundableUntil(purchase, { firstProAt: firstPro })

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

// What refunds go through, so tests can stand in for Stripe.
export type RefundDeps = {
  refundPayment: typeof refundPayment
  refundInvoice: typeof refundInvoice
  cancelProNow: typeof cancelProNow
}

const STRIPE: RefundDeps = { refundPayment, refundInvoice, cancelProNow }

// A book order from before orders kept their payment: its checkout's.
async function sessionPayment(order: GuideOrderDocument) {
  const session = await retrieveSession(order.sessionId)
  const payment = session.payment_intent
  return typeof payment === 'string' ? payment : (payment?.id ?? null)
}

// The money back for one purchase: by its payment, or its invoice's.
async function refundMoney(purchase: PurchaseDocument, metadata: Record<string, string>, deps: RefundDeps) {
  if (purchase.stripePaymentIntentId) {
    return { refundId: await deps.refundPayment(purchase.stripePaymentIntentId, metadata), paymentIntentId: purchase.stripePaymentIntentId }
  }

  return deps.refundInvoice(purchase.stripeSessionId, metadata)
}

// The report credit at work: a report refunded after it counted toward a Pro
// annual they keep (bought within the credit window after it).
async function creditUsed(app: FastifyInstance, purchase: PurchaseDocument) {
  const unlocks = PRODUCTS[purchase.product as PurchaseProduct]?.unlocks

  if (!unlocks?.color && !unlocks?.style) {
    return false
  }

  const annual = await app.collections.purchases.findOne(
    {
      userId: purchase.userId,
      product: 'pro_annual',
      refundedAt: null,
      createdAt: { $gte: purchase.createdAt, $lte: new Date(purchase.createdAt.getTime() + env.REPORT_CREDIT_WINDOW_DAYS * DAY_MS) },
    },
    { projection: { _id: 1 } },
  )

  return Boolean(annual)
}

// The refund, asked for in the app: refunds in Stripe, then takes back what
// it gave. Each purchase is marked first, so a double tap (or the refund
// webhook that follows) can't refund or revoke it twice. Refunding Pro's
// first payment refunds every Pro payment of that first week (a switch to
// annual within it, say) and ends the subscription at once.
export async function requestRefund(
  app: FastifyInstance,
  input: { userId: ObjectId; purchaseId: ObjectId; reason: RefundReason; note: string | null },
  deps: RefundDeps = STRIPE,
) {
  const [purchase, firstPro] = await Promise.all([
    app.collections.purchases.findOne({ _id: input.purchaseId, userId: input.userId }),
    firstProAt(app, input.userId),
  ])

  if (!purchase || !refundableUntil(purchase, { firstProAt: firstPro })) {
    throw new RefundError('This purchase can no longer be refunded here. Write to us at hello@avarobe.com.')
  }

  const pro = isPro(purchase.product)
  const [priorRefunds, credit, sameWeek] = await Promise.all([
    app.collections.purchases.countDocuments({ userId: input.userId, 'refund.source': 'app' }),
    creditUsed(app, purchase),
    pro && firstPro
      ? app.collections.purchases
          .find({
            userId: input.userId,
            _id: { $ne: purchase._id },
            product: { $in: [...PRO_PRODUCTS] },
            refundedAt: null,
            amountTotal: { $gt: 0 },
            createdAt: { $lt: new Date(firstPro.getTime() + WINDOW_MS) },
          })
          .toArray()
      : Promise.resolve([] as PurchaseDocument[]),
  ])
  const flags: RefundFlag[] = [...(priorRefunds > 0 ? ['repeat' as const] : []), ...(credit ? ['credit_used' as const] : [])]
  const targets = [purchase, ...sameWeek.filter((other) => refundableUntil(other, { firstProAt: firstPro }))]
  const refundedAt = new Date()
  const done: PurchaseDocument[] = []

  for (const target of targets) {
    const claimed = await app.collections.purchases.updateOne(
      { _id: target._id, refundedAt: null },
      {
        $set: {
          refundedAt,
          refund: { source: 'app', reason: input.reason, note: input.note, amount: target.amountTotal, stripeRefundId: null, flags, priorRefunds },
        },
      },
    )

    if (claimed.modifiedCount === 0) {
      if (target === purchase) {
        throw new RefundError('This purchase was already refunded.')
      }

      continue
    }

    try {
      const { refundId, paymentIntentId } = await refundMoney(
        target,
        { userId: input.userId.toString(), purchaseId: target._id.toString(), product: target.product },
        deps,
      )

      await app.collections.purchases.updateOne(
        { _id: target._id },
        { $set: { 'refund.stripeRefundId': refundId, ...(target.stripePaymentIntentId ? {} : { stripePaymentIntentId: paymentIntentId }) } },
      )
    } catch (error) {
      await app.collections.purchases.updateOne({ _id: target._id }, { $set: { refundedAt: null, refund: null } })

      // Nothing went back yet: the refund fails as a whole. Otherwise what
      // went back is kept and revoked below; the rest can be asked again.
      if (done.length === 0) {
        throw error
      }

      app.log.error({ err: error, purchaseId: target._id.toString() }, 'One payment of a Pro refund did not go back')
      continue
    }

    done.push({ ...target, refundedAt })
  }

  if (pro) {
    await endPro(app, input.userId, deps)
  }

  for (const target of done) {
    await revokePurchase(app, target)
  }

  for (const target of done) {
    void trackServerEvent(app, {
      name: 'refund_completed',
      userId: input.userId,
      props: {
        product: target.product,
        amount: target.amountTotal,
        reason: input.reason,
        source: 'app',
        hours: Math.round((refundedAt.getTime() - target.createdAt.getTime()) / 3_600_000),
        priorRefunds,
        ...(flags.length ? { flags: flags.join(',') } : {}),
      },
    })
  }
}

// Pro refunded: the subscription ends now, in Stripe and here, with the
// first week's held looks (the looks it gave are taken back by
// revokePurchase). Admins' simulated plans never reach Stripe.
async function endPro(app: FastifyInstance, userId: ObjectId, deps: RefundDeps) {
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
// revoked the same way, and a guest's book order loses its link. Ours arrive
// here too, already marked, and are skipped. A Pro payment recorded before
// purchases kept their payment is found by its invoice.
export async function handleChargeRefunded(app: FastifyInstance, charge: RefundedCharge, findInvoice: (paymentIntentId: string) => Promise<string | null> = invoiceOfPayment) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id

  if (!paymentIntentId || !charge.refunded) {
    return
  }

  const refundedAt = new Date()

  await app.collections.guideOrders.updateOne(
    { paymentIntentId, refundedAt: null },
    { $set: { refundedAt, refund: { source: 'stripe', reason: null, amount: charge.amount_refunded, stripeRefundId: null } } },
  )

  let purchase = await app.collections.purchases.findOne({ stripePaymentIntentId: paymentIntentId, refundedAt: null })

  if (!purchase) {
    // The account is shared with Trimry: most charges here aren't ours.
    const invoiceId = await findInvoice(paymentIntentId).catch(() => null)
    purchase = invoiceId ? await app.collections.purchases.findOne({ stripeSessionId: invoiceId, refundedAt: null }) : null
  }

  if (!purchase) {
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

  await revokePurchase(app, { ...purchase, refundedAt })
  void trackServerEvent(app, {
    name: 'refund_completed',
    userId: purchase.userId,
    props: { product: purchase.product, amount: charge.amount_refunded, reason: 'stripe', source: 'stripe' },
  })
}

// A guest's Outfit Formula Book, refunded from the link in its email (its
// download token): within 7 days, once. A signed-in buyer's purchase is
// marked too. The link stops working.
export async function refundGuideOrder(
  app: FastifyInstance,
  input: { token: string; reason: RefundReason | null },
  deps: Pick<RefundDeps, 'refundPayment'> & { paymentOf: (order: GuideOrderDocument) => Promise<string | null> } = {
    refundPayment,
    paymentOf: sessionPayment,
  },
) {
  const order = await app.collections.guideOrders.findOne({ token: input.token })

  if (!order || !guideRefundableUntil(order)) {
    throw new RefundError('This order can no longer be refunded here. Write to us at hello@avarobe.com.')
  }

  const paymentIntentId = order.paymentIntentId ?? (await deps.paymentOf(order).catch(() => null))

  if (!paymentIntentId) {
    throw new RefundError('This order can no longer be refunded here. Write to us at hello@avarobe.com.')
  }

  const refundedAt = new Date()
  const claimed = await app.collections.guideOrders.updateOne(
    { _id: order._id, refundedAt: null },
    { $set: { refundedAt, paymentIntentId, refund: { source: 'app', reason: input.reason, amount: order.amount, stripeRefundId: null } } },
  )

  if (claimed.modifiedCount === 0) {
    throw new RefundError('This order was already refunded.')
  }

  let stripeRefundId: string

  try {
    stripeRefundId = await deps.refundPayment(paymentIntentId, { guideOrderId: order._id.toString(), product: 'outfit_guide' })
  } catch (error) {
    await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { refundedAt: null, refund: null } })
    throw error
  }

  await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { 'refund.stripeRefundId': stripeRefundId } })

  // Bought signed in: the purchase in their account is refunded with it.
  await app.collections.purchases.updateOne(
    { stripeSessionId: order.sessionId, refundedAt: null },
    {
      $set: {
        refundedAt,
        refund: { source: 'app', reason: input.reason, note: null, amount: order.amount, stripeRefundId },
      },
    },
  )

  void trackServerEvent(app, {
    name: 'refund_completed',
    userId: order.userId,
    props: {
      product: 'outfit_guide',
      amount: order.amount,
      reason: input.reason ?? 'unknown',
      source: 'guide_link',
      hours: Math.round((refundedAt.getTime() - order.createdAt.getTime()) / 3_600_000),
    },
  })

  return { amount: order.amount, currency: order.currency }
}

// Until when a book order can be refunded from its link (null: it can't).
export function guideRefundableUntil(order: Pick<GuideOrderDocument, 'amount' | 'createdAt' | 'refundedAt'>, now = Date.now()) {
  if (order.refundedAt || order.amount <= 0) {
    return null
  }

  const until = new Date(order.createdAt.getTime() + WINDOW_MS)
  return until.getTime() > now ? until : null
}

// The admin's Refunds tab: every refund in the period, who asked and why,
// flagged repeats and used credits, and the rate against the purchases it
// covers. Admins excluded.
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
      // For review: 'repeat' (refunds before this one) or 'credit_used'.
      flag: purchase.refund?.flags?.[0] ?? null,
      flags: purchase.refund?.flags ?? [],
      priorRefunds: purchase.refund?.priorRefunds ?? 0,
    })),
  }
}
