import type { FastifyInstance } from 'fastify'

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
    app.collections.users.countDocuments({ createdAt: { $gte: since }, _id: { $nin: admins } }),
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

  return { days, signups, questions, notes }
}
