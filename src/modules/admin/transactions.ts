import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { AnalyticsEventDocument, UserDocument } from '../../types/mongo.js'
import { isGuestEmail } from '../../utils/guests.js'
import { adminUserIds } from '../billing/entitlements.js'
import { toUsdCents } from '../billing/pricing.js'
import { addDays, pacificDay, pacificStart } from './email-activity.js'

// Admin → Transactions: every payment between two Pacific days (both
// included), like the rest of the admin: one-time purchases, Pro payments
// and the book, with who paid (account, email, country, where they came
// from), what they tapped to pay and on what, and how long after signing up.
// Plus the totals, the splits that matter and the revenue per day. Admins'
// own purchases are left out. Amounts are kept in their currency and in
// rough US cents (billing/pricing.ts) so they add up.

const MAX_ROWS = 1000
// How far back a checkout event can be and still be the one that paid.
const CHECKOUT_WINDOW_MS = 6 * 60 * 60 * 1000

export type Payment = {
  id: string
  userId: ObjectId | null
  product: string
  amount: number
  currency: string
  usd: number
  at: Date
  refundedAt: Date | null
  refundSource: 'app' | 'stripe' | null
  guestEmail: string | null
}

export type TransactionRow = {
  id: string
  at: Date
  product: string
  amount: number
  currency: string
  usd: number
  refunded: boolean
  refundSource: 'app' | 'stripe' | null
  account: string | null
  email: string | null
  country: string | null
  region: string | null
  locale: string | null
  channel: string | null
  campaign: string | null
  content: string | null
  signedUpAt: Date | null
  minutesToBuy: number | null
  // Their nth payment ever, and everything they've paid (rough US cents).
  order: number
  buyerTotalUsd: number
  // The button they paid from (checkout_started's placement), how checkout
  // opened (Stripe's page or the embedded form) and on what.
  placement: string | null
  ui: string | null
  mobile: boolean | null
  inApp: boolean | null
  season: string | null
}

type Split = { key: string; count: number; usd: number }

function split(rows: TransactionRow[], keyOf: (row: TransactionRow) => string | null): Split[] {
  const byKey = new Map<string, Split>()

  for (const row of rows) {
    if (row.refunded) {
      continue
    }

    const key = keyOf(row) ?? 'unknown'
    const entry = byKey.get(key) ?? { key, count: 0, usd: 0 }
    entry.count += 1
    entry.usd += row.usd
    byKey.set(key, entry)
  }

  return [...byKey.values()].sort((a, b) => b.usd - a.usd || b.count - a.count)
}

export function defaultRange(now = new Date()) {
  const to = pacificDay(now)
  return { from: addDays(to, -29), to }
}

async function paymentsBetween(app: FastifyInstance, since: Date, until: Date, admins: ObjectId[]): Promise<Payment[]> {
  const [purchases, guides] = await Promise.all([
    app.collections.purchases
      .find({ createdAt: { $gte: since, $lt: until }, amountTotal: { $gt: 0 }, userId: { $nin: admins } })
      .sort({ createdAt: -1 })
      .limit(MAX_ROWS)
      .toArray(),
    app.collections.guideOrders
      .find({ createdAt: { $gte: since, $lt: until }, amount: { $gt: 0 }, userId: { $nin: admins } })
      .sort({ createdAt: -1 })
      .limit(MAX_ROWS)
      .toArray(),
  ])

  return [
    ...purchases.map((purchase) => ({
      id: purchase._id.toString(),
      userId: purchase.userId,
      product: purchase.product,
      amount: purchase.amountTotal,
      currency: purchase.currency,
      usd: purchase.amountUsd ?? toUsdCents(purchase.amountTotal, purchase.currency),
      at: purchase.createdAt,
      refundedAt: purchase.refundedAt ?? null,
      refundSource: purchase.refund?.source ?? null,
      guestEmail: null,
    })),
    ...guides.map((order) => ({
      id: order._id.toString(),
      userId: order.userId,
      product: 'outfit_guide',
      amount: order.amount,
      currency: order.currency,
      usd: toUsdCents(order.amount, order.currency),
      at: order.createdAt,
      refundedAt: null,
      refundSource: null,
      // Bought without an account: the email on the order.
      guestEmail: order.userId ? null : order.email,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_ROWS)
}

export async function transactionsReport(app: FastifyInstance, range: { from: string; to: string }) {
  const since = pacificStart(range.from)
  const until = pacificStart(addDays(range.to, 1))
  const admins = await adminUserIds(app)
  const payments = await paymentsBetween(app, since, until, admins)
  const userIds = [...new Map(payments.filter((p) => p.userId).map((p) => [p.userId!.toString(), p.userId!])).values()]

  const [users, history, guideHistory, checkouts, avatars] = await Promise.all([
    app.collections.users
      .find(
        { _id: { $in: userIds } },
        { projection: { email: 1, guest: 1, createdAt: 1, location: 1, locale: 1, acquisition: 1 } },
      )
      .toArray(),
    // Everything these buyers ever paid, to number each payment.
    app.collections.purchases
      .find({ userId: { $in: userIds }, amountTotal: { $gt: 0 } }, { projection: { userId: 1, createdAt: 1, amountTotal: 1, amountUsd: 1, currency: 1, refundedAt: 1 } })
      .toArray(),
    app.collections.guideOrders
      .find({ userId: { $in: userIds }, amount: { $gt: 0 } }, { projection: { userId: 1, createdAt: 1, amount: 1, currency: 1 } })
      .toArray(),
    app.collections.analyticsEvents
      .find(
        {
          userId: { $in: userIds },
          // Page views say what they were on (checkout events don't).
          name: { $in: ['checkout_started', 'checkout_created', 'page_view'] },
          at: { $gte: new Date(since.getTime() - CHECKOUT_WINDOW_MS), $lt: until },
        },
        { projection: { userId: 1, name: 1, at: 1, props: 1, mobile: 1, inApp: 1 } },
      )
      .sort({ at: 1 })
      .toArray(),
    app.collections.avatars.find({ userId: { $in: userIds } }, { projection: { userId: 1, 'colorAnalysis.season': 1 } }).toArray(),
  ])

  return buildTransactions({
    range,
    truncated: payments.length >= MAX_ROWS,
    payments,
    users,
    paid: [
      ...history.map((purchase) => ({
        userId: purchase.userId,
        at: purchase.createdAt,
        usd: purchase.amountUsd ?? toUsdCents(purchase.amountTotal, purchase.currency),
        refunded: Boolean(purchase.refundedAt),
      })),
      ...guideHistory.flatMap((order) =>
        order.userId ? [{ userId: order.userId, at: order.createdAt, usd: toUsdCents(order.amount, order.currency), refunded: false }] : [],
      ),
    ],
    checkouts,
    seasons: avatars.map((avatar) => ({ userId: avatar.userId, season: avatar.colorAnalysis?.season ?? null })),
  })
}

type Buyer = Pick<UserDocument, '_id' | 'email' | 'createdAt' | 'location' | 'locale' | 'acquisition'>
type CheckoutEvent = Pick<AnalyticsEventDocument, 'userId' | 'name' | 'at' | 'props' | 'mobile' | 'inApp'>

// The report from what was read: each payment with its buyer's details,
// the totals, the splits and the days.
export function buildTransactions(input: {
  range: { from: string; to: string }
  truncated: boolean
  payments: Payment[]
  users: Buyer[]
  // Every payment these buyers ever made (to number them).
  paid: { userId: ObjectId; at: Date; usd: number; refunded: boolean }[]
  checkouts: CheckoutEvent[]
  seasons: { userId: ObjectId; season: string | null }[]
}) {
  const { range, payments, users, checkouts } = input
  const userById = new Map(users.map((user) => [user._id.toString(), user]))
  const seasonByUser = new Map(input.seasons.map((entry) => [entry.userId.toString(), entry.season]))
  const paidAtByUser = new Map<string, { at: Date; usd: number; refunded: boolean }[]>()

  for (const entry of input.paid) {
    const list = paidAtByUser.get(entry.userId.toString()) ?? []
    list.push(entry)
    paidAtByUser.set(entry.userId.toString(), list)
  }

  const checkoutsByUser = new Map<string, typeof checkouts>()

  for (const event of [...checkouts].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (!event.userId) {
      continue
    }

    const list = checkoutsByUser.get(event.userId.toString()) ?? []
    list.push(event)
    checkoutsByUser.set(event.userId.toString(), list)
  }

  const rows: TransactionRow[] = payments.map((payment) => {
    const key = payment.userId?.toString() ?? null
    const user = key ? userById.get(key) : undefined
    const paid = key ? (paidAtByUser.get(key) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime()) : []
    const order = paid.filter((entry) => entry.at.getTime() <= payment.at.getTime()).length || 1
    // The last checkout for this product before it was paid.
    const events = (key ? (checkoutsByUser.get(key) ?? []) : []).filter(
      (event) =>
        event.at.getTime() <= payment.at.getTime() + 60_000 &&
        event.at.getTime() >= payment.at.getTime() - CHECKOUT_WINDOW_MS &&
        event.name !== 'page_view' &&
        (event.props?.product === payment.product || payment.product === 'outfit_guide'),
    )
    const started = events.filter((event) => event.name === 'checkout_started').at(-1)
    const created = events.filter((event) => event.name === 'checkout_created').at(-1)
    // What they were on: the last event before paying that says.
    const seen = (key ? (checkoutsByUser.get(key) ?? []) : [])
      .filter(
        (event) =>
          event.mobile !== null &&
          event.at.getTime() <= payment.at.getTime() + 60_000 &&
          event.at.getTime() >= payment.at.getTime() - CHECKOUT_WINDOW_MS,
      )
      .at(-1)
    const email = user?.email ?? payment.guestEmail

    return {
      id: payment.id,
      at: payment.at,
      product: payment.product,
      amount: payment.amount,
      currency: payment.currency,
      usd: payment.usd,
      refunded: Boolean(payment.refundedAt),
      refundSource: payment.refundSource,
      account: key ? key.slice(-6) : null,
      email: email && !isGuestEmail(email) ? email : null,
      country: user?.location?.country ?? null,
      region: user?.location?.region ?? null,
      locale: user?.locale ?? null,
      channel: user?.acquisition?.channel ?? null,
      campaign: user?.acquisition?.campaign ?? null,
      content: user?.acquisition?.content ?? null,
      signedUpAt: user?.createdAt ?? null,
      minutesToBuy: user?.createdAt ? Math.max(0, Math.round((payment.at.getTime() - user.createdAt.getTime()) / 60_000)) : null,
      order,
      buyerTotalUsd: paid.filter((entry) => !entry.refunded).reduce((sum, entry) => sum + entry.usd, 0) || payment.usd,
      placement: typeof started?.props?.placement === 'string' ? started.props.placement : null,
      ui: typeof created?.props?.ui === 'string' ? created.props.ui : null,
      mobile: seen?.mobile ?? null,
      inApp: seen?.inApp ?? null,
      season: key ? (seasonByUser.get(key) ?? null) : null,
    }
  })

  const kept = rows.filter((row) => !row.refunded)
  const revenueUsd = kept.reduce((sum, row) => sum + row.usd, 0)
  const buyers = new Set(kept.map((row) => row.account ?? row.email ?? row.id))
  const newBuyers = new Set(kept.filter((row) => row.order === 1).map((row) => row.account ?? row.email ?? row.id))

  // Revenue and payments per Pacific day, every day of the range.
  const daily: { day: string; usd: number; count: number; refundedUsd: number }[] = []

  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    daily.push({ day, usd: 0, count: 0, refundedUsd: 0 })
  }

  const byDay = new Map(daily.map((entry) => [entry.day, entry]))

  for (const row of rows) {
    const entry = byDay.get(pacificDay(row.at))

    if (!entry) {
      continue
    }

    if (row.refunded) {
      entry.refundedUsd += row.usd
    } else {
      entry.usd += row.usd
      entry.count += 1
    }
  }

  return {
    from: range.from,
    to: range.to,
    truncated: input.truncated,
    summary: {
      revenueUsd,
      payments: kept.length,
      buyers: buyers.size,
      newBuyers: newBuyers.size,
      averageUsd: kept.length > 0 ? Math.round(revenueUsd / kept.length) : 0,
      refunds: rows.length - kept.length,
      refundedUsd: rows.filter((row) => row.refunded).reduce((sum, row) => sum + row.usd, 0),
    },
    daily,
    byProduct: split(rows, (row) => row.product),
    byCountry: split(rows, (row) => row.country),
    byChannel: split(rows, (row) => (row.channel ? (row.campaign ? `${row.channel} · ${row.campaign}` : row.channel) : null)),
    byPlacement: split(rows, (row) => row.placement),
    rows,
  }
}
