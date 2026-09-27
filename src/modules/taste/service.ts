import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { TasteDocument, TasteNote } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { createStructuredResponse } from '../../utils/openai.js'
import type { StylistTaste } from '../looks/prompts.js'
import {
  TASTE_LEARNING_INSTRUCTIONS,
  type TasteSignal,
  buildTasteLearningRequest,
  tasteLearningSchema,
} from './prompts.js'

export const MAX_TASTE_NOTES = 12
const MAX_LEARNED_NOTES = 8
// The reactions one learning pass reads, newest first.
const FEEDBACK_WINDOW = 30
const FAVORITES_WINDOW = 10

type LearnedNotes = {
  summary: string
  loves: { text: string; evidence: number }[]
  avoids: { text: string; evidence: number }[]
}

const normalize = (text: string) => text.trim().toLowerCase()

// Turns reactions into learned notes. Pure apart from the model call, so the
// evals run the same code the app does.
export async function learnTaste(input: {
  statement: string | null
  loves: TasteNote[]
  avoids: TasteNote[]
  dismissed: string[]
  signals: TasteSignal[]
}) {
  const own = (notes: TasteNote[]) => notes.filter((note) => note.source === 'you')
  const learnedBefore = (notes: TasteNote[]) => notes.filter((note) => note.source === 'learned').map((note) => note.text)
  const response = await createStructuredResponse<LearnedNotes>({
    instructions: TASTE_LEARNING_INSTRUCTIONS,
    content: [
      {
        type: 'input_text',
        text: buildTasteLearningRequest({
          statement: input.statement,
          loves: own(input.loves).map((note) => note.text),
          avoids: own(input.avoids).map((note) => note.text),
          learnedLoves: learnedBefore(input.loves),
          learnedAvoids: learnedBefore(input.avoids),
          dismissed: input.dismissed,
          signals: input.signals,
        }),
      },
    ],
    schemaName: 'taste_profile',
    schema: tasteLearningSchema,
    model: env.AI_STYLIST_MODEL,
    reasoningEffort: env.AI_STYLIST_REASONING_EFFORT,
    timeoutMs: 90_000,
  })
  const blocked = new Set([...input.dismissed, ...own(input.loves), ...own(input.avoids)].map((entry) =>
    normalize(typeof entry === 'string' ? entry : entry.text),
  ))
  const learned = (notes: LearnedNotes['loves']): TasteNote[] => {
    const seen = new Set<string>()

    return notes
      .map((note) => ({ text: note.text.trim().slice(0, 80), evidence: Math.max(0, Math.round(note.evidence)) }))
      .filter((note) => {
        const key = normalize(note.text)

        if (!key || blocked.has(key) || seen.has(key)) {
          return false
        }

        seen.add(key)
        return true
      })
      .slice(0, MAX_LEARNED_NOTES)
      .map((note) => ({ id: new ObjectId().toString(), text: note.text, source: 'learned', evidence: note.evidence }))
  }

  return {
    summary: response.summary.trim() || null,
    loves: [...own(input.loves), ...learned(response.loves)],
    avoids: [...own(input.avoids), ...learned(response.avoids)],
  }
}

// What the stylist reads when planning.
export function toStylistTaste(taste: TasteDocument | null): StylistTaste | null {
  if (!taste) {
    return null
  }

  return {
    statement: taste.statement,
    summary: taste.summary,
    loves: taste.loves.map((note) => note.text),
    avoids: taste.avoids.map((note) => note.text),
  }
}

export function newTaste(userId: ObjectId, now: Date): TasteDocument {
  return {
    _id: new ObjectId(),
    userId,
    statement: null,
    summary: null,
    loves: [],
    avoids: [],
    dismissed: [],
    signals: 0,
    learning: false,
    dirty: false,
    learnedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function readSignals(app: FastifyInstance, userId: ObjectId): Promise<TasteSignal[]> {
  const projection = { occasion: 1, plan: 1, feedback: 1, favorite: 1 }
  const [rated, favorites] = await Promise.all([
    app.collections.looks
      .find({ userId, 'feedback.at': { $exists: true } }, { projection })
      .sort({ 'feedback.at': -1 })
      .limit(FEEDBACK_WINDOW)
      .toArray(),
    app.collections.looks
      .find({ userId, favorite: true, 'feedback.at': { $exists: false } }, { projection })
      .sort({ updatedAt: -1 })
      .limit(FAVORITES_WINDOW)
      .toArray(),
  ])

  return [...rated, ...favorites].map((look) => ({
    occasion: look.occasion.text,
    plan: look.plan,
    feedback: look.feedback ?? null,
    favorite: look.favorite,
  }))
}

async function learnOnce(app: FastifyInstance, taste: TasteDocument) {
  const signals = await readSignals(app, taste.userId)
  const now = new Date()

  if (signals.length === 0 && !taste.statement) {
    await app.collections.tastes.updateOne(
      { _id: taste._id },
      {
        $set: {
          summary: null,
          loves: taste.loves.filter((note) => note.source === 'you'),
          avoids: taste.avoids.filter((note) => note.source === 'you'),
          signals: 0,
          learnedAt: now,
          updatedAt: now,
        },
      },
    )
    return
  }

  const learned = await learnTaste({ ...taste, signals })
  // Lines the person added or removed while this pass ran win over it.
  const current = await app.collections.tastes.findOne({ _id: taste._id })

  if (!current) {
    return
  }

  const own = (notes: TasteNote[]) => notes.filter((note) => note.source === 'you')
  const dismissed = new Set(current.dismissed.map(normalize))
  const keep = (notes: TasteNote[], ownNow: TasteNote[]) => {
    const ownTexts = new Set(ownNow.map((note) => normalize(note.text)))

    return [
      ...ownNow,
      ...notes.filter(
        (note) => note.source === 'learned' && !dismissed.has(normalize(note.text)) && !ownTexts.has(normalize(note.text)),
      ),
    ]
  }

  await app.collections.tastes.updateOne(
    { _id: taste._id },
    {
      $set: {
        summary: learned.summary,
        loves: keep(learned.loves, own(current.loves)),
        avoids: keep(learned.avoids, own(current.avoids)),
        signals: signals.length,
        learnedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  )
}

async function runTasteLearning(app: FastifyInstance, userId: ObjectId) {
  // Feedback that lands during a pass sets `dirty` again, so loop until clean.
  for (;;) {
    const claimed = await app.collections.tastes.findOneAndUpdate(
      { userId, learning: false, dirty: true },
      { $set: { learning: true, dirty: false, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!claimed) {
      return
    }

    try {
      await learnOnce(app, claimed)
    } catch (error) {
      app.log.error({ userId: userId.toString(), err: errorMessage(error) }, 'Taste learning failed')
    } finally {
      await app.collections.tastes.updateOne({ _id: claimed._id }, { $set: { learning: false } })
    }
  }
}

// Learning runs in-process, so a restart mid-pass leaves `learning` set.
// Clear it on boot and finish the passes that were pending.
export async function resumeTasteLearning(app: FastifyInstance) {
  await app.collections.tastes.updateMany({ learning: true }, { $set: { learning: false, dirty: true } })
  const pending = await app.collections.tastes.find({ dirty: true }, { projection: { userId: 1 } }).limit(50).toArray()

  for (const taste of pending) {
    void runTasteLearning(app, taste.userId).catch((error: unknown) => {
      app.log.error({ err: error, userId: taste.userId.toString() }, 'Taste learning crashed')
    })
  }
}

// Called after anything that teaches us about taste (feedback, favorites,
// the person's own words). Learning runs in the background.
export async function scheduleTasteLearning(app: FastifyInstance, userId: ObjectId) {
  await ensureTaste(app, userId)
  await app.collections.tastes.updateOne({ userId }, { $set: { dirty: true, updatedAt: new Date() } })

  void runTasteLearning(app, userId).catch((error: unknown) => {
    app.log.error({ err: error, userId: userId.toString() }, 'Taste learning crashed')
  })
}

export async function readTaste(app: FastifyInstance, userId: ObjectId) {
  return app.collections.tastes.findOne({ userId })
}

// The person's taste document, created on first use.
export async function ensureTaste(app: FastifyInstance, userId: ObjectId) {
  const defaults: Partial<TasteDocument> = newTaste(userId, new Date())

  // The filter sets userId on insert.
  delete defaults.userId

  const taste = await app.collections.tastes.findOneAndUpdate(
    { userId },
    { $setOnInsert: defaults },
    { upsert: true, returnDocument: 'after' },
  )

  if (!taste) {
    throw new Error('Could not create the taste profile.')
  }

  return taste
}

export function serializeTaste(taste: TasteDocument | null) {
  const note = (entry: TasteNote) => ({ id: entry.id, text: entry.text, source: entry.source, evidence: entry.evidence })

  return {
    statement: taste?.statement ?? null,
    summary: taste?.summary ?? null,
    loves: (taste?.loves ?? []).map(note),
    avoids: (taste?.avoids ?? []).map(note),
    signals: taste?.signals ?? 0,
    learning: Boolean(taste && (taste.learning || taste.dirty)),
    learnedAt: taste?.learnedAt?.toISOString() ?? null,
  }
}
