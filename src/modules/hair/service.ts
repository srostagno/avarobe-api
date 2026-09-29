import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type {
  AvatarDocument,
  HairProfile,
  HairRecommendation,
  HairstyleDocument,
  HairFit,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toPreviewWebp, toStoredWebp } from '../../utils/images.js'
import { createStructuredResponse, generateImageFromReferences, type ImageInput, toDataUrl } from '../../utils/openai.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { currentHair } from '../avatar/hair.js'
import { PaywallError, refundCredits, releaseHairRun, useHairRun } from '../billing/entitlements.js'
import {
  HAIR_PROFILE_INSTRUCTIONS,
  HAIR_REQUEST_INSTRUCTIONS,
  buildHairProfileRequest,
  buildHairRequest,
  buildHairstylePrompt,
  cleanRecommendations,
  hairProfileSchema,
  hairRequestSchema,
} from './prompts.js'

const PROFILE_FAILED = 'We could not read your hair from this selfie. Try again, or use a selfie in daylight.'
const NO_FACE = 'We couldn’t see your face and hair clearly in your selfie. A new selfie in daylight, hair visible, works best.'
const RENDER_FAILED = 'We could not show this haircut on you. Try again.'

export class NotAHaircutError extends Error {}

export function hairstyleKeys(hairstyle: Pick<HairstyleDocument, 'imageKey' | 'previewKey' | 'referenceKey'>) {
  return [hairstyle.imageKey, hairstyle.previewKey, hairstyle.referenceKey].filter((key): key is string => Boolean(key))
}

// Every haircut rendered on this person, with its files (a new selfie, a
// deleted avatar or account).
export async function deleteHairstyles(app: FastifyInstance, userId: ObjectId) {
  const hairstyles = await app.collections.hairstyles
    .find({ userId }, { projection: { imageKey: 1, previewKey: 1, referenceKey: 1 } })
    .toArray()

  await Promise.all(hairstyles.flatMap(hairstyleKeys).map((key) => storage.remove(key).catch(() => undefined)))
  await app.collections.hairstyles.deleteMany({ userId })
}

type ProfileResult = Omit<HairProfile, 'recommendations'> & {
  hasFace: boolean
  recommendations: Omit<HairRecommendation, 'id'>[]
}

async function readHair(app: FastifyInstance, avatar: AvatarDocument) {
  const [selfie, taste] = await Promise.all([
    storage.read(avatar.selfieKey),
    app.collections.tastes.findOne({ userId: avatar.userId }),
  ])
  const result = await createStructuredResponse<ProfileResult>({
    instructions: HAIR_PROFILE_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: buildHairProfileRequest(avatar.body, taste) },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'hair_profile',
    schema: hairProfileSchema,
    model: env.AI_STYLIST_MODEL,
    reasoningEffort: env.AI_STYLIST_REASONING_EFFORT,
  })

  if (!result.hasFace) {
    return null
  }

  return {
    faceShape: result.faceShape,
    faceShapeNote: result.faceShapeNote,
    hairType: result.hairType,
    summary: result.summary,
    flatters: result.flatters.slice(0, 3),
    avoid: result.avoid.slice(0, 2),
    recommendations: cleanRecommendations(result.recommendations),
  } satisfies HairProfile
}

// Reads the selfie in the background. Only the run that started can finish
// (a new selfie clears the profile, a redo restarts it). With a ready
// profile, the ideal cut renders right away when the person may have it:
// their free hairstyle, or every cut with the Style Report or Pro.
export async function runHairProfile(app: FastifyInstance, avatarId: ObjectId, startedAt: Date) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })

  if (!avatar || avatar.hairProfile?.startedAt.getTime() !== startedAt.getTime()) {
    return
  }

  const finish = (update: { status: 'ready' | 'failed'; data: HairProfile | null; error: string | null }) =>
    app.collections.avatars.updateOne(
      { _id: avatarId, 'hairProfile.startedAt': startedAt },
      {
        $set: {
          'hairProfile.status': update.status,
          'hairProfile.data': update.data,
          'hairProfile.error': update.error,
          'hairProfile.updatedAt': new Date(),
        },
      },
    )

  let profile: HairProfile | null

  try {
    profile = await readHair(app, avatar)
  } catch (error) {
    app.log.error({ avatarId: avatarId.toString(), err: errorMessage(error) }, 'Hair profile failed')
    await finish({ status: 'failed', data: null, error: PROFILE_FAILED })
    await releaseGenerations(app, avatar.userId, 'hair', 1)
    return
  }

  if (!profile || profile.recommendations.length === 0) {
    await finish({ status: 'failed', data: null, error: NO_FACE })
    await releaseGenerations(app, avatar.userId, 'hair', 1)
    return
  }

  const saved = await finish({ status: 'ready', data: profile, error: null })

  if (saved.matchedCount === 0) {
    return
  }

  // Haircuts from an earlier read stay in their history, no longer tied to
  // a recommendation of this one.
  await app.collections.hairstyles.updateMany(
    { userId: avatar.userId, source: 'recommended' },
    { $set: { recommendationId: null } },
  )
  void trackServerEvent(app, { name: 'hair_profile_ready', userId: avatar.userId })

  const ideal = profile.recommendations[0]

  if (ideal && (await reserveGenerations(app, avatar.userId, 'hair', 1))) {
    try {
      const { started } = await startRecommendedHairstyle(app, avatar, ideal)

      if (!started) {
        await releaseGenerations(app, avatar.userId, 'hair', 1)
      }
    } catch (error) {
      await releaseGenerations(app, avatar.userId, 'hair', 1)

      // No free hairstyle left: the page offers the rest.
      if (!(error instanceof PaywallError)) {
        app.log.error({ avatarId: avatarId.toString(), err: errorMessage(error) }, 'Ideal cut not started')
      }
    }
  }
}

export function startHairProfile(app: FastifyInstance, avatarId: ObjectId, startedAt: Date) {
  void runHairProfile(app, avatarId, startedAt).catch((error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Hair profile crashed')
  })
}

// A recommended cut on the person: free with the Style Report or Pro,
// otherwise their free hairstyle. Throws PaywallError when neither applies.
// A cut already shown (or showing) isn't rendered or charged again
// (`started` is false); a failed one is retried in place. The caller has
// reserved today's 'hair' allowance.
export async function startRecommendedHairstyle(
  app: FastifyInstance,
  avatar: AvatarDocument,
  recommendation: HairRecommendation,
): Promise<{ hairstyle: HairstyleDocument; started: boolean }> {
  const existing = await app.collections.hairstyles.findOne({
    userId: avatar.userId,
    source: 'recommended',
    recommendationId: recommendation.id,
  })

  if (existing && existing.status !== 'failed') {
    return { hairstyle: existing, started: false }
  }

  const freeRun = await useHairRun(app, avatar.userId)
  const now = new Date()
  const fields = {
    status: 'processing' as const,
    error: null,
    imageKey: null,
    previewKey: null,
    creditSpent: false,
    freeRun,
    updatedAt: now,
    readyAt: null,
  }
  let hairstyle: HairstyleDocument

  if (existing) {
    hairstyle = { ...existing, ...fields }
    await app.collections.hairstyles.updateOne({ _id: existing._id }, { $set: fields })
  } else {
    hairstyle = {
      _id: new ObjectId(),
      userId: avatar.userId,
      avatarId: avatar._id,
      source: 'recommended',
      recommendationId: recommendation.id,
      name: recommendation.name,
      why: recommendation.why,
      stylistBrief: recommendation.stylistBrief,
      fit: null,
      render: recommendation.render,
      request: null,
      referenceKey: null,
      createdAt: now,
      ...fields,
    }
    await app.collections.hairstyles.insertOne(hairstyle)
  }

  startHairstyleRender(app, hairstyle._id)

  return { hairstyle, started: true }
}

// A haircut they described or showed in a photo, read by the stylist for
// their face and hair (a few seconds).
export async function planHairRequest(input: {
  avatar: AvatarDocument
  description: string | null
  photo: Buffer | null
}): Promise<{ name: string; render: string; stylistBrief: string; fit: HairFit }> {
  const selfie = await storage.read(input.avatar.selfieKey)
  const result = await createStructuredResponse<{
    isHaircut: boolean
    name: string
    render: string
    stylistBrief: string
    fit: HairFit
  }>({
    instructions: HAIR_REQUEST_INSTRUCTIONS,
    content: [
      {
        type: 'input_text',
        text: buildHairRequest({
          profile: input.avatar.hairProfile?.data ?? null,
          body: input.avatar.body,
          description: input.description,
          hasPhoto: Boolean(input.photo),
        }),
      },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
      ...(input.photo
        ? [{ type: 'input_image' as const, image_url: toDataUrl(input.photo, 'image/jpeg'), detail: 'high' as const }]
        : []),
    ],
    schemaName: 'hair_request',
    schema: hairRequestSchema,
    model: env.AI_STYLIST_MODEL,
    reasoningEffort: env.AI_STYLIST_REASONING_EFFORT,
  })

  if (!result.isHaircut || !result.render.trim()) {
    throw new NotAHaircutError('Not a haircut.')
  }

  return { name: result.name.trim(), render: result.render.trim(), stylistBrief: result.stylistBrief.trim(), fit: result.fit }
}

// Gives back what a failed render took: the credit or the free hairstyle,
// and today's allowance.
export async function markHairstyleFailed(app: FastifyInstance, hairstyleId: ObjectId, error = RENDER_FAILED) {
  const hairstyle = await app.collections.hairstyles.findOneAndUpdate(
    { _id: hairstyleId, status: 'processing' },
    { $set: { status: 'failed', error, previewKey: null, updatedAt: new Date() } },
  )

  if (!hairstyle) {
    return
  }

  await releaseGenerations(app, hairstyle.userId, 'hair', 1)

  if (hairstyle.creditSpent) {
    const claimed = await app.collections.hairstyles.updateOne({ _id: hairstyleId, creditSpent: true }, { $set: { creditSpent: false } })

    if (claimed.modifiedCount) {
      await refundCredits(app, hairstyle.userId, 1)
    }
  }

  if (hairstyle.freeRun) {
    const claimed = await app.collections.hairstyles.updateOne({ _id: hairstyleId, freeRun: true }, { $set: { freeRun: false } })

    if (claimed.modifiedCount) {
      await releaseHairRun(app, hairstyle.userId)
    }
  }
}

// Renders one haircut on the person as a chest-up portrait (~25 s), saving
// previews as the model refines it.
export async function runHairstyleRender(app: FastifyInstance, hairstyleId: ObjectId) {
  const hairstyle = await app.collections.hairstyles.findOne({ _id: hairstyleId })

  if (!hairstyle) {
    return
  }

  const avatar = await app.collections.avatars.findOne({ _id: hairstyle.avatarId })

  if (!avatar?.avatarKey) {
    await markHairstyleFailed(app, hairstyleId)
    return
  }

  const previewKey = `users/${hairstyle.userId.toString()}/hairstyle-${hairstyle._id.toString()}-preview.webp`

  try {
    const [avatarImage, selfie, reference] = await Promise.all([
      storage.read(avatar.avatarKey),
      storage.read(avatar.selfieKey),
      hairstyle.referenceKey ? storage.read(hairstyle.referenceKey) : Promise.resolve(null),
    ])
    const images: ImageInput[] = [
      { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
      { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
      ...(reference ? [{ data: reference, filename: 'haircut.jpg', contentType: 'image/jpeg' }] : []),
    ]
    const png = await generateImageFromReferences({
      images,
      prompt: buildHairstylePrompt({ name: hairstyle.name, render: hairstyle.render, hasReference: Boolean(reference) }),
      size: '1024x1536',
      onPartial: async (partial) => {
        await storage.put(previewKey, await toPreviewWebp(partial), 'image/webp')
        await app.collections.hairstyles.updateOne(
          { _id: hairstyleId, status: 'processing' },
          { $set: { previewKey, updatedAt: new Date() } },
        )
      },
    })
    const key = `users/${hairstyle.userId.toString()}/hairstyle-${hairstyle._id.toString()}-${Date.now()}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const now = new Date()
    const result = await app.collections.hairstyles.updateOne(
      { _id: hairstyleId, status: 'processing' },
      { $set: { status: 'ready', error: null, imageKey: key, previewKey: null, updatedAt: now, readyAt: now } },
    )

    // Deleted (or cleared by a new selfie) while it rendered.
    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
      return
    }

    void trackServerEvent(app, {
      name: 'hairstyle_ready',
      userId: hairstyle.userId,
      props: { source: hairstyle.source, free: hairstyle.freeRun },
    })
  } catch (error) {
    app.log.error({ hairstyleId: hairstyleId.toString(), err: errorMessage(error) }, 'Hairstyle render failed')
    await markHairstyleFailed(app, hairstyleId)
  } finally {
    await storage.remove(previewKey).catch(() => undefined)
  }
}

export function startHairstyleRender(app: FastifyInstance, hairstyleId: ObjectId) {
  void runHairstyleRender(app, hairstyleId).catch(async (error: unknown) => {
    app.log.error({ err: error, hairstyleId: hairstyleId.toString() }, 'Hairstyle render crashed')
    await markHairstyleFailed(app, hairstyleId).catch(() => undefined)
  })
}

export async function serializeHairstyle(hairstyle: HairstyleDocument, currentHairstyleId: string | null) {
  const [imageUrl, previewUrl, referenceUrl] = await Promise.all([
    signedUrlOrNull(hairstyle.imageKey),
    signedUrlOrNull(hairstyle.previewKey),
    signedUrlOrNull(hairstyle.referenceKey),
  ])

  return {
    id: hairstyle._id.toString(),
    source: hairstyle.source,
    recommendationId: hairstyle.recommendationId,
    name: hairstyle.name,
    why: hairstyle.why,
    stylistBrief: hairstyle.stylistBrief,
    fit: hairstyle.fit,
    request: hairstyle.request,
    status: hairstyle.status,
    error: hairstyle.error,
    imageUrl,
    previewUrl,
    referenceUrl,
    onAvatar: hairstyle._id.toString() === currentHairstyleId,
    createdAt: hairstyle.createdAt.toISOString(),
    readyAt: hairstyle.readyAt?.toISOString() ?? null,
  }
}

// The read as the web shows it: the render descriptions are for the image
// model only.
export function serializeHairProfile(avatar: AvatarDocument) {
  const state = avatar.hairProfile

  if (!state) {
    return null
  }

  return {
    status: state.status,
    error: state.error,
    startedAt: state.startedAt.toISOString(),
    data: state.data
      ? {
          ...state.data,
          recommendations: state.data.recommendations.map((recommendation) => ({
            id: recommendation.id,
            name: recommendation.name,
            length: recommendation.length,
            why: recommendation.why,
            maintenance: recommendation.maintenance,
            stylingMinutes: recommendation.stylingMinutes,
            stylistBrief: recommendation.stylistBrief,
          })),
        }
      : null,
  }
}

export async function serializeHairStudio(app: FastifyInstance, avatar: AvatarDocument | null, userId: ObjectId) {
  const hair = avatar ? currentHair(avatar) : null
  const hairstyles = await app.collections.hairstyles.find({ userId }).sort({ createdAt: -1 }).limit(60).toArray()
  const [avatarUrl, previewUrl, items] = await Promise.all([
    signedUrlOrNull(avatar?.avatarKey ?? null),
    signedUrlOrNull(avatar?.job?.previewKey ?? null),
    Promise.all(hairstyles.map((hairstyle) => serializeHairstyle(hairstyle, hair?.hairstyleId ?? null))),
  ])

  return {
    avatar: avatar
      ? {
          status: avatar.status,
          error: avatar.error,
          jobKind: avatar.job?.kind ?? null,
          jobHairstyleId: avatar.job?.hairstyleId ?? null,
          avatarUrl,
          previewUrl,
          presentation: avatar.body.presentation,
          // A version with the selfie's own hair to go back to.
          canGoNatural: Boolean(hair && avatar.versions?.some((version) => !version.hair)),
        }
      : null,
    profile: avatar ? serializeHairProfile(avatar) : null,
    current: hair ? { hairstyleId: hair.hairstyleId, name: hair.name } : null,
    hairstyles: items,
  }
}
