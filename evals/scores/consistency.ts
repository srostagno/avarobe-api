// Look Score and Hair Score calibration (Oct 17, 2026): does the same photo
// get the same score every time, does a re-saved copy get it too, and do the
// scores rank poor < average < good < excellent? It suggests SCORE_OFFSET
// (average at about 60–65, good at about 72–80), says whether SCORE_FLOOR 35
// would bind, and whether SCORE_SAMPLES 2 is needed or 1 would do.
//
//   corepack pnpm exec tsx evals/scores/consistency.ts            full run
//   corepack pnpm exec tsx evals/scores/consistency.ts --from evals/scores/out/raw-<stamp>.json
//                                                                 report again from a run, no calls
//
// Calls the production code (measureScore in modules/scores/service.ts,
// scoreFrom in score.ts, the same normalizers as the upload route) with the
// real model and env.SCORE_SAMPLES, scoring with SCORE_OFFSET 0 and
// SCORE_FLOOR 1 so the raw spread shows. Each photo: A. three reads of the
// upload as production prepares it; B. one read of a re-saved copy (JPEG
// quality 70, 5% cropped), prepared the same way. C. the measuring call is
// English by design: checked offline (a stubbed fetch, no API calls) that
// its request is byte-identical whatever the request's language.
//
// One read at a time (each its SCORE_SAMPLES calls at once), no retries;
// stops at the first API error and at MAX_CALLS measuring calls. Every
// sample is captured from the response, so each one's own score shows what
// SCORE_SAMPLES 1 would have given. Fictional, AI-generated people only
// (evals/scores/photos.ts). Needs OPENAI_API_KEY in .env; results land in
// evals/scores/out/ (git-ignored).
import fs from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

import { env } from '../../src/config/env.js'
import { CRITERIA, RUBRIC_VERSION, criterionIds } from '../../src/modules/scores/rubrics.js'
import { averageCriteria, scoreFrom } from '../../src/modules/scores/score.js'
import { measureScore } from '../../src/modules/scores/service.js'
import type { ScoreKind } from '../../src/types/mongo.js'
import { normalizeBodyPhoto, normalizeSelfie } from '../../src/utils/images.js'
import type { Locale } from '../../src/utils/locale.js'
import { redactAiMessage } from '../../src/utils/openai.js'
import { withLocale } from '../../src/utils/request-locale.js'
import { LABEL_ORDER, PHOTOS, PHOTO_DIR, type Label, type TestPhoto } from './photos.js'

const OUT_DIR = new URL('./out/', import.meta.url).pathname
const RAW_SETTINGS = { offset: 0, floor: 1 }
const READS_A = 3
const MAX_CALLS = 170
const SPREAD_BAR = 6
const RANK_BAR = 0.8
const SHARE_BAR = 0.9
const TARGET = { average: [60, 65], good: [72, 80] } as const
const FLOOR = 35
// Prices are an assumption (USD per million tokens), not verified.
const PRICE = { input: 0.75, cached: 0.075, output: 4.5 }

type Sample = { usable: boolean; problem: string; photo: { light: string; framing: string }; criteria: Record<string, number> }
type Read = {
  photo: string
  kind: ScoreKind
  label: Label
  part: 'A' | 'B'
  n: number
  usable: boolean
  problem: string | null
  criteria: Record<string, number> | null
  samplesUsed: number
  score: number | null
  samples: (Sample & { score: number | null })[]
  light: string | null
  framing: string | null
  seconds: number
}
type Usage = { calls: number; input: number; cached: number; output: number }
type Raw = {
  startedAt: string
  model: string
  samples: number
  rubricVersion: string
  reads: Read[]
  stoppedBy: string | null
  usage: Usage
  settingsSeen: string[]
  localeCheck: LocaleCheck
}
type LocaleCheck = { identical: boolean; locales: string[]; languageLine: boolean; settings: string; calls: number }

const round1 = (value: number) => Math.round(value * 10) / 10
const mean = (values: number[]) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : NaN)
const spreadOf = (values: number[]) => (values.length ? Math.max(...values) - Math.min(...values) : NaN)
const score0 = (kind: ScoreKind, criteria: Record<string, number>) => scoreFrom(criteria, criterionIds(kind), RAW_SETTINGS)

// ---------------------------------------------------------------- C: language (offline)

// The measuring request under every request language, with fetch stubbed:
// nothing leaves the machine.
async function checkLocale(): Promise<LocaleCheck> {
  const realFetch = globalThis.fetch
  const bodies: string[] = []
  const tiny = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#888888' } })
    .jpeg()
    .toBuffer()
  const ids = criterionIds('look')
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''))
    const sample = { usable: true, problem: 'none', photo: { light: 'good', framing: 'good' }, criteria: Object.fromEntries(ids.map((id) => [id, 2])) }

    return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(sample) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  const locales: (Locale | 'none')[] = ['none', 'en', 'pt-BR', 'es']

  try {
    for (const locale of locales) {
      await (locale === 'none' ? measureScore('look', tiny) : withLocale(locale, () => measureScore('look', tiny)))
    }
  } finally {
    globalThis.fetch = realFetch
  }

  const parsed = bodies.map((body) => JSON.parse(body) as { model: string; reasoning: unknown; temperature?: number; store?: boolean; instructions: string })

  return {
    identical: bodies.every((body) => body === bodies[0]),
    locales,
    languageLine: parsed.some((body) => body.instructions.includes('Language:')),
    settings: JSON.stringify({ model: parsed[0]?.model, reasoning: parsed[0]?.reasoning, temperature: parsed[0]?.temperature, store: parsed[0]?.store }),
    calls: bodies.length,
  }
}

// ---------------------------------------------------------------- A and B: the run

async function run(): Promise<Raw> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing from .env.')
  }

  const missing = PHOTOS.filter((photo) => !fs.existsSync(path.join(PHOTO_DIR, `${photo.id}.png`)))

  if (missing.length) {
    throw new Error(`Missing photos (run generate-photos.ts): ${missing.map((photo) => photo.id).join(', ')}`)
  }

  const plannedCalls = PHOTOS.length * (READS_A + 1) * env.SCORE_SAMPLES

  if (plannedCalls > MAX_CALLS) {
    throw new Error(`The plan needs ${plannedCalls} measuring calls; at most ${MAX_CALLS}.`)
  }

  const localeCheck = await checkLocale()
  console.log(`C. measuring request identical in ${localeCheck.locales.join(', ')}: ${localeCheck.identical} (language line: ${localeCheck.languageLine}; ${localeCheck.settings})`)

  // Each photo as production would get it: A the upload, B a re-saved copy.
  const inputs = new Map<string, { a: Buffer; b: Buffer }>()

  for (const photo of PHOTOS) {
    const original = fs.readFileSync(path.join(PHOTO_DIR, `${photo.id}.png`))
    const normalize = photo.kind === 'look' ? normalizeBodyPhoto : normalizeSelfie
    const meta = await sharp(original).metadata()
    const width = Math.round(meta.width! * 0.95)
    const height = Math.round(meta.height! * 0.95)
    const resaved = await sharp(original)
      .extract({ left: Math.round((meta.width! - width) / 2), top: Math.round((meta.height! - height) / 2), width, height })
      .jpeg({ quality: 70 })
      .toBuffer()
    inputs.set(photo.id, { a: await normalize(original), b: await normalize(resaved) })
  }

  const usage: Usage = { calls: 0, input: 0, cached: 0, output: 0 }
  const settingsSeen = new Set<string>()
  let captured: Sample[] = []
  let apiError: string | null = null

  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)

    if (!url.endsWith('/responses')) {
      return realFetch(input, init)
    }

    if (apiError) {
      throw new Error(`not called: stopped after an API error (${apiError})`)
    }

    if (usage.calls >= MAX_CALLS) {
      apiError = `the cap of ${MAX_CALLS} measuring calls`
      throw new Error(`not called: ${apiError}`)
    }

    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; reasoning?: unknown; temperature?: number; store?: boolean }
    settingsSeen.add(JSON.stringify({ model: body.model, reasoning: body.reasoning, temperature: body.temperature, store: body.store }))
    usage.calls += 1

    const response = await realFetch(input, init)
    const payload = (await response
      .clone()
      .json()
      .catch(() => ({}))) as {
      error?: { message?: string }
      output_text?: string
      output?: { type?: string; content?: { type?: string; text?: string }[] }[]
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }
    }

    if (!response.ok) {
      apiError = `HTTP ${response.status}: ${redactAiMessage(payload.error?.message ?? 'no message')}`
      return response
    }

    const cached = payload.usage?.input_tokens_details?.cached_tokens ?? 0
    usage.input += (payload.usage?.input_tokens ?? 0) - cached
    usage.cached += cached
    usage.output += payload.usage?.output_tokens ?? 0

    const text =
      payload.output_text ??
      (payload.output ?? [])
        .flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []))
        .map((chunk) => (chunk.type === 'output_text' ? (chunk.text ?? '') : ''))
        .join('')

    try {
      captured.push(JSON.parse(text) as Sample)
    } catch {
      // measureScore will fail on it too, and say so.
    }

    return response
  }) as typeof fetch

  // Round by round (every photo's first read, then its second...), so a run
  // cut short is still balanced.
  const plan: { photo: TestPhoto; part: 'A' | 'B'; n: number }[] = [
    ...Array.from({ length: READS_A }, (_, index) => PHOTOS.map((photo) => ({ photo, part: 'A' as const, n: index + 1 }))).flat(),
    ...PHOTOS.map((photo) => ({ photo, part: 'B' as const, n: 1 })),
  ]
  const startedAt = new Date().toISOString()
  const rawFile = path.join(OUT_DIR, `raw-${startedAt.replace(/[:.]/g, '-')}.json`)
  const reads: Read[] = []
  let stoppedBy: string | null = null

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const snapshot = (): Raw => ({
    startedAt,
    model: env.SCORE_MEASURE_MODEL,
    samples: env.SCORE_SAMPLES,
    rubricVersion: RUBRIC_VERSION,
    reads,
    stoppedBy,
    usage,
    settingsSeen: [...settingsSeen],
    localeCheck,
  })

  for (const step of plan) {
    captured = []
    const started = Date.now()
    const { kind, id, label } = step.photo

    try {
      const measured = await measureScore(kind, step.part === 'A' ? inputs.get(id)!.a : inputs.get(id)!.b)

      if (apiError) {
        throw new Error(apiError)
      }

      const read: Read = {
        photo: id,
        kind,
        label,
        part: step.part,
        n: step.n,
        usable: measured.usable,
        problem: measured.usable ? null : measured.problem,
        criteria: measured.usable ? measured.criteria : null,
        samplesUsed: measured.usable ? measured.samples : 0,
        score: measured.usable ? score0(kind, measured.criteria) : null,
        samples: captured.map((sample) => ({ ...sample, score: sample.usable && sample.problem === 'none' ? score0(kind, sample.criteria) : null })),
        light: measured.photo?.light ?? null,
        framing: measured.photo?.framing ?? null,
        seconds: (Date.now() - started) / 1000,
      }
      reads.push(read)
      fs.writeFileSync(rawFile, JSON.stringify(snapshot(), null, 2))
      console.log(
        `${step.part}${step.n} ${id} (${label}): ${read.usable ? read.score : `unusable ${read.problem}`} ` +
          `samples ${read.samples.map((sample) => sample.score ?? sample.problem).join('/')} ${JSON.stringify(read.criteria)} ${read.seconds.toFixed(1)} s`,
      )
    } catch (error) {
      stoppedBy = `${step.part}${step.n} ${id}: ${apiError ?? redactAiMessage((error as Error).message)}`
      console.error(`Stopped at the first API error: ${stoppedBy}`)
      break
    }
  }

  globalThis.fetch = realFetch
  fs.writeFileSync(rawFile, JSON.stringify(snapshot(), null, 2))
  console.log(`Raw reads: ${rawFile}`)

  return snapshot()
}

// ---------------------------------------------------------------- analysis

// Spearman's rho: Pearson on ranks, ties given their average rank.
function ranks(values: number[]) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = new Array<number>(values.length)
  let start = 0

  while (start < order.length) {
    let end = start

    while (end + 1 < order.length && order[end + 1]!.value === order[start]!.value) {
      end += 1
    }

    for (let position = start; position <= end; position += 1) {
      result[order[position]!.index] = (start + end) / 2 + 1
    }

    start = end + 1
  }

  return result
}

function pearson(x: number[], y: number[]) {
  const mx = mean(x)
  const my = mean(y)
  const cov = x.reduce((total, value, index) => total + (value - mx) * (y[index]! - my), 0)
  const vx = x.reduce((total, value) => total + (value - mx) ** 2, 0)
  const vy = y.reduce((total, value) => total + (value - my) ** 2, 0)

  return vx && vy ? cov / Math.sqrt(vx * vy) : NaN
}

const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y))

function analyse(raw: Raw) {
  const kinds: ScoreKind[] = ['look', 'hair']

  const photos = PHOTOS.filter((photo) => raw.reads.some((read) => read.photo === photo.id)).map((photo) => {
    const reads = raw.reads.filter((read) => read.photo === photo.id).sort((a, b) => (a.part === b.part ? a.n - b.n : a.part === 'A' ? -1 : 1))
    const usable = reads.filter((read) => read.usable)
    const scores = usable.map((read) => read.score!)
    const scoresA = usable.filter((read) => read.part === 'A').map((read) => read.score!)
    const readB = usable.find((read) => read.part === 'B')
    // SCORE_SAMPLES 1: the first sample of each read, then every sample.
    const firstSamples = reads.map((read) => read.samples[0]?.score).filter((value): value is number => typeof value === 'number')
    const allSamples = reads.flatMap((read) => read.samples.map((sample) => sample.score)).filter((value): value is number => typeof value === 'number')
    // SCORE_SAMPLES 3, simulated: the six A samples as two disjoint triples.
    const aSamples = reads.filter((read) => read.part === 'A').flatMap((read) => read.samples.filter((sample) => sample.score !== null))
    const ids = criterionIds(photo.kind)
    const triples =
      aSamples.length >= 6
        ? [aSamples.slice(0, 3), aSamples.slice(3, 6)].map((triple) =>
            score0(
              photo.kind,
              averageCriteria(
                triple.map((sample) => sample.criteria),
                ids,
              ),
            ),
          )
        : []
    // Like for like: the gap between two reads of the same photo with 1, 2
    // or 3 samples each, from the same six A samples (disjoint groups).
    const groupScore = (group: typeof aSamples) =>
      score0(
        photo.kind,
        averageCriteria(
          group.map((sample) => sample.criteria),
          ids,
        ),
      )
    const gaps =
      aSamples.length >= 6
        ? {
            1: [0, 2, 4].map((start) => Math.abs(aSamples[start]!.score! - aSamples[start + 1]!.score!)),
            2: [
              [0, 2],
              [0, 4],
              [2, 4],
            ].map(([a, b]) => Math.abs(groupScore(aSamples.slice(a!, a! + 2)) - groupScore(aSamples.slice(b!, b! + 2)))),
            3: [Math.abs(triples[0]! - triples[1]!)],
          }
        : null
    const criterionRange = Object.fromEntries(ids.map((id) => [id, round1(spreadOf(usable.map((read) => read.criteria![id]!)))]))
    const criterionSampleRange = Object.fromEntries(
      ids.map((id) => [id, spreadOf(reads.flatMap((read) => read.samples.filter((sample) => sample.score !== null).map((sample) => sample.criteria[id]!)))]),
    )
    const meanA = mean(scoresA)

    return {
      id: photo.id,
      kind: photo.kind,
      label: photo.label,
      note: photo.note,
      reads,
      unusable: reads.length - usable.length,
      scores,
      scoresA,
      scoreB: readB?.score ?? null,
      spread: reads.length - usable.length ? Infinity : spreadOf(scores),
      spreadA: spreadOf(scoresA),
      meanA: round1(meanA),
      meanAll: round1(mean(scores)),
      resaveShift: readB ? round1(readB.score! - meanA) : null,
      firstSamples,
      spread1: spreadOf(firstSamples),
      allSamples,
      spreadSamples: spreadOf(allSamples),
      triples,
      spread3: triples.length === 2 ? spreadOf(triples) : null,
      gaps,
      criterionRange,
      criterionSampleRange,
      light: [...new Set(reads.map((read) => read.light))].join('/'),
    }
  })

  const share = (values: number[], bar: number) => (values.length ? values.filter((value) => value <= bar).length / values.length : NaN)
  const finite = (values: number[]) => values.filter((value) => Number.isFinite(value))

  const summarize = (kind: ScoreKind) => {
    const rows = photos.filter((photo) => photo.kind === kind)
    const ids = criterionIds(kind)
    const labels = LABEL_ORDER.filter((label) => rows.some((row) => row.label === label))
    const ordinal = rows.map((row) => LABEL_ORDER.indexOf(row.label))
    const means = rows.map((row) => row.meanA)
    // The best rho possible with these label ties (a perfect ordering).
    const ceiling = spearman(
      ordinal.map((value, index) => value * 1000 + index),
      ordinal,
    )
    const reads = raw.reads.filter((read) => read.kind === kind && read.usable)
    const samples = raw.reads.filter((read) => read.kind === kind).flatMap((read) => read.samples.filter((sample) => sample.score !== null))
    const pairs = raw.reads.filter((read) => read.kind === kind && read.samples.filter((sample) => sample.score !== null).length >= 2)

    const criteria = ids.map((id) => ({
      id,
      name: CRITERIA[kind].find((criterion) => criterion.id === id)!.name,
      // Across the 4 reads of a photo (2-sample averages).
      meanRange: round1(mean(rows.map((row) => row.criterionRange[id]!))),
      photosMoving: rows.filter((row) => row.criterionRange[id]! > 0).length,
      // Within one read: the two samples disagree.
      pairDisagree: pairs.length ? round1((pairs.filter((read) => read.samples[0]!.criteria[id] !== read.samples[1]!.criteria[id]).length / pairs.length) * 100) : null,
      // Across all 8 samples of a photo.
      sampleRangeMax: Math.max(...rows.map((row) => row.criterionSampleRange[id]!)),
      photosSampleMoving: rows.filter((row) => row.criterionSampleRange[id]! > 0).length,
      perLabel: Object.fromEntries(
        labels.map((label) => [label, round1(mean(reads.filter((read) => read.label === label && read.part === 'A').map((read) => read.criteria![id]!)))]),
      ) as Partial<Record<Label, number>>,
      // How often each rating is used, over every sample.
      histogram: [0, 1, 2, 3, 4].map((rating) => samples.filter((sample) => sample.criteria[id] === rating).length),
    }))

    return {
      photos: rows.length,
      reads: raw.reads.filter((read) => read.kind === kind).length,
      unusableReads: raw.reads.filter((read) => read.kind === kind && !read.usable).map((read) => `${read.photo} ${read.part}${read.n}: ${read.problem}`),
      meanSpread: round1(mean(finite(rows.map((row) => row.spread)))),
      maxSpread: Math.max(...rows.map((row) => row.spread)),
      shareSpread: share(
        rows.map((row) => row.spread),
        SPREAD_BAR,
      ),
      meanSpreadA: round1(mean(finite(rows.map((row) => row.spreadA)))),
      shareSpreadA: share(
        rows.map((row) => row.spreadA),
        SPREAD_BAR,
      ),
      meanSpread1: round1(mean(finite(rows.map((row) => row.spread1)))),
      maxSpread1: Math.max(...rows.map((row) => row.spread1)),
      shareSpread1: share(
        rows.map((row) => row.spread1),
        SPREAD_BAR,
      ),
      meanSpread3: round1(mean(finite(rows.map((row) => row.spread3 ?? NaN)))),
      shareSpread3: share(finite(rows.map((row) => row.spread3 ?? NaN)), SPREAD_BAR),
      meanResaveShift: round1(mean(finite(rows.map((row) => row.resaveShift ?? NaN)))),
      maxResaveShift: Math.max(...rows.map((row) => Math.abs(row.resaveShift ?? 0))),
      spearman: Math.round(spearman(means, ordinal) * 1000) / 1000,
      spearmanCeiling: Math.round(ceiling * 1000) / 1000,
      // Halo: reads whose five ratings are all the same, and pairs of
      // criteria that agree on nearly every read (one judgment counted twice).
      lockstep: reads.length ? reads.filter((read) => new Set(ids.map((id) => read.criteria![id])).size === 1).length / reads.length : NaN,
      sameAs: ids
        .flatMap((a, index) =>
          ids.slice(index + 1).map((b) => ({ pair: `${a} = ${b}`, share: reads.filter((read) => read.criteria![a] === read.criteria![b]).length / Math.max(1, reads.length) })),
        )
        .filter((pair) => pair.share >= 0.9)
        .sort((x, y) => y.share - x.share),
      distinctScores: [...new Set(reads.map((read) => read.score!))].sort((a, b) => a - b),
      perLabel: Object.fromEntries(labels.map((label) => [label, round1(mean(rows.filter((row) => row.label === label).map((row) => row.meanA)))])) as Partial<
        Record<Label, number>
      >,
      criteria,
    }
  }
  const byKind = { look: summarize('look'), hair: summarize('hair') }

  // SCORE_OFFSET is one value for both scores: the offsets that put each
  // kind's average photos in 60–65 and good in 72–80, and the one that fits
  // both (or, when none does, the least-squares compromise).
  const centre = (range: readonly [number, number]) => (range[0] + range[1]) / 2
  const intervals = kinds
    .filter((kind) => byKind[kind].perLabel.average !== undefined && byKind[kind].perLabel.good !== undefined)
    .map((kind) => {
      const avg = byKind[kind].perLabel.average!
      const good = byKind[kind].perLabel.good!

      return {
        kind,
        low: round1(Math.max(TARGET.average[0] - avg, TARGET.good[0] - good)),
        high: round1(Math.min(TARGET.average[1] - avg, TARGET.good[1] - good)),
        best: round1((centre(TARGET.average) - avg + centre(TARGET.good) - good) / 2),
        gap: round1(good - avg),
      }
    })
  const low = Math.max(...intervals.map((interval) => interval.low))
  const high = Math.min(...intervals.map((interval) => interval.high))
  const shared = low <= high ? Math.round((low + high) / 2) : Math.round(mean(intervals.map((interval) => interval.best)))
  const offset = Math.max(-30, Math.min(30, shared))

  const shifted = (kind: ScoreKind, criteria: Record<string, number>) => scoreFrom(criteria, criterionIds(kind), { offset, floor: 1 })
  const withOffset = Object.fromEntries(
    kinds.map((kind) => {
      const rows = photos.filter((photo) => photo.kind === kind)
      const labels = LABEL_ORDER.filter((label) => rows.some((row) => row.label === label))
      const reads = raw.reads.filter((read) => read.kind === kind && read.usable)
      const samples = raw.reads.filter((read) => read.kind === kind).flatMap((read) => read.samples.filter((sample) => sample.score !== null))

      return [
        kind,
        {
          perLabel: Object.fromEntries(
            labels.map((label) => [label, round1(mean(reads.filter((read) => read.label === label && read.part === 'A').map((read) => shifted(kind, read.criteria!))))]),
          ),
          belowFloorReads: reads
            .filter((read) => shifted(kind, read.criteria!) < FLOOR)
            .map((read) => `${read.photo} ${read.part}${read.n} (${read.label}) ${shifted(kind, read.criteria!)}`),
          belowFloorSamples: samples.filter((sample) => shifted(kind, sample.criteria) < FLOOR).length,
          samples: samples.length,
          lowest: Math.min(...reads.map((read) => shifted(kind, read.criteria!))),
          capped: reads.filter((read) => (read.score ?? 0) + offset > 99).length,
        },
      ]
    }),
  )

  const allRows = photos
  const checks = {
    completed: !raw.stoppedBy && raw.reads.length === PHOTOS.length * (READS_A + 1),
    spreadShare: share(
      allRows.map((row) => row.spread),
      SPREAD_BAR,
    ),
    spreadPass:
      share(
        allRows.map((row) => row.spread),
        SPREAD_BAR,
      ) >= SHARE_BAR,
    spearmanLook: byKind.look.spearman,
    spearmanHair: byKind.hair.spearman,
    rankPass: byKind.look.spearman >= RANK_BAR && byKind.hair.spearman >= RANK_BAR,
    languageIndependent: raw.localeCheck.identical && !raw.localeCheck.languageLine,
  }
  const oneSampleShare = share(
    allRows.map((row) => row.spread1),
    SPREAD_BAR,
  )
  const threeSampleShare = share(finite(allRows.map((row) => row.spread3 ?? NaN)), SPREAD_BAR)
  // Two reads of the same photo within SPREAD_BAR, with 1, 2 or 3 samples each.
  const gapShare = (k: 1 | 2 | 3) =>
    share(
      allRows.flatMap((row) => row.gaps?.[k] ?? []),
      SPREAD_BAR,
    )
  const gapMean = (k: 1 | 2 | 3) => round1(mean(allRows.flatMap((row) => row.gaps?.[k] ?? [])))
  const pairs = { 1: { share: gapShare(1), mean: gapMean(1) }, 2: { share: gapShare(2), mean: gapMean(2) }, 3: { share: gapShare(3), mean: gapMean(3) } }
  const recommendSamples = oneSampleShare >= SHARE_BAR ? 1 : checks.spreadShare >= SHARE_BAR ? 2 : pairs[3].share - pairs[2].share >= 0.1 ? 3 : 2

  return {
    photos,
    byKind,
    offset: { intervals, shared: offset, fits: low <= high, low: round1(low), high: round1(high), withOffset },
    checks,
    passed: checks.completed && checks.spreadPass && checks.rankPass && checks.languageIndependent,
    samples: { oneSampleShare, twoSampleShare: checks.spreadShare, threeSampleShare, pairs, recommend: recommendSamples },
  }
}

// ---------------------------------------------------------------- report

const pct = (value: number) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'n/a')
const num = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : String(value))

function report(raw: Raw, result: ReturnType<typeof analyse>) {
  const lines: string[] = []
  const cost = (raw.usage.input * PRICE.input + raw.usage.cached * PRICE.cached + raw.usage.output * PRICE.output) / 1_000_000

  lines.push(`# Look Score and Hair Score calibration`, '')
  lines.push(
    `Run ${raw.startedAt}. Model \`${raw.model}\`, SCORE_SAMPLES ${raw.samples}, rubric \`${raw.rubricVersion}\`. Scores below use SCORE_OFFSET 0 and SCORE_FLOOR 1 (raw) unless said otherwise.`,
  )
  lines.push(
    `${raw.reads.length} reads, ${raw.usage.calls} measuring calls, about $${cost.toFixed(3)} at assumed prices (${raw.usage.input + raw.usage.cached} input tokens, ${raw.usage.cached} cached, ${raw.usage.output} output). Settings sent: ${raw.settingsSeen.join(' ')}.`,
  )
  lines.push(raw.stoppedBy ? `**Stopped early:** ${raw.stoppedBy}` : 'Completed without API errors.', '')

  lines.push('## Verdict', '')
  lines.push(`| Check | Bar | Result | |`, `|---|---|---|---|`)
  lines.push(
    `| Spread ≤ ${SPREAD_BAR} points (all 4 reads, ${raw.samples} samples) | ≥ ${pct(SHARE_BAR)} of photos | ${pct(result.checks.spreadShare)} | ${result.checks.spreadPass ? 'pass' : 'FAIL'} |`,
  )

  for (const kind of ['look', 'hair'] as const) {
    const summary = result.byKind[kind]
    lines.push(`| … ${kind} photos only (for reference) | | ${pct(summary.shareSpread)} of ${summary.photos} | ${summary.shareSpread >= SHARE_BAR ? 'ok' : 'below'} |`)
  }

  lines.push(
    `| Spearman, Look Score | ≥ ${RANK_BAR} | ${result.checks.spearmanLook} (ceiling with these ties ${result.byKind.look.spearmanCeiling}) | ${result.checks.spearmanLook >= RANK_BAR ? 'pass' : 'FAIL'} |`,
  )
  lines.push(
    `| Spearman, Hair Score | ≥ ${RANK_BAR} | ${result.checks.spearmanHair} (ceiling ${result.byKind.hair.spearmanCeiling}) | ${result.checks.spearmanHair >= RANK_BAR ? 'pass' : 'FAIL'} |`,
  )
  lines.push(
    `| Measuring call independent of request language | identical | ${result.checks.languageIndependent ? 'identical' : 'DIFFERS'} | ${result.checks.languageIndependent ? 'pass' : 'FAIL'} |`,
  )
  lines.push('', `**${result.passed ? 'Pass bar met.' : 'Pass bar NOT met.'}**`, '')

  lines.push('## Recommendation', '')
  lines.push(
    `- **SCORE_OFFSET = ${result.offset.shared}** (one value for both scores). ${
      result.offset.fits
        ? `Offsets from ${result.offset.low} to ${result.offset.high} put both kinds' average photos in 60–65 and good ones in 72–80.`
        : 'No single offset puts both kinds in both target bands; this is the least-squares compromise.'
    }`,
  )

  for (const interval of result.offset.intervals) {
    lines.push(
      `  - ${interval.kind}: offsets ${interval.low}…${interval.high} would fit (${interval.low <= interval.high ? 'possible' : 'impossible: good − average gap is ' + interval.gap + ' points, the bands need 7–20'}), best alone ${interval.best}.`,
    )
  }

  for (const kind of ['look', 'hair'] as const) {
    const shifted = result.offset.withOffset[kind]!
    lines.push(
      `  - With ${result.offset.shared}, ${kind} means: ${Object.entries(shifted.perLabel)
        .map(([label, value]) => `${label} ${value}`)
        .join(
          ', ',
        )}; lowest read ${shifted.lowest}; SCORE_FLOOR ${FLOOR} would bind on ${shifted.belowFloorReads.length} reads${shifted.belowFloorReads.length ? ` (${shifted.belowFloorReads.join('; ')})` : ''} and ${shifted.belowFloorSamples} of ${shifted.samples} single samples; ${shifted.capped} reads would hit the 99 cap.`,
    )
  }

  lines.push(
    `- **SCORE_SAMPLES = ${result.samples.recommend}.** Share of photos with spread ≤ ${SPREAD_BAR}: 1 sample ${pct(result.samples.oneSampleShare)} (first sample of each read), 2 samples ${pct(result.samples.twoSampleShare)} (real), 3 samples ${pct(result.samples.threeSampleShare)} (simulated from two disjoint triples of the A samples, one spread per photo, so optimistic).`,
    `  - Like for like (two reads of the same photo, from disjoint groups of the six A samples): within ${SPREAD_BAR} points ${[1, 2, 3].map((k) => `${k} sample${k > 1 ? 's' : ''} ${pct(result.samples.pairs[k as 1 | 2 | 3].share)} (mean gap ${result.samples.pairs[k as 1 | 2 | 3].mean})`).join(', ')}.`,
    '',
  )

  lines.push('## C. Language', '')
  lines.push(
    `The measuring call passes \`locale: 'en'\` explicitly (service.ts \`measureOnce\`), and \`localizeInstructions\` returns English instructions unchanged. Checked offline with a stubbed fetch (${raw.localeCheck.calls} requests, no API calls): the request body is ${raw.localeCheck.identical ? 'byte-identical' : 'NOT identical'} with no request language and under ${raw.localeCheck.locales.filter((locale) => locale !== 'none').join(', ')}; ${raw.localeCheck.languageLine ? 'a Language line WAS added' : 'no Language line is added'}. Settings: ${raw.localeCheck.settings}. Only the words call (writeWords) uses her language, and it cannot change the ratings.`,
    '',
  )

  for (const kind of ['look', 'hair'] as const) {
    const summary = result.byKind[kind]
    const rows = result.photos.filter((photo) => photo.kind === kind)
    const ids = criterionIds(kind)
    lines.push(`## ${kind === 'look' ? 'Look Score' : 'Hair Score'}`, '')
    lines.push(
      `- Spread (all 4 reads): mean ${summary.meanSpread}, max ${num(summary.maxSpread)}, ≤ ${SPREAD_BAR} on ${pct(summary.shareSpread)} of photos. A reads only: mean ${summary.meanSpreadA}, ≤ ${SPREAD_BAR} on ${pct(summary.shareSpreadA)}.`,
    )
    lines.push(
      `- 1 sample per read: mean spread ${summary.meanSpread1}, max ${num(summary.maxSpread1)}, ≤ ${SPREAD_BAR} on ${pct(summary.shareSpread1)}. 3 samples (simulated): mean ${summary.meanSpread3}, ≤ ${SPREAD_BAR} on ${pct(summary.shareSpread3)}.`,
    )
    lines.push(`- Re-saved copy (B) minus the mean of the A reads: mean ${summary.meanResaveShift}, largest ${summary.maxResaveShift}.`)
    lines.push(`- Spearman (mean A score vs label): **${summary.spearman}** (ceiling ${summary.spearmanCeiling}).`)
    lines.push(
      `- Mean raw score per label: ${Object.entries(summary.perLabel)
        .map(([label, value]) => `${label} **${value}**`)
        .join(', ')}.`,
    )
    lines.push(`- Unusable reads: ${summary.unusableReads.length ? summary.unusableReads.join('; ') : 'none'}.`)
    lines.push(
      `- Halo: all five ratings the same on ${pct(summary.lockstep)} of reads; criteria equal on ≥ 90% of reads: ${summary.sameAs.map((pair) => `${pair.pair} (${pct(pair.share)})`).join(', ') || 'none'}. Distinct scores seen: ${summary.distinctScores.join(', ')}.`,
      '',
    )

    lines.push('| Photo | Label | A1 | A2 | A3 | B (re-saved) | Spread | Mean A | Single samples (A1 A2 A3 B) | Light |', '|---|---|---|---|---|---|---|---|---|---|')

    for (const row of rows) {
      const cell = (part: 'A' | 'B', n: number) => {
        const read = row.reads.find((item) => item.part === part && item.n === n)
        return read ? (read.usable ? String(read.score) : `unusable (${read.problem})`) : '–'
      }
      const singles = row.reads.map((read) => read.samples.map((sample) => sample.score ?? sample.problem).join('/')).join(' · ')
      lines.push(
        `| ${row.id} | ${row.label} | ${cell('A', 1)} | ${cell('A', 2)} | ${cell('A', 3)} | ${cell('B', 1)} | ${Number.isFinite(row.spread) ? row.spread : 'unusable read'} | ${row.meanA} | ${singles} | ${row.light} |`,
      )
    }

    lines.push('', `Criteria per read (2-sample averages, 0–4: ${ids.join(', ')}):`, '')
    lines.push(`| Photo | Label | ${['A1', 'A2', 'A3', 'B'].join(' | ')} | Moving criteria (range) |`, '|---|---|---|---|---|---|---|')

    for (const row of rows) {
      const cell = (part: 'A' | 'B', n: number) => {
        const read = row.reads.find((item) => item.part === part && item.n === n)
        return read?.criteria ? ids.map((id) => read.criteria![id]).join(' ') : '–'
      }
      const moving = ids.filter((id) => row.criterionRange[id]! > 0).map((id) => `${id} ${row.criterionRange[id]}`)
      lines.push(`| ${row.id} | ${row.label} | ${cell('A', 1)} | ${cell('A', 2)} | ${cell('A', 3)} | ${cell('B', 1)} | ${moving.join(', ') || 'none'} |`)
    }

    lines.push('', 'Per criterion:', '')
    lines.push(
      `| Criterion | Mean range across reads | Photos moving (reads) | Photos moving (any sample) | Two samples disagree | ${LABEL_ORDER.filter((label) => summary.perLabel[label] !== undefined).join(' | ')} | Ratings used 0/1/2/3/4 |`,
      `|---|---|---|---|---|${LABEL_ORDER.filter((label) => summary.perLabel[label] !== undefined)
        .map(() => '---')
        .join('|')}|---|`,
    )

    for (const criterion of summary.criteria) {
      lines.push(
        `| ${criterion.id} (${criterion.name}) | ${criterion.meanRange} | ${criterion.photosMoving}/${summary.photos} | ${criterion.photosSampleMoving}/${summary.photos} | ${criterion.pairDisagree}% | ${LABEL_ORDER.filter(
          (label) => summary.perLabel[label] !== undefined,
        )
          .map((label) => criterion.perLabel[label])
          .join(' | ')} | ${criterion.histogram.join('/')} |`,
      )
    }

    lines.push('')
  }

  lines.push('## Photos', '')
  lines.push(`Fictional, AI-generated (gpt-image-2, text prompts only) in \`${PHOTO_DIR}\`. Labels are what each was made to be:`, '')

  for (const photo of PHOTOS) {
    lines.push(`- ${photo.id} (${photo.label}): ${photo.note}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------- main

const fromIndex = process.argv.indexOf('--from')
const raw: Raw = fromIndex > 0 ? (JSON.parse(fs.readFileSync(process.argv[fromIndex + 1]!, 'utf8')) as Raw) : await run()
const result = analyse(raw)
const stamp = raw.startedAt.replace(/[:.]/g, '-')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'report.md'), report(raw, result) + '\n')
fs.writeFileSync(
  path.join(OUT_DIR, `consistency-${stamp}.json`),
  JSON.stringify({ meta: { ...raw, reads: undefined }, result: { ...result, photos: result.photos.map(({ reads: _reads, ...row }) => row) }, reads: raw.reads }, null, 2),
)

console.log('')
console.log(`Reads ${raw.reads.length}, calls ${raw.usage.calls}${raw.stoppedBy ? `, stopped: ${raw.stoppedBy}` : ''}`)

for (const kind of ['look', 'hair'] as const) {
  const summary = result.byKind[kind]
  console.log(
    `${kind}: spread mean ${summary.meanSpread} max ${summary.maxSpread}, ≤${SPREAD_BAR} ${pct(summary.shareSpread)} (1 sample ${pct(summary.shareSpread1)}), ` +
      `spearman ${summary.spearman}, per label ${JSON.stringify(summary.perLabel)}`,
  )
}

console.log(
  `SCORE_OFFSET ${result.offset.shared} (${result.offset.fits ? 'fits both' : 'compromise'}); with it: ${JSON.stringify(Object.fromEntries(Object.entries(result.offset.withOffset).map(([kind, value]) => [kind, value.perLabel])))}`,
)
console.log(
  `Floor ${FLOOR} binds on ${result.offset.withOffset.look!.belowFloorReads.length + result.offset.withOffset.hair!.belowFloorReads.length} reads. SCORE_SAMPLES ${result.samples.recommend}.`,
)
console.log(result.passed ? 'Pass bar met.' : 'Pass bar NOT met.')
console.log(`Report: ${path.join(OUT_DIR, 'report.md')}`)
process.exitCode = raw.stoppedBy ? 1 : 0
