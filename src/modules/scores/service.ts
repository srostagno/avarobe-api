import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { env } from '../../config/env.js'
import type { HairstyleDocument, ScoreCheckDocument, ScoreKind, ScoreProblem, ScoreReading, UserDocument } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { createStructuredResponse, toDataUrl } from '../../utils/openai.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { refusedSetting } from '../avatar/measure.js'
import { PaywallError, billingState, freeUsesLeft, hasPro, releaseFreeUse, useFreeUse } from '../billing/entitlements.js'
import { type Shows, buildMeasureInstructions, buildWordsInstructions, measureSchema, wordsSchema } from './prompts.js'
import { CRITERIA, PROBLEMS, RUBRIC_VERSION, TIP_AREAS, criterionIds } from './rubrics.js'
import { serializePerfect } from './perfect.js'
import { averageCriteria, currentScore, scoreFrom, weakestFirst } from './score.js'

// Look Score and Hair Score (Oct 17, 2026; Silvio: "a look scorer 1–100 that
// works like the Face Age timeline; the same for Hair"). She adds a photo
// (a full-body photo of her outfit, or of her hair); it's measured against
// the rubric, scored in code, explained in her language, and kept on her
// timeline. Without Pro: SCORE_FREE_PHOTOS photos per kind, the score, the
// weakest criterion and the first tip; the rest is Pro's.

export const SCORE_CONSENT_VERSION = 'scores-2026-10-17'
export const SCORE_KINDS: ScoreKind[] = ['look', 'hair']
export const FREE_TIPS = 1
const TIMELINE_LIMIT = 300
const STALE_READ = 10 * 60 * 1000
const RUN_EVERY_MS = 15 * 60 * 1000

export const freeKind = (kind: ScoreKind): 'look_score' | 'hair_score' => (kind === 'look' ? 'look_score' : 'hair_score')

export class ScoreLimitError extends Error {}

// ---------------------------------------------------------------- allowance

// One read: today's allowance (looks and hair together), then without Pro
// one of her free photos of this kind. Returns whether a free one was used,
// so a photo that can't be read gives it back.
export async function claimScoreRead(app: FastifyInstance, userId: ObjectId, kind: ScoreKind) {
  if (!(await reserveGenerations(app, userId, 'score', 1))) {
    throw new ScoreLimitError(`You can add ${env.DAILY_SCORE_LIMIT} photos a day. More tomorrow.`)
  }

  if (await hasPro(app, userId)) {
    return { freeUse: false }
  }

  if (await useFreeUse(app, userId, freeKind(kind))) {
    return { freeUse: true }
  }

  await releaseGenerations(app, userId, 'score', 1)
  throw new PaywallError('needs_pro', kind === 'look' ? 'Scoring more looks comes with Avarobe Pro.' : 'Scoring your hair more comes with Avarobe Pro.')
}

// ---------------------------------------------------------------- reading

type MeasureRaw = {
  usable: boolean
  problem: ScoreProblem | 'none'
  shows?: Shows
  photo: ScoreReading['photo']
  criteria: Record<string, number>
}

type MeasureOptions = { partial?: boolean }

async function measureOnce(kind: ScoreKind, photo: Buffer, fixed: boolean, options: MeasureOptions = {}): Promise<MeasureRaw> {
  return createStructuredResponse<MeasureRaw>({
    instructions: buildMeasureInstructions(kind, options),
    content: [
      { type: 'input_text', text: kind === 'look' ? 'Rate this outfit.' : 'Rate this hair.' },
      { type: 'input_image', image_url: toDataUrl(photo, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: `${kind}_score_measure`,
    schema: measureSchema(kind, options),
    model: env.SCORE_MEASURE_MODEL,
    ...(fixed ? { reasoningEffort: 'none' as const, temperature: 0 } : {}),
    locale: 'en',
    store: false,
  })
}

// Fixed settings (reasoning none, temperature 0); a model that refuses them
// is measured the classic way rather than failing every read.
async function measure(kind: ScoreKind, photo: Buffer, options: MeasureOptions = {}) {
  try {
    return await measureOnce(kind, photo, true, options)
  } catch (error) {
    if (refusedSetting(error)) {
      return measureOnce(kind, photo, false, options)
    }

    throw error
  }
}

const problemOf = (kind: ScoreKind, value: string) => (PROBLEMS[kind] as string[]).includes(value) ? (value as ScoreProblem) : 'too_blurry'

// A slightly different copy of the photo (a 95% center crop, re-saved): at
// temperature 0 the same bytes give the same answer, so a second sample of
// the very same file adds nothing, while a re-saved photo can move a read
// (evals/scores, Oct 17). Measuring a copy too averages that out.
async function variantOf(photo: Buffer, index: number) {
  if (index === 0) {
    return photo
  }

  const meta = await sharp(photo).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const keep = 1 - 0.05 * index

  if (!width || !height) {
    return photo
  }

  const cropW = Math.round(width * keep)
  const cropH = Math.round(height * keep)

  return sharp(photo)
    .extract({ left: Math.round((width - cropW) / 2), top: Math.round((height - cropH) / 2), width: cropW, height: cropH })
    .jpeg({ quality: 85 })
    .toBuffer()
}

// SCORE_SAMPLES measurements at once (the photo, then slightly cropped
// copies). Any that sees a minor stops it; the photo is usable when most of
// them can rate it, and the usable ones are averaged.
export async function measureScore(kind: ScoreKind, photo: Buffer) {
  const samples = await Promise.all(
    Array.from({ length: env.SCORE_SAMPLES }, async (_, index) => measure(kind, await variantOf(photo, index))),
  )
  const minor = samples.find((sample) => sample.problem === 'minor')
  let usable = samples.filter((sample) => sample.usable && sample.problem === 'none')
  let salvaged = false

  // A look turned away for its framing although the read itself saw the
  // outfit (from the waist up, or more): Silvio's own selfie on Oct 17. It
  // is measured again with framing unable to reject it, and rated on what
  // shows (Silvio: "rank the look anyway").
  if (!minor && usable.length === 0 && kind === 'look') {
    const framed = samples.find((sample) => sample.problem === 'not_full_body' && (sample.shows === 'upper_body' || sample.shows === 'full_body'))

    if (framed) {
      const again = await measure(kind, photo, { partial: true })

      if (again.usable && again.problem === 'none') {
        usable = [{ ...again, photo: { ...again.photo, framing: 'partial' } }]
        salvaged = true
      }
    }
  }

  if (minor || usable.length === 0 || (!salvaged && usable.length * 2 < samples.length)) {
    const problem = minor ? 'minor' : problemOf(kind, samples.find((sample) => sample.problem !== 'none')?.problem ?? 'too_blurry')
    const rejected = minor ?? samples.find((sample) => sample.problem !== 'none') ?? samples[0]!
    return { usable: false as const, problem, shows: rejected.shows ?? null, photo: samples[0]!.photo }
  }

  const ids = criterionIds(kind)
  const criteria = averageCriteria(
    usable.map((sample) => sample.criteria),
    ids,
  )

  return { usable: true as const, criteria, samples: usable.length, photo: usable[0]!.photo }
}

type WordsRaw = Pick<ScoreReading, 'headline' | 'strengths' | 'holdingBack' | 'tips'>

async function writeWords(app: FastifyInstance, check: ScoreCheckDocument, photo: Buffer, criteria: Record<string, number>) {
  const user = await app.collections.users.findOne({ _id: check.userId })
  const avatar = await app.collections.avatars.findOne({ userId: check.userId }, { projection: { colorAnalysis: 1, hairProfile: 1 } })
  const ids = criterionIds(check.kind)
  const weakest = weakestFirst(criteria, ids).slice(0, 3)
  const analysis = avatar?.colorAnalysis ?? null
  const ownsColors = user ? billingState(user).colorReport : false
  const hair = check.kind === 'hair' && avatar?.hairProfile?.data ? avatar.hairProfile.data : null
  const raw = await createStructuredResponse<WordsRaw>({
    instructions: buildWordsInstructions({
      kind: check.kind,
      ratings: Object.fromEntries(ids.map((id) => [id, Math.round(criteria[id] ?? 0)])),
      weakest,
      palette: analysis ? { season: analysis.season, undertone: analysis.undertone, contrast: analysis.contrast } : null,
      bestColors: ownsColors && analysis ? analysis.bestColors.map((swatch) => swatch.name) : null,
      hair: hair ? { faceShape: hair.faceShape, texture: hair.hairType.texture, density: hair.hairType.density } : null,
    }),
    content: [
      { type: 'input_text', text: check.kind === 'look' ? 'Explain the rating of my outfit.' : 'Explain the rating of my hair.' },
      { type: 'input_image', image_url: toDataUrl(photo, 'image/jpeg'), detail: 'low' },
    ],
    schemaName: `${check.kind}_score_words`,
    schema: wordsSchema(check.kind),
    locale: user?.locale ?? 'en',
    store: false,
  })
  const areas = TIP_AREAS[check.kind]

  return {
    headline: raw.headline.trim(),
    strengths: raw.strengths.slice(0, 2),
    holdingBack: raw.holdingBack.slice(0, 2),
    // The first tip is the weakest criterion's (what free users see).
    tips: raw.tips
      .filter((tip) => tip.text.trim() && ids.includes(tip.criterion) && areas.includes(tip.area))
      .slice(0, 3)
      .sort((a, b) => Number(b.criterion === weakest[0]) - Number(a.criterion === weakest[0])),
  }
}

// A photo that can't be read: gone, and what it took given back. Her free
// photo comes back before the failure shows, so the page that sees it
// failed already counts it as hers again.
async function failCheck(app: FastifyInstance, check: ScoreCheckDocument, error: string) {
  await storage.remove(check.photoKey).catch(() => undefined)

  const claimed = await app.collections.scoreChecks.updateOne({ _id: check._id, status: 'processing', freeUse: true }, { $set: { freeUse: false } })

  if (claimed.modifiedCount) {
    await releaseFreeUse(app, check.userId, freeKind(check.kind))
  }

  const result = await app.collections.scoreChecks.updateOne(
    { _id: check._id, status: 'processing' },
    { $set: { status: 'failed', error, photoKey: '', updatedAt: new Date() } },
  )

  if (result.modifiedCount) {
    await releaseGenerations(app, check.userId, 'score', 1)
  }
}

export async function runScoreRead(app: FastifyInstance, checkId: ObjectId) {
  const check = await app.collections.scoreChecks.findOne({ _id: checkId })

  if (!check || check.status !== 'processing') {
    return
  }

  try {
    const photo = await storage.read(check.photoKey)
    const measured = await measureScore(check.kind, photo)

    if (!measured.usable) {
      await failCheck(app, check, `unreadable:${measured.problem}${measured.shows ? `:${measured.shows}` : ''}`)
      void trackServerEvent(app, { name: 'score_photo_read', userId: check.userId, props: { kind: check.kind, usable: false, problem: measured.problem } })
      return
    }

    const ids = criterionIds(check.kind)
    const score = scoreFrom(measured.criteria, ids, { offset: env.SCORE_OFFSET, floor: env.SCORE_FLOOR })
    const words = await writeWords(app, check, photo, measured.criteria)
    const reading: ScoreReading = {
      usable: true,
      problem: null,
      criteria: measured.criteria,
      samples: measured.samples,
      score,
      ...words,
      photo: measured.photo,
      rubricVersion: RUBRIC_VERSION,
      model: env.SCORE_MEASURE_MODEL,
    }

    await app.collections.scoreChecks.updateOne(
      { _id: checkId, status: 'processing' },
      { $set: { status: 'ready', reading, error: null, updatedAt: new Date() } },
    )
    void trackServerEvent(app, { name: 'score_photo_read', userId: check.userId, props: { kind: check.kind, usable: true, score } })
  } catch (error) {
    app.log.error({ err: errorMessage(error), checkId: checkId.toString() }, 'Score read failed')
    await failCheck(app, check, 'We could not read that photo. Try again in a moment.')
  }
}

export function startScoreRead(app: FastifyInstance, checkId: ObjectId) {
  void runScoreRead(app, checkId).catch((error: unknown) => {
    app.log.error({ err: error, checkId: checkId.toString() }, 'Score read crashed')
  })
}

// ---------------------------------------------------------------- state

// 'unreadable:<problem>' or 'unreadable:<problem>:<what it shows>'.
function unreadable(error: string | null) {
  if (!error?.startsWith('unreadable:')) {
    return null
  }

  const [problem, shows] = error.slice('unreadable:'.length).split(':')
  return { problem: problem as ScoreProblem, shows: (shows ?? null) as Shows | null }
}

// The studio a photo that couldn't be rated fits instead: a face photo in
// Look Score goes to Face Age (and Hair Score); an outfit photo in Hair
// Score, where the hair is too small, goes to Look Score. Never for a minor.
export function suggestFor(kind: ScoreKind, problem: ScoreProblem, shows: Shows | null): ('face_age' | 'look_score' | 'hair_score')[] {
  if (problem === 'minor' || problem === 'several_people' || !shows || shows === 'no_person') {
    return []
  }

  if (kind === 'look') {
    return shows === 'face' ? ['face_age', 'hair_score'] : shows === 'hair' ? ['hair_score'] : []
  }

  return shows === 'full_body' || shows === 'upper_body' ? ['look_score'] : shows === 'face' ? ['face_age'] : []
}

// Without Pro: the score, every criterion's name, the weakest one's rating
// and the first tip. The other ratings and tips never leave the server.
export async function serializeScoreCheck(check: ScoreCheckDocument, pro: boolean, perfect: HairstyleDocument | null = null) {
  const reading = check.status === 'ready' && check.reading?.usable ? check.reading : null
  const ids = criterionIds(check.kind)
  const weakest = reading ? weakestFirst(reading.criteria, ids)[0]! : null
  const failure = unreadable(check.error)
  const problem = failure?.problem ?? null

  return {
    id: check._id.toString(),
    kind: check.kind,
    status: check.status,
    problem,
    // Where a photo that couldn't be rated here fits instead.
    suggest: failure ? suggestFor(check.kind, failure.problem, failure.shows) : [],
    error: problem ? null : check.error,
    takenAt: check.takenAt.toISOString(),
    source: check.source,
    dateSource: check.dateSource,
    photoUrl: check.photoKey ? await signedUrlOrNull(check.photoKey) : null,
    score: reading?.score ?? null,
    reading: reading
      ? {
          headline: reading.headline,
          strengths: reading.strengths,
          holdingBack: reading.holdingBack,
          weakest,
          criteria: ids.map((id) => ({ id, value: pro || id === weakest ? reading.criteria[id] ?? 0 : null })),
          lockedCriteria: pro ? 0 : ids.length - 1,
          tips: (pro ? reading.tips : reading.tips.slice(0, FREE_TIPS)).map((tip) => ({ area: tip.area, criterion: tip.criterion, text: tip.text })),
          lockedTips: pro ? 0 : Math.max(0, reading.tips.length - FREE_TIPS),
          photo: reading.photo,
        }
      : null,
    fixLookId: check.fixLookId?.toString() ?? null,
    // "Unlock your perfect haircut" (hair, Pro): the haircut drawn from it.
    perfect: await serializePerfect(perfect),
    createdAt: check.createdAt.toISOString(),
  }
}

export type SerializedScoreCheck = Awaited<ReturnType<typeof serializeScoreCheck>>

// Everything the page shows: her release, her photos of this kind (newest
// first, by the day they're from), her score now and her best, and (Pro) her
// average per criterion.
export async function scoreState(app: FastifyInstance, user: UserDocument, kind: ScoreKind) {
  const billing = billingState(user)
  const pro = billing.proActive
  const freeLeft = pro ? null : freeUsesLeft(user.freeUses)[freeKind(kind)]
  const base = { kind, criteria: CRITERIA[kind].map((criterion) => criterion.id), allowance: { pro, freeLeft }, consentByTap: true }

  if (!user.scoreProfile) {
    return { ...base, profile: null, checks: [], summary: null }
  }

  const checks = await app.collections.scoreChecks.find({ userId: user._id, kind }).sort({ takenAt: -1, createdAt: -1 }).limit(TIMELINE_LIMIT).toArray()
  const perfectIds = checks.map((check) => check.perfectHairstyleId).filter((id): id is ObjectId => Boolean(id))
  const perfects = perfectIds.length ? await app.collections.hairstyles.find({ _id: { $in: perfectIds }, userId: user._id }).toArray() : []
  const perfectOf = new Map(perfects.map((hairstyle) => [hairstyle._id.toString(), hairstyle]))
  const serialized = await Promise.all(
    checks.map((check) => serializeScoreCheck(check, pro, check.perfectHairstyleId ? (perfectOf.get(check.perfectHairstyleId.toString()) ?? null) : null)),
  )
  const ready = checks.filter((check) => check.status === 'ready' && check.reading?.usable)
  const points = ready.map((check) => ({ takenAt: check.takenAt, score: check.reading!.score }))
  const ids = criterionIds(kind)
  const averages = ready.length
    ? Object.fromEntries(ids.map((id) => [id, Math.round((ready.reduce((total, check) => total + (check.reading!.criteria[id] ?? 0), 0) / ready.length) * 10) / 10]))
    : null

  return {
    ...base,
    profile: { guest: Boolean(user.guest), admin: billing.admin, consentAt: user.scoreProfile.consentAt.toISOString() },
    checks: serialized,
    summary: {
      score: currentScore(points),
      best: points.length ? Math.max(...points.map((point) => point.score)) : null,
      photos: points.length,
      firstAt: points.length ? points.reduce((first, point) => (point.takenAt < first ? point.takenAt : first), points[0]!.takenAt).toISOString() : null,
      // Pro: her average per criterion (where her points go).
      averages: pro ? averages : null,
    },
  }
}

// ---------------------------------------------------------------- deleting

export async function deleteScoreCheck(app: FastifyInstance, userId: ObjectId, kind: ScoreKind, checkId: ObjectId) {
  const check = await app.collections.scoreChecks.findOne({ _id: checkId, userId, kind }, { projection: { photoKey: 1 } })

  if (!check) {
    return false
  }

  await app.collections.scoreChecks.deleteOne({ _id: checkId, userId })

  if (check.photoKey) {
    await storage.remove(check.photoKey).catch(() => undefined)
  }

  return Boolean(check)
}

// Her photos of one kind (or all of them), and (`profile`) her release.
export async function deleteScoreData(app: FastifyInstance, userId: ObjectId, options: { kind?: ScoreKind; profile: boolean }) {
  const filter = { userId, ...(options.kind ? { kind: options.kind } : {}) }
  const checks = await app.collections.scoreChecks.find(filter, { projection: { photoKey: 1 } }).toArray()

  await Promise.all(checks.filter((check) => check.photoKey).map((check) => storage.remove(check.photoKey).catch(() => undefined)))
  await app.collections.scoreChecks.deleteMany(filter)

  if (options.profile) {
    await app.collections.users.updateOne({ _id: userId }, { $unset: { scoreProfile: '' } })
  }

  return { photos: checks.length }
}

// ---------------------------------------------------------------- jobs

// Reads a restart cut short: failed, the photo gone, what they took given back.
export async function failStaleScoreReads(app: FastifyInstance, now = new Date()) {
  const stuck = await app.collections.scoreChecks.find({ status: 'processing', updatedAt: { $lt: new Date(now.getTime() - STALE_READ) } }).toArray()

  for (const check of stuck) {
    await failCheck(app, check, 'We could not read that photo. Try again in a moment.')
  }

  return stuck.length
}

export function startScoreJobs(app: FastifyInstance) {
  const run = () => {
    void failStaleScoreReads(app).catch((error: unknown) => app.log.error({ err: error }, 'Score stale reads crashed'))
  }

  setTimeout(run, 60 * 1000).unref()
  setInterval(run, RUN_EVERY_MS).unref()
}
