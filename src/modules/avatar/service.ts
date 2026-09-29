import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type {
  AvatarAdjustment,
  AvatarDocument,
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
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { analysisHasForeignScript, cleanColorAnalysis } from './analysis.js'
import {
  COLOR_ANALYSIS_INSTRUCTIONS,
  buildAvatarPrompt,
  buildRefinePrompt,
  colorAnalysisSchema,
} from './prompts.js'

const MAX_VERSIONS = 6
const CREATE_FAILED = 'We could not finish your avatar. Please try again.'
const REFINE_FAILED = 'We could not apply those changes. Your avatar is unchanged; try again.'

export type AvatarJobOptions =
  | { kind: 'create'; analyze: boolean }
  | { kind: 'refine'; adjustments: AvatarAdjustment[]; notes: string | null }

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
  const [selfie, bodyPhoto, current] = await Promise.all([
    storage.read(avatar.selfieKey),
    avatar.bodyPhotoKey ? storage.read(avatar.bodyPhotoKey) : Promise.resolve(null),
    options.kind === 'refine' && avatar.avatarKey
      ? storage.read(avatar.avatarKey)
      : Promise.resolve(null),
  ])

  if (options.kind === 'refine' && !current) {
    throw new Error('There is no avatar to refine.')
  }

  const images: ImageInput[] = [
    ...(current ? [{ data: current, filename: 'avatar.webp', contentType: 'image/webp' }] : []),
    { data: selfie, filename: 'selfie.jpg', contentType: 'image/jpeg' },
    ...(bodyPhoto ? [{ data: bodyPhoto, filename: 'body.jpg', contentType: 'image/jpeg' }] : []),
  ]
  const prompt =
    options.kind === 'refine'
      ? buildRefinePrompt({
          adjustments: options.adjustments,
          notes: options.notes,
          hasBodyPhoto: Boolean(bodyPhoto),
        })
      : buildAvatarPrompt(avatar.body, Boolean(bodyPhoto))
  const previewKey = `users/${userId}/avatar-preview-${avatarId.toString()}.webp`

  const analysis =
    options.kind === 'create' && options.analyze
      ? analyzeColors(selfie).then(async (result) => {
          await app.collections.avatars.updateOne(
            { _id: avatarId },
            { $set: { colorAnalysis: result, updatedAt: new Date() } },
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

    const versions = [
      { id: now.getTime().toString(36), key, source: options.kind, createdAt: now },
      ...currentVersions(avatar),
    ]

    prunedKeys = versions.slice(MAX_VERSIONS).map((version) => version.key)
    update.versions = versions.slice(0, MAX_VERSIONS)
    update.avatarKey = key
  } else {
    failures.push(`render: ${errorMessage(renderResult.reason)}`)
  }

  if (failures.length > 0) {
    app.log.error(
      { avatarId: avatarId.toString(), kind: options.kind, failures },
      'Avatar job failed',
    )
    // A failed refinement leaves the previous avatar in place and usable.
    update.status = options.kind === 'refine' ? 'ready' : 'failed'
    update.error = options.kind === 'refine' ? REFINE_FAILED : CREATE_FAILED
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
  }
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
        {
          $set: {
            status: options.kind === 'refine' ? 'ready' : 'failed',
            error: options.kind === 'refine' ? REFINE_FAILED : CREATE_FAILED,
            job: null,
            updatedAt: new Date(),
          },
        },
      )

      if (avatar) {
        await releaseGenerations(app, avatar.userId, 'avatar', 1)
      }
    } catch {
      // Stale-job recovery on the next boot will catch it.
    }
  })
}
