import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { adminUserIds } from '../billing/entitlements.js'

import { SURVEY_QUESTIONS, type SurveyQuestion } from './questions.js'

type Counts = Record<string, number>

const bump = (counts: Counts, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

// The admin "Why" tab: how people answered each question in the period,
// split by where they came from (campaign) and, for offers, by where the
// offer opened; plus the latest "other" notes. Admins excluded.
export async function whyReport(app: FastifyInstance, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const admins = await adminUserIds(app)
  const [answers, signups] = await Promise.all([
    app.collections.surveyAnswers
      .find({ createdAt: { $gte: since }, userId: { $nin: admins } })
      .sort({ createdAt: -1 })
      .limit(5000)
      .toArray(),
    app.collections.users.countDocuments({ createdAt: { $gte: since }, _id: { $nin: admins }, guest: { $ne: true } }),
  ])

  const questions = (Object.keys(SURVEY_QUESTIONS) as SurveyQuestion[]).map((question) => {
    const rows = answers.filter((row) => row.question === question)
    const byAnswer: Counts = {}
    const byContent: Record<string, Counts> = {}
    const byPlacement: Record<string, Counts> = {}

    for (const row of rows) {
      bump(byAnswer, row.answer)
      bump((byContent[row.content ?? 'direct'] ??= {}), row.answer)

      if (row.context.placement) {
        bump((byPlacement[row.context.placement] ??= {}), row.answer)
      }
    }

    return {
      question,
      total: rows.length,
      people: new Set(rows.map((row) => row.userId.toString())).size,
      answers: SURVEY_QUESTIONS[question].map((answer) => ({ answer, count: byAnswer[answer] ?? 0 })),
      byContent: Object.entries(byContent)
        .map(([content, counts]) => ({ content, total: Object.values(counts).reduce((a, b) => a + b, 0), counts }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12),
      byPlacement: Object.entries(byPlacement)
        .map(([placement, counts]) => ({ placement, total: Object.values(counts).reduce((a, b) => a + b, 0), counts }))
        .sort((a, b) => b.total - a.total),
    }
  })

  const notes = answers
    .filter((row) => row.note)
    .slice(0, 40)
    .map((row) => ({
      question: row.question,
      note: row.note,
      content: row.content,
      account: row.userId.toString().slice(-6),
      at: row.createdAt.toISOString(),
    }))

  return { days, signups, questions, notes, game: await gameReport(app, since, admins) }
}

type GameRow = { shown: number; answered: number; a: number; b: number; bet: number; selfie: number }

const emptyRow = (): GameRow => ({ shown: 0, answered: 0, a: 0, b: 0, bet: 0, selfie: 0 })

// The game at the top of the colors page (web components/landing-game, the
// lp_game events): visitors who saw it, answered "Which one looks younger?"
// and what, bet a season and which, and sent their selfie; by ad
// (utm_content). Admins' own visitors are left out.
async function gameReport(app: FastifyInstance, since: Date, admins: ObjectId[]) {
  const adminVisitors = (await app.collections.analyticsEvents.distinct('visitorId', { userId: { $in: admins } })).filter(
    (value): value is string => Boolean(value),
  )
  const events = await app.collections.analyticsEvents
    .find(
      { at: { $gte: since }, name: 'lp_game', visitorId: { $nin: adminVisitors } },
      { projection: { visitorId: 1, props: 1, content: 1, at: 1 } },
    )
    .sort({ at: 1 })
    .limit(50000)
    .toArray()

  type Visitor = { content: string; shown: boolean; ab: string | null; bet: string | null; selfie: boolean }
  const visitors = new Map<string, Visitor>()

  for (const event of events) {
    const key = event.visitorId ?? event._id.toString()
    const visitor = visitors.get(key) ?? { content: event.content ?? 'direct', shown: false, ab: null, bet: null, selfie: false }
    const step = String(event.props.step ?? '')
    const answer = event.props.answer === undefined ? null : String(event.props.answer)

    if (step === 'shown') visitor.shown = true
    if (step === 'ab' && !visitor.ab) visitor.ab = answer
    if (step === 'bet' && !visitor.bet) visitor.bet = answer
    if (step === 'selfie') visitor.selfie = true

    visitors.set(key, visitor)
  }

  const total = emptyRow()
  const bets: Counts = {}
  const byContent: Record<string, GameRow> = {}

  for (const visitor of visitors.values()) {
    for (const row of [total, (byContent[visitor.content] ??= emptyRow())]) {
      row.shown += visitor.shown || visitor.ab || visitor.bet || visitor.selfie ? 1 : 0
      row.answered += visitor.ab ? 1 : 0
      row.a += visitor.ab === 'a' ? 1 : 0
      row.b += visitor.ab === 'b' ? 1 : 0
      row.bet += visitor.bet ? 1 : 0
      row.selfie += visitor.selfie ? 1 : 0
    }

    if (visitor.bet) {
      bump(bets, visitor.bet)
    }
  }

  return {
    ...total,
    bets: ['spring', 'summer', 'autumn', 'winter'].map((family) => ({ answer: family, count: bets[family] ?? 0 })),
    byContent: Object.entries(byContent)
      .map(([content, row]) => ({ content, ...row }))
      .sort((a, b) => b.shown - a.shown)
      .slice(0, 15),
  }
}
