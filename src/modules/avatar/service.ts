import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type {
  AvatarAdjustment,
  AvatarDocument,
  AvatarHair,
  AvatarVersion,
  ColorAnalysis,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toPreviewWebp, toStoredWebp } from '../../utils/images.js'
import {
  createStructuredResponse,
  generateImageFromReferences,
  type ImageInput,
  toDataUrl,
} from '../../utils/openai.js'
import { toObjectId } from '../../utils/object-id.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { startDrapePreview } from '../report/service.js'
import { buildApplyHairPrompt } from '../hair/prompts.js'
import { analysisHasForeignScript, cleanColorAnalysis } from './analysis.js'
import { bodyOf } from './body.js'
import { currentHair, orphanHairKeys } from './hair.js'
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

export async function analyzeColors(selfie: Buffer): Promise<ColorAnalysis> {
  let analysis = await requestColorAnalysis(selfie)

  // A word from another script slipped into the English: ask once more.
  if (analysisHasForeignScript(analysis)) {
    analysis = await requestColorAnalysis(selfie)
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

// Runs one avatar generation. On creation the color read and the render run
// in parallel, and the palette is saved the moment it's ready; a refinement
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

  const analysis =
    options.kind === 'create' && options.analyze && selfie
      ? analyzeColors(selfie).then(async (result) => {
          await app.collections.avatars.updateOne(
            { _id: avatarId },
            { $set: { colorAnalysis: result, colorsAt: new Date(), updatedAt: new Date() } },
          )
          return result
        })
      : Promise.resolve(null)
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

  if (analysisResult.status === 'rejected') {
    failures.push(`color analysis: ${errorMessage(analysisResult.reason)}`)
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
  } else {
    update.status = 'ready'
    update.error = null
    update.readyAt = now
  }

  await app.collections.avatars.updateOne({ _id: avatarId }, { $set: update })
  await Promise.all(
    [previewKey, ...prunedKeys].map((key) => storage.remove(key).catch(() => undefined)),
  )

  if (options.kind === 'create') {
    await trackServerEvent(app, {
      name: failures.length > 0 ? 'avatar_failed' : 'avatar_ready',
      userId: avatar.userId,
    })

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

// Colors first: reads the selfie on its own, before there's an avatar, so
// someone who came for their colors sees them in seconds. The avatar comes
// later from the same selfie, without reading it again. Starts the free
// best-vs-worst preview (drawn from the selfie) once the colors are in.
export async function runColorsJob(app: FastifyInstance, avatarId: ObjectId) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })

  if (!avatar) {
    return
  }

  const selfieKey = avatar.selfieKey
  let analysis: ColorAnalysis

  try {
    analysis = await analyzeColors(await storage.read(selfieKey))
  } catch (error) {
    app.log.error({ avatarId: avatarId.toString(), err: errorMessage(error) }, 'Color read failed')
    // Only if nothing replaced this job meanwhile (a new selfie, the avatar).
    await app.collections.avatars.updateOne(
      { _id: avatarId, selfieKey, 'job.kind': 'colors' },
      { $set: { ...failureFor('colors'), job: null, updatedAt: new Date() } },
    )
    await releaseGenerations(app, avatar.userId, 'avatar', 1)
    await trackServerEvent(app, { name: 'colors_failed', userId: avatar.userId })
    return
  }

  const saved = await app.collections.avatars.updateOne(
    { _id: avatarId, selfieKey, 'job.kind': 'colors' },
    { $set: { status: 'ready', error: null, colorAnalysis: analysis, colorsAt: new Date(), job: null, updatedAt: new Date() } },
  )

  if (saved.matchedCount === 0) {
    return
  }

  await trackServerEvent(app, { name: 'colors_ready', userId: avatar.userId, props: { season: analysis.season } })
  await startDrapePreview(app, avatarId).catch((error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Drape preview did not start')
  })
}

export function startColorsJob(app: FastifyInstance, avatarId: ObjectId) {
  void runColorsJob(app, avatarId).catch(async (error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Color read crashed')

    try {
      const avatar = await app.collections.avatars.findOneAndUpdate(
        { _id: avatarId, status: 'processing', 'job.kind': 'colors' },
        { $set: { ...failureFor('colors'), job: null, updatedAt: new Date() } },
      )

      if (avatar) {
        await releaseGenerations(app, avatar.userId, 'avatar', 1)
      }
    } catch {
      // Stale-job recovery on the next boot will catch it.
    }
  })
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
      }
    } catch {
      // Stale-job recovery on the next boot will catch it.
    }
  })
}
