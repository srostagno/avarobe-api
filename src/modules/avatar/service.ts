import { setTimeout as sleep } from 'node:timers/promises'

import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type {
  AvatarAdjustment,
  AvatarDocument,
  AvatarHair,
  AvatarJob,
  AvatarVersion,
  ColorAnalysis,
  ColorReadLog,
  ColorsFailure,
  ColorsNotify,
  ColorsSource,
} from '../../types/mongo.js'
import { env } from '../../config/env.js'
import { errorMessage } from '../../utils/http.js'
import { toPreviewWebp, toStoredWebp } from '../../utils/images.js'
import {
  type AiFailure,
  classifyAiError,
  createStructuredResponse,
  generateImageFromReferences,
  type ImageInput,
  OpenAiRequestError,
  redactAiMessage,
  toDataUrl,
} from '../../utils/openai.js'
import { toObjectId } from '../../utils/object-id.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { releaseAvatarRun } from '../billing/entitlements.js'
import { noteReadFailed, noteReadSucceeded } from '../ops/alerts.js'
import { startDrapePreview } from '../report/service.js'
import { deleteHairstyles } from '../hair/service.js'
import { deleteMakeupTryOns } from '../makeup/service.js'
import { buildApplyHairPrompt } from '../hair/prompts.js'
import { analysisHasForeignScript, cleanColorAnalysis } from './analysis.js'
import { bodyOf } from './body.js'
import { decideColors, type ColorDecision } from './decide.js'
import { PROVIDER_CODES, retryDelay } from './failures.js'
import { currentHair, orphanHairKeys } from './hair.js'
import { closeCall, measureColors, refusedSetting, scoredRead, writePalette, type Measurement, type ScoredRead } from './measure.js'
import { imageHash, loadColorsAccess, newReadId, readEntry, replacedKeys, settleFailedRead, settleRead, withRead } from './reads.js'
import { contrastOf, undertoneOf } from './seasons.js'
import {
  COHERENCE_RULES,
  COLOR_ANALYSIS_INSTRUCTIONS,
  buildAvatarPrompt,
  buildRefinePrompt,
  colorAnalysisSchema,
} from './prompts.js'

const MAX_VERSIONS = 6
const CREATE_FAILED = 'We could not finish your avatar. Please try again.'
const REFINE_FAILED = 'We could not apply those changes. Your avatar is unchanged; try again.'
const HAIR_FAILED = 'We could not change your hair. Your avatar is unchanged; try again.'
const COLORS_FAILED = 'We could not read your colors from that photo. Try again, or use a selfie taken facing a window in daylight.'

// 'create' with keepHair re-renders from the photos but keeps a haircut
// from the Hair studio (new measurements); a new selfie brings its own hair.
export type AvatarJobOptions =
  | { kind: 'create'; analyze: boolean; keepHair?: boolean }
  | { kind: 'refine'; adjustments: AvatarAdjustment[]; notes: string | null }
  | { kind: 'hair'; hairstyleId: string }

// Refinements and haircuts leave the avatar as it was when they fail;
// only a failed creation (or color read) leaves it failed.
export function failureFor(kind: AvatarJobOptions['kind'] | 'colors') {
  if (kind === 'colors') {
    return { status: 'failed' as const, error: COLORS_FAILED }
  }

  if (kind === 'hair') {
    return { status: 'ready' as const, error: HAIR_FAILED }
  }

  return kind === 'refine' ? { status: 'ready' as const, error: REFINE_FAILED } : { status: 'failed' as const, error: CREATE_FAILED }
}

// `avatarRun`: what the render took (billing useAvatarRun), given back if it fails.
export function newJob(kind: AvatarJob['kind'], avatarRun: AvatarJob['avatarRun'] = null, now = new Date()): AvatarJob {
  return { kind, startedAt: now, previewKey: null, previewCount: 0, ...(avatarRun ? { avatarRun } : {}) }
}

function requestColorAnalysis(selfie: Buffer) {
  return createStructuredResponse<ColorAnalysis>({
    instructions: COLOR_ANALYSIS_INSTRUCTIONS,
    content: [
      {
        type: 'input_text',
        text: 'Analyze this selfie and return the color profile.',
      },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'color_analysis',
    schema: colorAnalysisSchema,
  })
}

// The classic read: the model's whole read at once (COLOR_READ_METHOD
// 'classic', and the fallback when the measuring call's settings are
// refused).
export async function analyzeColors(selfie: Buffer): Promise<ColorAnalysis> {
  let analysis = await requestColorAnalysis(selfie)

  // A word from another script slipped into the English: ask once more, but
  // the season stays the first read's (another call can read another one).
  if (analysisHasForeignScript(analysis)) {
    const again = await requestColorAnalysis(selfie)

    if (again.season === analysis.season) {
      analysis = again
    }
  }

  return cleanColorAnalysis(analysis)
}

// Avatars made before versioning have a key but no history; treat that
// render as the first version.
function currentVersions(avatar: AvatarDocument): AvatarVersion[] {
  if (avatar.versions) {
    return avatar.versions
  }

  return avatar.avatarKey
    ? [
        {
          id: 'initial',
          key: avatar.avatarKey,
          source: 'create',
          createdAt: avatar.readyAt ?? avatar.updatedAt,
        },
      ]
    : []
}

// A read that gave up, and after how many tries.
class ReadFailed extends Error {
  constructor(
    readonly reason: unknown,
    readonly attempts: number,
  ) {
    super(errorMessage(reason))
  }
}

// The color read that runs beside an avatar render (a new selfie, or the
// first colors): nothing written until the render is done. A busy AI is
// tried again, briefly, like any read (failures.ts); the render takes
// longer anyway.
async function readBesideRender(app: FastifyInstance, avatar: AvatarDocument, selfie: Buffer): Promise<DoneRead> {
  const steps = newSteps()
  const startedAt = Date.now()
  let attempts = 0

  for (;;) {
    attempts += 1

    try {
      await measureStep(app, steps, selfie, avatar.userId)

      const decision = decideColors({ ...(await decideInput(app, avatar)), measure: photoMeasure(steps) })

      return { steps, hash: imageHash(selfie), analysis: await paletteStep(steps, selfie, decision) }
    } catch (error) {
      const code = classifyAiError(error)
      const wait = retryDelay(code, attempts, Date.now() - startedAt, error instanceof OpenAiRequestError ? error.retryAfterMs : null)

      if (wait === null) {
        throw new ReadFailed(error, attempts)
      }

      app.log.warn({ avatarId: avatar._id.toString(), code, attempts, waitMs: wait }, 'Color read beside the render failed; trying again')
      await sleep(wait)
    }
  }
}

// What the read beside the render adds to the job's final update. A read
// that failed while they had colors keeps them (the failure recorded, the
// avatar's status left to the render); without colors the whole create
// fails, as before.
async function settleReadBesideRender(
  app: FastifyInstance,
  avatar: AvatarDocument,
  result: PromiseSettledResult<DoneRead | null>,
  options: AvatarJobOptions,
  now: Date,
) {
  if (result.status === 'fulfilled' && !result.value) {
    return null
  }

  const fresh = (await app.collections.avatars.findOne({ _id: avatar._id })) ?? avatar
  const readId = newReadId()
  // Their selfie switched at upload: the free preview is of the old one.
  const newPhoto = options.kind === 'create' && options.keepHair === false

  if (result.status === 'fulfilled' && result.value) {
    try {
      const settled = await settleDoneRead(app, fresh, result.value, { readId, photoKey: fresh.selfieKey, newPhoto, via: 'avatar', mode: 'avatar', now })

      return {
        set: settled.set,
        replaced: replacedKeys(fresh, settled.after),
        ready: readyProps(settled.decision, result.value.steps.method, settled.samples, 'avatar'),
        failed: null,
        kept: true,
      }
    } catch (error) {
      result = { status: 'rejected', reason: error }
    }
  }

  const rejected = result.status === 'rejected' ? (result.reason as unknown) : null
  const reason = rejected instanceof ReadFailed ? rejected.reason : rejected
  const attempts = rejected instanceof ReadFailed ? rejected.attempts : 1
  const failure: ColorsFailure = { code: classifyAiError(reason), at: now, attempts, detail: redactAiMessage(errorMessage(reason)) }
  const kept = Boolean(fresh.colorAnalysis)
  const entry = readEntry({
    id: readId,
    at: now,
    selfieKey: fresh.selfieKey,
    method: env.COLOR_READ_METHOD,
    outcome: 'failed',
    shown: fresh.colorAnalysis?.season ?? null,
    failure,
    via: 'avatar',
  })

  // Kept: the web tells them their colors stayed (lastRead); otherwise the
  // failed create says it, as before.
  const set = kept ? { failure, colorReads: withRead(fresh.colorReads, entry) } : { colorReads: withRead(fresh.colorReads, entry) }

  return { set, replaced: [], ready: null, failed: failure, kept }
}

// Runs one avatar generation. On creation the color read and the render run
// in parallel, and the read is applied with the render's update; a refinement
// edits the current avatar. Previews of the render are saved as they stream
// so the app can show the avatar forming.
export async function runAvatarJob(
  app: FastifyInstance,
  avatarId: ObjectId,
  options: AvatarJobOptions,
) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })

  if (!avatar) {
    return
  }

  const userId = avatar.userId.toString()
  // The haircut the new version wears: the one being put on, or the one it
  // already has (a refinement, or new measurements, keep it).
  const keptHair = options.kind === 'refine' || (options.kind === 'create' && options.keepHair) ? currentHair(avatar) : null
  let hair: AvatarHair | null = keptHair
  let images: ImageInput[]
  let prompt: string
  let selfie: Buffer | null = null

  if (options.kind === 'hair') {
    const hairstyleId = toObjectId(options.hairstyleId)
    const hairstyle = hairstyleId ? await app.collections.hairstyles.findOne({ _id: hairstyleId, userId: avatar.userId }) : null

    if (!avatar.avatarKey || !hairstyle?.imageKey) {
      throw new Error('There is no avatar or haircut to put together.')
    }

    const [current, portrait] = await Promise.all([storage.read(avatar.avatarKey), storage.read(hairstyle.imageKey)])
    // The avatar keeps its own copy of the close-up, so deleting the
    // hairstyle later doesn't take it from looks.
    const refKey = `users/${userId}/avatar-hair-${Date.now()}.webp`

    await storage.put(refKey, portrait, 'image/webp')
    hair = { hairstyleId: hairstyle._id.toString(), name: hairstyle.name, render: hairstyle.render, refKey }
    images = [
      { data: current, filename: 'avatar.webp', contentType: 'image/webp' },
      { data: portrait, filename: 'haircut.webp', contentType: 'image/webp' },
    ]
    prompt = buildApplyHairPrompt(hairstyle, COHERENCE_RULES)
  } else {
    const [selfieImage, bodyPhoto, current, hairRef] = await Promise.all([
      storage.read(avatar.selfieKey),
      avatar.bodyPhotoKey ? storage.read(avatar.bodyPhotoKey) : Promise.resolve(null),
      options.kind === 'refine' && avatar.avatarKey ? storage.read(avatar.avatarKey) : Promise.resolve(null),
      keptHair ? storage.read(keptHair.refKey).catch(() => null) : Promise.resolve(null),
    ])

    if (options.kind === 'refine' && !current) {
      throw new Error('There is no avatar to refine.')
    }

    images = [
      ...(current ? [{ data: current, filename: 'avatar.webp', contentType: 'image/webp' }] : []),
      { data: selfieImage, filename: 'selfie.jpg', contentType: 'image/jpeg' },
      ...(bodyPhoto ? [{ data: bodyPhoto, filename: 'body.jpg', contentType: 'image/jpeg' }] : []),
      ...(hairRef ? [{ data: hairRef, filename: 'hair.webp', contentType: 'image/webp' }] : []),
    ]
    selfie = selfieImage

    if (!hairRef) {
      hair = null
    }

    const base =
      options.kind === 'refine'
        ? buildRefinePrompt({
            adjustments: options.adjustments,
            notes: options.notes,
            hasBodyPhoto: Boolean(bodyPhoto),
          })
        : buildAvatarPrompt(bodyOf(avatar), Boolean(bodyPhoto))

    prompt = hair
      ? `${base} Image ${images.length} is a close-up of their current haircut (${hair.name}): the hair must be exactly this haircut, length, texture and color, not the hair in the selfie.`
      : base
  }

  const previewKey = `users/${userId}/avatar-preview-${avatarId.toString()}.webp`

  // The color read beside the render writes nothing by itself: the job's
  // final update applies it, with the same rules as any read (reads.ts).
  const analysis = options.kind === 'create' && options.analyze && selfie ? readBesideRender(app, avatar, selfie) : Promise.resolve(null)
  const render = generateImageFromReferences({
    images,
    prompt,
    onPartial: async (png, index) => {
      await storage.put(previewKey, await toPreviewWebp(png), 'image/webp')
      await app.collections.avatars.updateOne(
        { _id: avatarId, status: 'processing' },
        {
          $set: {
            'job.previewKey': previewKey,
            'job.previewCount': index + 1,
            updatedAt: new Date(),
          },
        },
      )
    },
  })
  const [analysisResult, renderResult] = await Promise.allSettled([analysis, render])
  const now = new Date()
  const update: Record<string, unknown> = { job: null, updatedAt: now }
  const failures: string[] = []
  let prunedKeys: string[] = []
  const colors = await settleReadBesideRender(app, avatar, analysisResult, options, now)

  Object.assign(update, colors?.set ?? {})

  if (colors?.failed && !colors.kept) {
    failures.push(`color analysis: ${colors.failed.detail ?? colors.failed.code}`)
  }

  if (renderResult.status === 'fulfilled') {
    const key = `users/${userId}/avatar-${Date.now()}.webp`
    await storage.put(key, await toStoredWebp(renderResult.value), 'image/webp')

    const versions: AvatarVersion[] = [
      { id: now.getTime().toString(36), key, source: options.kind, createdAt: now, hair },
      ...currentVersions(avatar),
    ]
    const kept = versions.slice(0, MAX_VERSIONS)
    const pruned = versions.slice(MAX_VERSIONS)

    prunedKeys = [...pruned.map((version) => version.key), ...orphanHairKeys(pruned, kept)]
    update.versions = kept
    update.avatarKey = key
  } else {
    failures.push(`render: ${errorMessage(renderResult.reason)}`)

    // The close-up copied for a haircut that didn't make it onto the avatar.
    if (options.kind === 'hair' && hair) {
      prunedKeys = [hair.refKey]
    }
  }

  if (failures.length > 0) {
    app.log.error(
      { avatarId: avatarId.toString(), kind: options.kind, failures },
      'Avatar job failed',
    )
    // A failed refinement or haircut leaves the previous avatar usable.
    Object.assign(update, failureFor(options.kind))
    await releaseGenerations(app, avatar.userId, 'avatar', 1)
    await releaseAvatarRun(app, avatar.userId, avatar.job?.avatarRun)
  } else {
    update.status = 'ready'
    update.error = null
    update.readyAt = now
  }

  await app.collections.avatars.updateOne({ _id: avatarId }, { $set: update })
  await Promise.all(
    [previewKey, ...prunedKeys, ...(colors?.replaced ?? [])].map((key) => storage.remove(key).catch(() => undefined)),
  )

  if (options.kind === 'create') {
    await trackServerEvent(app, {
      name: failures.length > 0 ? 'avatar_failed' : 'avatar_ready',
      userId: avatar.userId,
    })

    if (colors?.ready) {
      await trackServerEvent(app, { name: 'colors_ready', userId: avatar.userId, props: colors.ready })
    } else if (colors?.failed) {
      await trackServerEvent(app, {
        name: 'colors_failed',
        userId: avatar.userId,
        props: { reason: colors.failed.code, attempts: colors.failed.attempts, via: 'avatar', kept: colors.kept },
      })
    }

    // Their best and worst color on their own face: the free part of the
    // color report, ready by the time they look at their colors.
    if (failures.length === 0) {
      await startDrapePreview(app, avatarId).catch((error: unknown) => {
        app.log.error({ err: error, avatarId: avatarId.toString() }, 'Drape preview did not start')
      })
    }
  }

  if (options.kind === 'hair') {
    await trackServerEvent(app, {
      name: failures.length > 0 ? 'hair_apply_failed' : 'hair_applied',
      userId: avatar.userId,
    })
  }
}

// ---------------------------------------------------------------- color reads

export type ColorsVia = NonNullable<ColorReadLog['via']>

// The steps of one read that survive its retries: a measurement made is
// never made again, so a palette retry doesn't measure twice.
type ReadSteps = {
  method: 'scored' | 'classic'
  first: Measurement | null
  second: Measurement | null
  secondDone: boolean
  // Scores from an earlier read of the same photo (no measuring call).
  reused: boolean
  classic: ColorAnalysis | null
  palette: ColorAnalysis | null
}

const newSteps = (): ReadSteps => ({
  method: env.COLOR_READ_METHOD,
  first: null,
  second: null,
  secondDone: false,
  reused: false,
  classic: null,
  palette: null,
})

// Step 1: the photo measured (one more time for a close call), or read the
// classic way. Settings the model refuses switch this read to classic.
async function measureStep(app: FastifyInstance, steps: ReadSteps, selfie: Buffer, userId: ObjectId) {
  if (steps.method === 'scored' && !steps.first) {
    try {
      steps.first = await measureColors(selfie)
    } catch (error) {
      if (!refusedSetting(error)) {
        throw error
      }

      app.log.error({ err: redactAiMessage(errorMessage(error)), model: env.COLOR_MEASURE_MODEL }, 'Color measuring settings refused; reading the classic way')
      void trackServerEvent(app, {
        name: 'colors_measure_fallback',
        userId,
        props: { model: env.COLOR_MEASURE_MODEL, status: error instanceof OpenAiRequestError ? error.statusCode : 0 },
      })
      steps.method = 'classic'
    }
  }

  if (steps.method === 'scored' && steps.first && !steps.secondDone) {
    if (!steps.reused && closeCall(steps.first)) {
      steps.second = await measureColors(selfie)
    }

    steps.secondDone = true
  }

  if (steps.method === 'classic' && !steps.classic) {
    steps.classic = await analyzeColors(selfie)
  }
}

function photoMeasure(steps: ReadSteps): ScoredRead | { method: 'classic'; season: string } {
  return steps.method === 'scored' && steps.first ? scoredRead(steps.first, steps.second) : { method: 'classic', season: steps.classic!.season }
}

const measuringCalls = (steps: ReadSteps) => (steps.method === 'scored' ? (steps.reused ? 0 : steps.second ? 2 : 1) : 1)

// Step 2: the colors for the season this photo read as, when the decision
// needs them (first, changed, candidate). A classic read has them already.
async function paletteStep(steps: ReadSteps, selfie: Buffer, decision: ColorDecision) {
  if (!decision.palette) {
    return null
  }

  if (steps.method === 'classic') {
    return steps.classic
  }

  steps.palette ??= await writePalette(selfie, photoMeasure(steps) as ScoredRead, decision.read)
  return steps.palette
}

type DoneRead = { steps: ReadSteps; hash: string; analysis: ColorAnalysis | null }

// What a decision weighs besides the photo: the season they have, whether
// they're a buyer and a switch could be honored (as they are now: a purchase
// meanwhile makes her a buyer), and the light their colors were read in.
async function decideInput(app: FastifyInstance, avatar: AvatarDocument) {
  return {
    current: avatar.colorAnalysis?.season ?? null,
    ...(await loadColorsAccess(app, avatar)),
    currentLighting: avatar.colorsSource?.lighting ?? null,
  }
}

// Decides with the avatar as it is now (whether she's a buyer by now), and
// builds what the read writes and its line in the history.
async function settleDoneRead(
  app: FastifyInstance,
  fresh: AvatarDocument,
  read: DoneRead,
  input: { readId: string; photoKey: string; newPhoto: boolean; via: ColorsVia; mode: 'colors' | 'avatar'; now: Date },
) {
  const { steps } = read
  const measure = photoMeasure(steps)
  const weigh = await decideInput(app, fresh)
  const { locked } = weigh
  const decision = decideColors({ ...weigh, measure })
  const scored = measure.method === 'scored' ? measure : null
  const source: ColorsSource = {
    readId: input.readId,
    at: input.now,
    selfieKey: input.photoKey,
    imageHash: read.hash,
    method: steps.method,
    scores: scored?.scores ?? null,
    lighting: scored?.lighting ?? null,
  }
  const entry = readEntry({
    id: input.readId,
    at: input.now,
    selfieKey: input.photoKey,
    imageHash: read.hash,
    method: steps.method,
    outcome: decision.outcome,
    season: decision.read,
    undertone: scored ? undertoneOf(scored.scores, scored.olive) : (steps.classic?.undertone ?? null),
    contrast: scored ? contrastOf(scored.scores) : (steps.classic?.contrast ?? null),
    scores: scored?.scores ?? null,
    lighting: scored?.lighting ?? null,
    margin: decision.margin,
    lead: decision.lead,
    shown: decision.shown,
    from: decision.from,
    direction: decision.direction,
    via: input.via,
    ...(scored?.coloring ? { coloring: scored.coloring } : {}),
  })
  const settled = settleRead(fresh, {
    readId: input.readId,
    photoKey: input.photoKey,
    newPhoto: input.newPhoto,
    locked,
    decision,
    analysis: decision.palette ? read.analysis : null,
    source,
    entry,
    now: input.now,
    mode: input.mode,
  })

  return { ...settled, decision, samples: measuringCalls(steps) }
}

const round2 = (value: number) => Math.round(value * 100) / 100

function readyProps(decision: ColorDecision, method: ReadSteps['method'], samples: number, via: ColorsVia) {
  return {
    season: decision.shown,
    via,
    outcome: decision.outcome,
    method,
    read: decision.read,
    samples,
    ...(decision.margin !== null ? { margin: round2(decision.margin) } : {}),
    ...(decision.lead !== null ? { lead: round2(decision.lead) } : {}),
    ...(decision.from ? { from: decision.from } : {}),
  }
}

function removeKeys(keys: string[]) {
  return Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
}

// Haircuts and makeup were read from, and drawn with, the selfie it replaced.
function dropHairstyles(app: FastifyInstance, userId: ObjectId) {
  return Promise.all([deleteHairstyles(app, userId), deleteMakeupTryOns(app, userId)]).catch((error: unknown) => {
    app.log.error({ err: error, userId: userId.toString() }, 'Could not delete the old haircuts and makeup')
  })
}

// A read replaced meanwhile (another start, a new selfie, the avatar): the
// photo it held goes unless something points to it now, and the generation
// it reserved comes back (`userId`: when it's known to have reserved one).
async function dropReplacedRead(app: FastifyInstance, avatarId: ObjectId, key: string, userId?: ObjectId) {
  const doc = await app.collections.avatars.findOne({ _id: avatarId }, { projection: { userId: 1, selfieKey: 1, job: 1, colorCandidate: 1 } })

  if (!doc || ![doc.selfieKey, doc.job?.selfieKey, doc.colorCandidate?.selfieKey].includes(key)) {
    await storage.remove(key).catch(() => undefined)
  }

  const owner = userId ?? doc?.userId

  if (owner) {
    await releaseGenerations(app, owner, 'avatar', 1, { image: false })
  }
}

// Colors first: reads the selfie on its own, before there's an avatar, so
// someone who came for their colors sees them in seconds. The avatar comes
// later from the same selfie, without reading it again. Starts the free
// best-vs-worst preview (drawn from the selfie) once the colors are in.
// When the AI is busy or down it tries again by itself, briefly
// (failures.ts); out of credits it fails at once (and the founder hears of
// it, ops/alerts.ts). `via: 'notify'`: the retry for a "tell me when ready".
//
// It reads the photo in job.selfieKey (a new selfie held there, or the
// stored one) and writes nothing until it has a result: then one update,
// guarded by the read's id, then the files it replaced go (reads.ts). The
// same photo read before (scored) reuses its scores. A failure keeps the
// colors someone had.
//
// `read`: the read this job was started for and the photo it reads, as the
// start wrote them (never read back from the document: a second start
// meanwhile is its own job, with its own read and photo).
export type ColorsRead = { readId: string; photoKey: string }

export async function runColorsJob(app: FastifyInstance, avatarId: ObjectId, read: ColorsRead, via?: 'notify') {
  const { readId, photoKey } = read
  const where = { _id: avatarId, 'job.readId': readId }
  const avatar = await app.collections.avatars.findOne(where)

  if (!avatar) {
    await dropReplacedRead(app, avatarId, photoKey)
    return
  }

  const startedAt = Date.now()
  let selfie: Buffer

  try {
    selfie = await storage.read(photoKey)
  } catch (error) {
    await failColorsJob(app, avatar, readId, { code: 'internal', attempts: 1, error }, via)
    return
  }

  const hash = imageHash(selfie)
  const steps = newSteps()
  const earlier =
    steps.method === 'scored'
      ? avatar.colorReads?.find((entry) => entry.imageHash === hash && entry.method === 'scored' && entry.scores && entry.lighting)
      : undefined

  if (earlier?.scores && earlier.lighting) {
    steps.first = { coloring: earlier.coloring ?? null, lighting: earlier.lighting, olive: earlier.undertone === 'olive', scores: earlier.scores }
    steps.reused = true
    void trackServerEvent(app, { name: 'colors_reused', userId: avatar.userId, props: { scope: 'history' } })
  }

  let analysis: ColorAnalysis | null | undefined
  let attempts = 0

  while (analysis === undefined) {
    attempts += 1

    try {
      await measureStep(app, steps, selfie, avatar.userId)

      const fresh = await app.collections.avatars.findOne(where)

      if (!fresh) {
        await dropReplacedRead(app, avatarId, photoKey, avatar.userId)
        return
      }

      analysis = await paletteStep(steps, selfie, decideColors({ ...(await decideInput(app, fresh)), measure: photoMeasure(steps) }))
    } catch (error) {
      const code = classifyAiError(error)
      const wait = retryDelay(code, attempts, Date.now() - startedAt, error instanceof OpenAiRequestError ? error.retryAfterMs : null)

      if (wait === null) {
        await failColorsJob(app, avatar, readId, { code, attempts, error, hash }, via)
        return
      }

      app.log.warn({ avatarId: avatarId.toString(), code, attempts, waitMs: wait }, 'Color read failed; trying again')
      await sleep(wait)

      // Replaced meanwhile (a new selfie, the avatar): not ours to finish.
      if (!(await app.collections.avatars.findOne(where, { projection: { _id: 1 } }))) {
        await dropReplacedRead(app, avatarId, photoKey, avatar.userId)
        return
      }
    }
  }

  void noteReadSucceeded(app)

  // As it is now: a purchase while the palette was written makes her a buyer.
  const fresh = await app.collections.avatars.findOne(where)

  if (!fresh) {
    await dropReplacedRead(app, avatarId, photoKey, avatar.userId)
    return
  }

  const now = new Date()
  const settled = await settleDoneRead(app, fresh, { steps, hash, analysis }, {
    readId,
    photoKey,
    newPhoto: photoKey !== fresh.selfieKey,
    via: via ?? 'colors',
    mode: 'colors',
    now,
  })
  const saved = await app.collections.avatars.updateOne(where, { $set: settled.set })

  if (saved.matchedCount === 0) {
    await dropReplacedRead(app, avatarId, photoKey, avatar.userId)
    return
  }

  await removeKeys(replacedKeys(fresh, settled.after))

  if (settled.selfieMoved) {
    await dropHairstyles(app, avatar.userId)
  }

  await trackServerEvent(app, {
    name: 'colors_ready',
    userId: avatar.userId,
    props: readyProps(settled.decision, steps.method, settled.samples, via ?? 'colors'),
  })
  await startDrapePreview(app, avatarId).catch((error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Drape preview did not start')
  })
}

// Records a failed read on the avatar, if it's still this read's (`where`).
// Colors someone had stay, and the avatar is ready; without colors it's
// failed and the photo read becomes their selfie. Returns whether colors
// were kept (null: it wasn't this read's anymore).
export async function settleFailure(
  app: FastifyInstance,
  where: Record<string, unknown>,
  failure: ColorsFailure,
  options: { via: ColorsVia; hash?: string | null },
): Promise<boolean | null> {
  const fresh = await app.collections.avatars.findOne(where)

  if (!fresh) {
    return null
  }

  const photoKey = fresh.job?.selfieKey ?? fresh.selfieKey
  const entry = readEntry({
    id: fresh.job?.readId ?? newReadId(),
    at: failure.at,
    selfieKey: photoKey,
    imageHash: options.hash ?? null,
    method: env.COLOR_READ_METHOD,
    outcome: 'failed',
    shown: fresh.colorAnalysis?.season ?? null,
    failure,
    via: options.via,
  })
  const settled = settleFailedRead(fresh, { photoKey, failure, entry, now: failure.at, failed: { status: 'failed', error: COLORS_FAILED } })
  const saved = await app.collections.avatars.updateOne(where, { $set: settled.set })

  if (saved.matchedCount === 0) {
    return null
  }

  await removeKeys(replacedKeys(fresh, settled.after))

  if (settled.selfieMoved) {
    await dropHairstyles(app, fresh.userId)
  }

  return settled.kept
}

async function failColorsJob(
  app: FastifyInstance,
  avatar: AvatarDocument,
  readId: string,
  result: { code: AiFailure; attempts: number; error?: unknown; hash?: string },
  via?: 'notify',
) {
  const detail = result.error === undefined ? null : redactAiMessage(errorMessage(result.error))
  const now = new Date()

  app.log.error({ avatarId: avatar._id.toString(), code: result.code, attempts: result.attempts, err: detail }, 'Color read failed')
  // Only if nothing replaced this read meanwhile (a new selfie, the avatar).
  const kept = await settleFailure(
    app,
    { _id: avatar._id, 'job.readId': readId },
    { code: result.code, at: now, attempts: result.attempts, detail },
    { via: via ?? 'colors', hash: result.hash ?? null },
  )
  await releaseGenerations(app, avatar.userId, 'avatar', 1, { image: false })
  // superseded: another read (or the avatar) took its place meanwhile, so
  // nothing was kept or failed by this one.
  await trackServerEvent(app, {
    name: 'colors_failed',
    userId: avatar.userId,
    props: { reason: result.code, attempts: result.attempts, ...(via ? { via } : {}), ...(kept === null ? { superseded: true } : { kept }) },
  })
  void noteReadFailed(app)
}

// A crash (not a failed read, which runColorsJob records itself): recorded
// like any read that didn't finish, if the read is still the one running.
export async function runColorsJobSafely(app: FastifyInstance, avatarId: ObjectId, read: ColorsRead, via?: 'notify') {
  try {
    await runColorsJob(app, avatarId, read, via)
  } catch (error) {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Color read crashed')

    try {
      const avatar = await app.collections.avatars.findOne({ _id: avatarId, 'job.readId': read.readId })

      if (avatar) {
        await failColorsJob(app, avatar, read.readId, { code: 'internal', attempts: 1 }, via)
      }
    } catch {
      // Stale-job recovery on the next boot will catch it.
    }
  }
}

export function startColorsJob(app: FastifyInstance, avatarId: ObjectId, read: ColorsRead) {
  void runColorsJobSafely(app, avatarId, read)
}

const NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000

// "Tell me when my colors are ready", after a read the AI couldn't do (not
// a photo it couldn't read): retry.ts reads it again and emails a sign-in
// link. A request still pending is left as it is. Returns whether one is
// pending now.
export async function requestColorsNotice(app: FastifyInstance, userId: ObjectId, via: ColorsNotify['via']) {
  const now = new Date()
  const waiting = {
    userId,
    status: 'failed' as const,
    avatarKey: null,
    colorAnalysis: null,
    'failure.code': { $in: PROVIDER_CODES },
  }
  const pending = {
    'colorsNotify.sentAt': null,
    'colorsNotify.gaveUpAt': null,
    'colorsNotify.requestedAt': { $gte: new Date(now.getTime() - NOTIFY_WINDOW_MS) },
  }
  const notify: ColorsNotify = { requestedAt: now, attempts: 0, lastTriedAt: null, sentAt: null, gaveUpAt: null, via }
  const created = await app.collections.avatars.updateOne({ ...waiting, $nor: [pending] }, { $set: { colorsNotify: notify } })

  if (created.modifiedCount > 0) {
    void trackServerEvent(app, { name: 'colors_notify_requested', userId, props: { via } })
    return true
  }

  return Boolean(await app.collections.avatars.findOne({ ...waiting, ...pending }, { projection: { _id: 1 } }))
}

export function startAvatarJob(
  app: FastifyInstance,
  avatarId: ObjectId,
  options: AvatarJobOptions,
) {
  void runAvatarJob(app, avatarId, options).catch(async (error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Avatar job crashed')

    try {
      const avatar = await app.collections.avatars.findOneAndUpdate(
        { _id: avatarId, status: 'processing' },
        { $set: { ...failureFor(options.kind), job: null, updatedAt: new Date() } },
      )

      if (avatar) {
        await releaseGenerations(app, avatar.userId, 'avatar', 1)
        await releaseAvatarRun(app, avatar.userId, avatar.job?.avatarRun)
      }
    } catch {
      // Stale-job recovery on the next boot will catch it.
    }
  })
}
