import type { FastifyInstance } from 'fastify'

import type { FeedbackDocument } from '../../types/mongo.js'
import { isPlaceholderEmail } from '../../utils/deleted-accounts.js'
import { adminUserIds } from '../billing/entitlements.js'

import { FEEDBACK_PRODUCTS, npsScore } from './rules.js'

const DAY = 24 * 60 * 60 * 1000

function stats(rows: Pick<FeedbackDocument, 'score'>[]) {
  const scores = rows.map((row) => row.score)

  return {
    responses: scores.length,
    nps: npsScore(scores),
    promoters: scores.filter((score) => score >= 9).length,
    passives: scores.filter((score) => score === 7 || score === 8).length,
    detractors: scores.filter((score) => score <= 6).length,
    average: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null,
  }
}

function groupBy(rows: FeedbackDocument[], key: (row: FeedbackDocument) => string) {
  const groups = new Map<string, FeedbackDocument[]>()

  for (const row of rows) {
    const value = key(row)
    groups.set(value, [...(groups.get(value) ?? []), row])
  }

  return [...groups.entries()].map(([value, items]) => ({ key: value, ...stats(items) })).sort((a, b) => b.responses - a.responses)
}

// Admin → NPS: the paid advisors' ratings in the period (by advisor,
// language, region and week), the 0–10 spread, the half-price Pro offer
// from given to paid, and the reviews. Admins excluded.
export async function feedbackReport(app: FastifyInstance, days: number) {
  const since = new Date(Date.now() - days * DAY)
  const admins = await adminUserIds(app)
  const rows = await app.collections.feedback
    .find({ updatedAt: { $gte: since }, userId: { $nin: admins } })
    .sort({ updatedAt: -1 })
    .limit(5000)
    .toArray()
  const ids = [...new Map(rows.map((row) => [row.userId.toString(), row.userId])).values()]
  const people = await app.collections.users.find({ _id: { $in: ids } }, { projection: { email: 1, firstName: 1 } }).toArray()
  const who = new Map(people.map((person) => [person._id.toString(), person]))

  // The offer: given in the period, and of those, paid with it.
  const offered = await app.collections.users
    .find({ 'proHalfOffer.at': { $gte: since }, _id: { $nin: admins } }, { projection: { proHalfOffer: 1 } })
    .toArray()
  const used = offered.filter((user) => user.proHalfOffer?.usedAt)
  const renewals = used.length
    ? await app.collections.purchases
        .find({ userId: { $in: used.map((user) => user._id) }, product: 'pro_monthly', refundedAt: { $in: [null] } }, { projection: { userId: 1, amountUsd: 1, createdAt: 1 } })
        .toArray()
    : []

  // Week by week, Monday first (UTC), oldest first.
  const weekOf = (date: Date) => {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
    return day.toISOString().slice(0, 10)
  }

  return {
    days,
    overall: stats(rows),
    spread: Array.from({ length: 11 }, (_, score) => ({ score, count: rows.filter((row) => row.score === score).length })),
    byProduct: FEEDBACK_PRODUCTS.map((product) => ({ key: product, ...stats(rows.filter((row) => row.product === product)) })),
    byLocale: groupBy(rows, (row) => row.locale),
    byRegion: groupBy(rows, (row) => row.region),
    byPlan: groupBy(rows, (row) => (row.pro ? 'pro' : 'bought')),
    byWeek: groupBy(rows, (row) => weekOf(row.updatedAt)).sort((a, b) => a.key.localeCompare(b.key)),
    offer: {
      given: offered.length,
      used: used.length,
      // Payments of Pro monthly from those who used it: the half-price first
      // month and the renewals at full price after it.
      payments: renewals.length,
      revenueUsd: renewals.reduce((sum, row) => sum + (row.amountUsd ?? 0), 0),
      stillOpen: offered.filter((user) => user.proHalfOffer && !user.proHalfOffer.usedAt && user.proHalfOffer.until.getTime() > Date.now()).length,
    },
    reviews: rows
      .filter((row) => row.comment)
      .slice(0, 200)
      .map((row) => {
        const person = who.get(row.userId.toString())

        return {
          id: row._id.toString(),
          userId: row.userId.toString(),
          product: row.product,
          score: row.score,
          comment: row.comment,
          quoteOk: row.quoteOk,
          name: person?.firstName ?? null,
          email: person?.email && !isPlaceholderEmail(person.email) ? person.email : null,
          locale: row.locale,
          region: row.region,
          pro: row.pro,
          at: row.updatedAt.toISOString(),
        }
      }),
  }
}
