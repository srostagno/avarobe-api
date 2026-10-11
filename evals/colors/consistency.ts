// Same person, same season: does the scored color read (measure, the season
// in code, then the palette) give a fictional face the same season every
// time, in every language, and hold it on a second photo of the same
// person? It decides COLOR_READ_METHOD's default (config/env.ts): 'scored'
// if every check below passes, 'classic' otherwise.
//
//   corepack pnpm exec tsx evals/colors/consistency.ts
//
// Calls the production code (measure.ts, decide.ts) with the real model, one
// call at a time, no retries, and stops at the first API error. At most
// MAX_READS full reads (each one or two measuring calls and, when the season
// needs it, a palette call). Fictional faces only. Needs OPENAI_API_KEY in
// .env; results land in evals/colors/out/ (git-ignored).
import fs from 'node:fs'
import path from 'node:path'

import { env } from '../../src/config/env.js'
import { CLOSE_GAP, SWITCH_MARGIN, decideColors, type ColorDecision } from '../../src/modules/avatar/decide.js'
import { measurePhoto, writePalette, type ScoredRead } from '../../src/modules/avatar/measure.js'
import { rankSeasons, seasonFit, type Season } from '../../src/modules/avatar/seasons.js'
import type { ColorAnalysis } from '../../src/types/mongo.js'
import { normalizeSelfie } from '../../src/utils/images.js'
import type { Locale } from '../../src/utils/locale.js'
import { withLocale } from '../../src/utils/request-locale.js'

const MAX_READS = 18
const OUT_DIR = new URL('./out/', import.meta.url).pathname
const DESIGN = '/Users/silvio/Documents/Projects/Avarobe/design'
const FACES = {
  her: `${DESIGN}/ai-samples/her/selfie.png`,
  his: `${DESIGN}/ai-samples/his/selfie.png`,
  elena: `${DESIGN}/ads/2026-10-tired-photos/casting/elena.png`,
  naomi: `${DESIGN}/ads/2026-10-tired-photos/casting/naomi.png`,
  claire: `${DESIGN}/ads/2026-10-tired-photos/casting/claire.png`,
  claireSelfie: `${DESIGN}/ads/2026-10-tired-photos/validate/claire-selfie.jpg`,
} as const
type Face = keyof typeof FACES

// A: 4 faces × 3 first reads in English; B: her and his once each in
// Portuguese and Spanish; C: Claire, then another photo of her with the
// first read as her season.
type Step = { part: 'A' | 'B' | 'C'; face: Face; locale: Locale; currentFrom?: Face }
const PLAN: Step[] = [
  ...(['her', 'his', 'elena', 'naomi'] as const).flatMap((face) => [1, 2, 3].map(() => ({ part: 'A' as const, face, locale: 'en' as const }))),
  ...(['her', 'his'] as const).flatMap((face) => (['pt-BR', 'es'] as const).map((locale) => ({ part: 'B' as const, face, locale }))),
  { part: 'C', face: 'claire', locale: 'en' },
  { part: 'C', face: 'claireSelfie', locale: 'en', currentFrom: 'claire' },
]

if (PLAN.length > MAX_READS) {
  throw new Error(`The plan has ${PLAN.length} reads; at most ${MAX_READS}.`)
}

if (!env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is missing from .env.')
}

// Prices are an assumption (USD per million tokens), not verified.
const PRICE = { input: 0.75, cached: 0.075, output: 4.5 }
type Usage = { calls: number; measures: number; palettes: number; input: number; cached: number; output: number }
const zero = (): Usage => ({ calls: 0, measures: 0, palettes: 0, input: 0, cached: 0, output: 0 })
const total = zero()
let current = zero()

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const response = await realFetch(input, init)

  if (String(input instanceof Request ? input.url : input).endsWith('/responses')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { text?: { format?: { name?: string } } }
    const payload = (await response
      .clone()
      .json()
      .catch(() => ({}))) as { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }
    const cached = payload.usage?.input_tokens_details?.cached_tokens ?? 0

    for (const usage of [total, current]) {
      usage.calls += 1
      usage.measures += Number(body.text?.format?.name === 'color_measure')
      usage.palettes += Number(body.text?.format?.name === 'color_palette')
      usage.input += (payload.usage?.input_tokens ?? 0) - cached
      usage.cached += cached
      usage.output += payload.usage?.output_tokens ?? 0
    }
  }

  return response
}

const cost = (usage: Usage) => (usage.input * PRICE.input + usage.cached * PRICE.cached + usage.output * PRICE.output) / 1_000_000

type Result = Step & {
  season: string
  read: ScoredRead
  decision: ColorDecision
  analysis: ColorAnalysis | null
  seconds: number
  usage: Usage
}

const selfies = new Map<Face, Buffer>()
const results: Result[] = []
let stoppedBy: string | null = null

for (const step of PLAN) {
  current = zero()
  const started = Date.now()

  try {
    if (!selfies.has(step.face)) {
      selfies.set(step.face, await normalizeSelfie(fs.readFileSync(FACES[step.face])))
    }

    const selfie = selfies.get(step.face)!
    const read = await measurePhoto(selfie)
    const previous = step.currentFrom ? results.find((result) => result.face === step.currentFrom) : undefined
    const decision = decideColors({ current: previous?.decision.shown ?? null, locked: false, measure: read })
    const analysis = decision.palette ? await withLocale(step.locale, () => writePalette(selfie, read, decision.read)) : null

    results.push({ ...step, season: decision.read, read, decision, analysis, seconds: (Date.now() - started) / 1000, usage: current })
    console.log(
      `${step.part} ${step.face} ${step.locale}: ${decision.read} (${decision.outcome}) scores ${JSON.stringify(read.scores)} ` +
        `light ${read.lighting} samples ${read.samples} margin ${decision.margin?.toFixed(2)} ${((Date.now() - started) / 1000).toFixed(1)} s $${cost(current).toFixed(4)}`,
    )
  } catch (error) {
    stoppedBy = `${step.part} ${step.face} ${step.locale}: ${(error as Error).message.slice(0, 300)}`
    console.error(`Stopped at the first API error: ${stoppedBy}`)
    break
  }
}

// ---------------------------------------------------------------- checks

const HEX = /^#[0-9A-F]{6}$/
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const modal = (seasons: string[]) => {
  const counts = new Map<string, number>()
  seasons.forEach((season) => counts.set(season, (counts.get(season) ?? 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const partA = (['her', 'his', 'elena', 'naomi'] as const).map((face) => {
  const reads = results.filter((result) => result.part === 'A' && result.face === face)
  const seasons = reads.map((result) => result.season)
  const top = modal(seasons) as Season | null
  // How much the modal season's fit moves between reads of the same photo,
  // and the largest lead one read would give another's season (what a
  // near-identical photo could do to a season).
  const fits = top ? reads.map((result) => seasonFit(top, result.read.scores)) : []
  const leads = reads.flatMap((a) =>
    reads.map((b) => {
      const ranking = rankSeasons(b.read.scores)
      return ranking.fits[ranking.season] - seasonFit(rankSeasons(a.read.scores).season, b.read.scores)
    }),
  )

  return {
    face,
    seasons,
    modal: top,
    same: seasons.length === 3 && new Set(seasons).size === 1,
    distinct: new Set(seasons).size,
    drift: fits.length ? Math.max(...fits) - Math.min(...fits) : null,
    sameLead: leads.length ? Math.max(...leads) : null,
  }
})

const LANGUAGE_HINTS: Record<Locale, RegExp> = {
  en: /\byour\b/i,
  'pt-BR': /\b(você|seu|sua|seus|suas|tons|cores|pele)\b/i,
  es: /\b(tu|tus|tonos|colores|piel)\b/i,
}
const partB = results
  .filter((result) => result.part === 'B')
  .map((result) => {
    const english = partA.find((face) => face.face === result.face)?.modal ?? null
    const text = `${result.analysis?.summary ?? ''} ${result.analysis?.bestColors.map((swatch) => swatch.name).join(' ') ?? ''}`

    return {
      face: result.face,
      locale: result.locale,
      season: result.season,
      english,
      sameSeason: result.season === english,
      language: LANGUAGE_HINTS[result.locale].test(text) && !/\byour\b/i.test(text),
      summary: result.analysis?.summary ?? null,
    }
  })

const palettes = results
  .filter((result) => result.analysis)
  .map((result) => {
    const analysis = result.analysis!
    const all = [...analysis.bestColors, ...analysis.neutrals, ...analysis.avoidColors]
    const wear = new Set([...analysis.bestColors, ...analysis.neutrals].map((swatch) => swatch.hex))

    return {
      face: result.face,
      locale: result.locale,
      validHex: all.every((swatch) => HEX.test(swatch.hex)),
      noOverlap: analysis.avoidColors.every((swatch) => !wear.has(swatch.hex)),
      counts: [analysis.bestColors.length, analysis.neutrals.length, analysis.avoidColors.length],
      full: analysis.bestColors.length >= 8 && analysis.neutrals.length >= 4 && analysis.avoidColors.length >= 3,
    }
  })

const second = results.find((result) => result.part === 'C' && result.currentFrom)
const seconds = results.map((result) => result.seconds)
const perRead = results.length ? cost(total) / results.length : 0
const drift = Math.max(0, ...partA.map((face) => face.drift ?? 0))
const closeCalls = results.filter((result) => result.read.samples === 2).length

const checks = {
  completed: !stoppedBy && results.length === PLAN.length,
  aSameThreeOfFour: partA.filter((face) => face.same).length >= 3,
  aNoThreeSeasons: partA.every((face) => face.distinct < 3),
  aHerHisDeepAutumn: partA.filter((face) => face.face === 'her' || face.face === 'his').every((face) => face.modal === 'Deep Autumn'),
  bSameSeason: partB.length === 4 && partB.every((row) => row.sameSeason),
  bLanguage: partB.length === 4 && partB.every((row) => row.language),
  palettesValid: palettes.length > 0 && palettes.every((row) => row.validHex && row.noOverlap && row.full),
  cHolds: Boolean(second && (second.decision.outcome === 'confirmed' || second.decision.outcome === 'anchored')),
  driftWithinMargin: drift <= 1.5,
  medianSeconds: seconds.length > 0 && median(seconds) <= 8,
  costPerRead: perRead <= 0.006,
}
const passed = Object.values(checks).every(Boolean)
const summary = {
  model: { measure: env.COLOR_MEASURE_MODEL, palette: env.AI_TEXT_MODEL, paletteEffort: env.AI_TEXT_REASONING_EFFORT },
  rules: { SWITCH_MARGIN, CLOSE_GAP, suggestedSwitchMargin: drift > 1.5 ? 3 : SWITCH_MARGIN },
  reads: results.length,
  stoppedBy,
  partA,
  partB,
  partC: second ? { first: results.find((result) => result.face === 'claire' && !result.currentFrom)?.season, second: second.season, outcome: second.decision.outcome, lead: second.decision.lead } : null,
  palettes,
  drift,
  closeCalls: { reads: closeCalls, share: results.length ? closeCalls / results.length : 0 },
  medianSeconds: seconds.length ? median(seconds) : null,
  usage: total,
  costPerRead: perRead,
  prices: PRICE,
  checks,
  verdict: passed ? 'scored' : 'classic',
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, `consistency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(file, JSON.stringify({ summary, results }, null, 2))

console.log(JSON.stringify({ ...summary, partB: summary.partB.map(({ summary: _text, ...row }) => row) }, null, 2))
console.log(`${total.calls} calls (${total.measures} measuring, ${total.palettes} palettes), about $${cost(total).toFixed(4)} at the assumed prices; ${file}`)
console.log(passed ? 'Every check passed: COLOR_READ_METHOD defaults to scored.' : 'Not every check passed: COLOR_READ_METHOD defaults to classic.')
process.exitCode = stoppedBy ? 1 : 0
