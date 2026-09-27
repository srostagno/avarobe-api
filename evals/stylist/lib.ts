import fs from 'node:fs'
import path from 'node:path'

import { env } from '../../src/config/env.js'
import type { AvatarDocument, LookItem, LookPlan } from '../../src/types/mongo.js'
import { createStructuredResponse } from '../../src/utils/openai.js'

export const OUT_DIR = new URL('./out/', import.meta.url).pathname
export const JUDGE_MODEL = 'gpt-5.5'

export async function pool<T, R>(items: T[], size: number, run: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let index = next++; index < items.length; index = next++) {
        results[index] = await run(items[index]!, index)
      }
    }),
  )

  return results
}

export async function timed<T>(run: () => Promise<T>) {
  const started = Date.now()
  const value = await run()
  return { value, seconds: (Date.now() - started) / 1000 }
}

export async function retry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)))
    }
  }

  throw lastError
}

// Runs one arm with the stylist env pointed at the arm's model. Arms run one
// after another because env is shared.
export async function withStylist<T>(model: string, effort: 'low' | 'medium' | 'high', run: () => Promise<T>) {
  const before = { model: env.AI_STYLIST_MODEL, effort: env.AI_STYLIST_REASONING_EFFORT }
  env.AI_STYLIST_MODEL = model
  env.AI_STYLIST_REASONING_EFFORT = effort

  try {
    return await run()
  } finally {
    env.AI_STYLIST_MODEL = before.model
    env.AI_STYLIST_REASONING_EFFORT = before.effort
  }
}

export function describeOutfit(items: LookItem[]) {
  return items.map((item) => `${item.slot}: ${item.color} ${item.material} ${item.name} (${item.fit})`).join('; ')
}

export function describeClientForJudge(avatar: AvatarDocument) {
  const { body, colorAnalysis } = avatar
  const list = (swatches: { name: string }[]) => swatches.map((swatch) => swatch.name).join(', ')

  return [
    `${body.presentation}, ${body.heightCm} cm, ${body.weightKg} kg, ${body.build} build.`,
    colorAnalysis
      ? `${colorAnalysis.season}. Best: ${list(colorAnalysis.bestColors)}. Neutrals: ${list(colorAnalysis.neutrals)}. Avoid near the face: ${list(colorAnalysis.avoidColors)}.`
      : '',
  ].join(' ')
}

export type LookScore = {
  adherence: number
  fidelity: number
  weather: number
  coherence: number
  flattering: number
  hit: boolean
  violations: string[]
  critique: string
}

const judgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['looks', 'variety'],
  properties: {
    looks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['adherence', 'fidelity', 'weather', 'coherence', 'flattering', 'hit', 'violations', 'critique'],
        properties: {
          adherence: { type: 'integer', description: '0-10' },
          fidelity: { type: 'integer', description: '0-10' },
          weather: { type: 'integer', description: '0-10' },
          coherence: { type: 'integer', description: '0-10' },
          flattering: { type: 'integer', description: '0-10' },
          hit: { type: 'boolean' },
          violations: { type: 'array', items: { type: 'string' } },
          critique: { type: 'string' },
        },
      },
    },
    variety: { type: 'integer', description: '0-10' },
  },
}

const JUDGE_INSTRUCTIONS = [
  'You are a demanding fashion editor auditing an AI personal stylist. You see the client brief, the client profile and the outfits the stylist proposed (garments only, no sales pitch).',
  'Score every look from 0 to 10 on each criterion, where 10 is flawless and 5 is mediocre:',
  'adherence: honors every explicit ask in the brief and notes (the event, any named style, person, era or music, stated constraints such as "no heels", "hate pink", "only pants", and the season or weather).',
  'fidelity: when a style reference is named, would you instantly recognize it in this outfit? Signature pieces, colors, fits and footwear of that reference. When none is named, how well it embodies the right aesthetic and dress code for the event.',
  'weather: right for the stated or implied weather.',
  'coherence: a real, wearable outfit whose pieces work together (formality, fabrics, shoes).',
  'flattering: colors near the face suit the client palette (or are flattering neutrals) and the cut suits their build.',
  'hit: true only if this client would say "yes, this is exactly what I asked for". Be strict: a generic outfit that ignores a named style is not a hit.',
  'violations: every explicit constraint the look breaks, quoted briefly; empty if none.',
  'critique: one short sentence.',
  'variety: for the whole set, 0-10: distinct takes that all stay on the brief. Looks that drift off the brief do not count as variety.',
].join(' ')

export async function judgeLooks(input: {
  occasion: string
  notes?: string
  avatar: AvatarDocument
  looks: Pick<LookPlan, 'title' | 'items'>[]
}) {
  return retry(() =>
    createStructuredResponse<{ looks: LookScore[]; variety: number }>({
      instructions: JUDGE_INSTRUCTIONS,
      content: [
        {
          type: 'input_text',
          text: [
            `Brief: ${input.occasion}`,
            input.notes ? `Notes: ${input.notes}` : null,
            `Client: ${describeClientForJudge(input.avatar)}`,
            '',
            ...input.looks.map((look, index) => `Look ${index + 1}: ${describeOutfit(look.items)}`),
          ]
            .filter((line) => line !== null)
            .join('\n'),
        },
      ],
      schemaName: 'stylist_audit',
      schema: judgeSchema,
      model: JUDGE_MODEL,
      reasoningEffort: 'medium',
      timeoutMs: 180_000,
    }),
  )
}

export function save(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${name}.json`)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

export const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
export const pct = (value: number) => `${Math.round(value * 100)}%`
export const fmt = (value: number) => value.toFixed(1)
