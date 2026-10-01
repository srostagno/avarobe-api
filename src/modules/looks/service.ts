import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { AvatarDocument, LookDocument, LookItem, LookPiece, LookPlan, RemixChange } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { blurTeaser, toPreviewWebp, toStoredWebp } from '../../utils/images.js'
import {
  type ImageInput,
  createStructuredResponse,
  generateImageFromReferences,
  toDataUrl,
} from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import { hairReference } from '../avatar/hair.js'
import { refundCredits } from '../billing/entitlements.js'
import {
  LOOK_PLAN_INSTRUCTIONS,
  type StylistTaste,
  TRY_ON_INSTRUCTIONS,
  buildLookPlanRequest,
  buildLookRenderPrompt,
  buildPiecePrompt,
  buildRemixRequest,
  buildTryOnRenderPrompt,
  buildTryOnRequest,
  lookPlanSchema,
  tryOnAnalysisSchema,
} from './prompts.js'

const HEX_PATTERN = /^#[0-9a-f]{6}$/i
const RENDER_FAILED_MESSAGE = 'We could not render this look. Try again.'

type LookPlanResponse = {
  brief: { asks: string[]; styleSignature: string; climate: string }
  dressCode: string
  occasionSummary: string
  looks: LookPlan[]
}

function cleanItem(item: LookItem): LookItem {
  return {
    ...item,
    name: item.name.trim(),
    color: item.color.trim(),
    colorHex: HEX_PATTERN.test(item.colorHex) ? item.colorHex.toUpperCase() : '#9A948C',
    material: item.material.trim(),
    fit: item.fit.trim(),
  }
}

function cleanPlan(look: LookPlan, taste: StylistTaste | null | undefined): LookPlan {
  // Only lines that really are in their profile, so "Tuned to you" never
  // shows something they didn't say or we didn't learn.
  const loves = new Map((taste?.loves ?? []).map((line) => [line.trim().toLowerCase(), line]))

  return {
    ...look,
    title: look.title.trim(),
    // The card shows it as a chip.
    vibe: look.vibe.trim().slice(0, 24),
    items: look.items.slice(0, 8).map(cleanItem),
    stylingTips: look.stylingTips.slice(0, 3),
    tasteApplied: [
      ...new Set(
        (look.tasteApplied ?? [])
          .map((line) => loves.get(line.trim().replace(/^- /, '').toLowerCase()))
          .filter((line): line is string => Boolean(line)),
      ),
    ].slice(0, 2),
  }
}

async function requestPlan(request: string, count: number, taste: StylistTaste | null | undefined) {
  const response = await createStructuredResponse<LookPlanResponse>({
    instructions: LOOK_PLAN_INSTRUCTIONS,
    content: [{ type: 'input_text', text: request }],
    schemaName: 'look_plan',
    schema: lookPlanSchema,
    model: env.AI_STYLIST_MODEL,
    reasoningEffort: env.AI_STYLIST_REASONING_EFFORT,
    timeoutMs: 120_000,
  })

  const looks = response.looks
    .filter((look) => look.items.length > 0)
    .slice(0, count)
    .map((look) => cleanPlan(look, taste))

  if (looks.length === 0) {
    throw new Error('The stylist returned no looks.')
  }

  return {
    asks: response.brief.asks.map((ask) => ask.trim()).filter(Boolean).slice(0, 6),
    dressCode: response.dressCode.trim(),
    occasionSummary: response.occasionSummary.trim(),
    looks,
  }
}

export async function planLooks(input: {
  avatar: AvatarDocument
  occasion: string
  notes: string | null
  count: number
  taste?: StylistTaste | null
}) {
  return requestPlan(buildLookPlanRequest(input), input.count, input.taste)
}

// One variant of a look: same style, the change the person picked.
export async function planRemix(input: {
  avatar: AvatarDocument
  base: Pick<LookDocument, 'plan' | 'occasion'>
  change: RemixChange
  detail: string | null
  taste?: StylistTaste | null
}) {
  return requestPlan(buildRemixRequest(input), 1, input.taste)
}

type TryOnAnalysis = Omit<LookPlan, 'items'> & {
  hasOutfit: boolean
  dressCode: string
  items: (LookItem & { fromPhoto: boolean })[]
}

export class NoOutfitError extends Error {}

// Reads the outfit in an uploaded photo into a look plan for this person.
export async function analyzeOutfit(input: {
  avatar: AvatarDocument
  photo: Buffer
  notes: string | null
}) {
  const response = await createStructuredResponse<TryOnAnalysis>({
    instructions: TRY_ON_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: buildTryOnRequest(input.avatar, input.notes) },
      { type: 'input_image', image_url: toDataUrl(input.photo, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'try_on',
    schema: tryOnAnalysisSchema,
    timeoutMs: 120_000,
  })

  if (!response.hasOutfit || response.items.length === 0) {
    throw new NoOutfitError('We could not find an outfit in that photo.')
  }

  const plan: LookPlan = {
    title: response.title.trim(),
    vibe: response.vibe,
    summary: response.summary.trim(),
    whyItWorks: response.whyItWorks.trim(),
    items: response.items.slice(0, 8).map((item) => ({ ...cleanItem(item), fromPhoto: item.fromPhoto })),
    stylingTips: response.stylingTips.slice(0, 3),
  }

  return { dressCode: response.dressCode.trim(), plan }
}

async function markLookFailed(app: FastifyInstance, lookId: ObjectId) {
  const look = await app.collections.looks.findOneAndUpdate(
    { _id: lookId, status: 'processing' },
    {
      $set: {
        status: 'failed',
        error: RENDER_FAILED_MESSAGE,
        previewKey: null,
        updatedAt: new Date(),
      },
    },
  )

  if (look) {
    await releaseGenerations(app, look.userId, 'look', 1)

    if (look.creditSpent) {
      await refundCredits(app, look.userId, 1)
      await app.collections.looks.updateOne({ _id: lookId }, { $set: { creditSpent: false } })
    }
  }
}

// What drawing a look on their avatar takes: the avatar, their face, the
// outfit photo for try-ons, the haircut they picked, and the prompt.
async function lookImageRequest(look: LookDocument, avatar: AvatarDocument & { avatarKey: string }) {
  const [avatarImage, selfie, reference] = await Promise.all([
    storage.read(avatar.avatarKey),
    storage.read(avatar.selfieKey),
    look.referenceKey ? storage.read(look.referenceKey) : Promise.resolve(null),
  ])
  const images: ImageInput[] = [
    { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
    { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
  ]

  if (reference) {
    images.push({ data: reference, filename: 'outfit.jpg', contentType: 'image/jpeg' })
  }

  // A haircut from the Hair studio, over the selfie's hair.
  const hair = await hairReference(avatar, images.length + 1)

  if (hair) {
    images.push(hair.image)
  }

  const basePrompt = reference ? buildTryOnRenderPrompt(look.plan) : buildLookRenderPrompt(look.plan, look.occasion.text)

  return { images, prompt: hair ? `${basePrompt} ${hair.line}` : basePrompt }
}

export async function runLookRender(app: FastifyInstance, lookId: ObjectId) {
  const look = await app.collections.looks.findOne({ _id: lookId })

  if (!look) {
    return
  }

  const avatar = await app.collections.avatars.findOne({ _id: look.avatarId })

  if (!avatar?.avatarKey) {
    await markLookFailed(app, lookId)
    return
  }

  const previewKey = `users/${look.userId.toString()}/look-${look._id.toString()}-preview.webp`

  try {
    const png = await generateImageFromReferences({
      ...(await lookImageRequest(look, { ...avatar, avatarKey: avatar.avatarKey })),
      // Previews let the card show the look forming instead of a shimmer.
      onPartial: async (partial) => {
        await storage.put(previewKey, await toPreviewWebp(partial), 'image/webp')
        await app.collections.looks.updateOne(
          { _id: lookId, status: 'processing' },
          { $set: { previewKey, updatedAt: new Date() } },
        )
      },
    })
    const key = `users/${look.userId.toString()}/look-${look._id.toString()}-${Date.now()}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const now = new Date()
    const result = await app.collections.looks.updateOne(
      { _id: lookId },
      {
        $set: {
          status: 'ready',
          error: null,
          imageKey: key,
          previewKey: null,
          updatedAt: now,
          readyAt: now,
        },
      },
    )

    // The look was deleted while rendering.
    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
    }
  } catch (error) {
    app.log.error({ lookId: lookId.toString(), err: errorMessage(error) }, 'Look render failed')
    await markLookFailed(app, lookId)
  } finally {
    await storage.remove(previewKey).catch(() => undefined)
  }
}

// A locked look drawn ahead of time (LookDocument.teaser): its card shows
// it blurred, and unlocking it shows it right away. If they unlock it while
// it's drawing, the regular render takes over and this one is dropped.
async function runLookTeaser(app: FastifyInstance, lookId: ObjectId) {
  const look = await app.collections.looks.findOneAndUpdate(
    { _id: lookId, status: 'locked', teaser: null },
    { $set: { teaser: { status: 'processing', key: null, lockedKey: null } } },
    { returnDocument: 'after' },
  )

  if (!look) {
    return
  }

  const failed = () =>
    app.collections.looks.updateOne({ _id: lookId, 'teaser.status': 'processing' }, { $set: { 'teaser.status': 'failed' } })
  const avatar = await app.collections.avatars.findOne({ _id: look.avatarId })

  if (!avatar?.avatarKey) {
    await failed()
    return
  }

  try {
    const png = await generateImageFromReferences(await lookImageRequest(look, { ...avatar, avatarKey: avatar.avatarKey }))
    const stamp = Date.now()
    const key = `users/${look.userId.toString()}/look-${look._id.toString()}-${stamp}.webp`
    const lockedKey = `users/${look.userId.toString()}/look-${look._id.toString()}-${stamp}-locked.webp`
    const webp = await toStoredWebp(png)

    await Promise.all([storage.put(key, webp, 'image/webp'), storage.put(lockedKey, await blurTeaser(webp), 'image/webp')])

    const saved = await app.collections.looks.updateOne(
      { _id: lookId, status: 'locked', 'teaser.status': 'processing' },
      { $set: { teaser: { status: 'ready', key, lockedKey }, updatedAt: new Date() } },
    )

    // Unlocked (or deleted) while it drew.
    if (saved.matchedCount === 0) {
      await Promise.all([key, lockedKey].map((stale) => storage.remove(stale).catch(() => undefined)))
    }
  } catch (error) {
    app.log.error({ lookId: lookId.toString(), err: errorMessage(error) }, 'Locked look teaser failed')
    await failed()
  }
}

export function startLookTeaser(app: FastifyInstance, lookId: ObjectId) {
  void runLookTeaser(app, lookId).catch((error: unknown) => {
    app.log.error({ err: error, lookId: lookId.toString() }, 'Locked look teaser crashed')
  })
}

export function startLookRender(app: FastifyInstance, lookId: ObjectId) {
  void runLookRender(app, lookId).catch(async (error: unknown) => {
    app.log.error({ err: error, lookId: lookId.toString() }, 'Look render crashed')
    await markLookFailed(app, lookId).catch(() => undefined)
  })
}

// Every file a look owns in storage.
export function lookStorageKeys(
  look: Pick<LookDocument, 'imageKey' | 'previewKey' | 'referenceKey' | 'pieces' | 'teaser'>,
) {
  return [
    look.imageKey,
    look.previewKey,
    look.referenceKey,
    look.teaser?.key,
    look.teaser?.lockedKey,
    ...(look.pieces ?? []).map((piece) => piece.imageKey),
  ].filter((key): key is string => Boolean(key))
}

const PIECE_CONCURRENCY = 3

async function setPieceStatus(
  app: FastifyInstance,
  lookId: ObjectId,
  pieceId: string,
  update: Pick<LookPiece, 'status' | 'imageKey'>,
) {
  return app.collections.looks.updateOne(
    { _id: lookId, 'pieces.id': pieceId },
    {
      $set: {
        'pieces.$.status': update.status,
        'pieces.$.imageKey': update.imageKey,
        updatedAt: new Date(),
      },
    },
  )
}

async function renderPiece(
  app: FastifyInstance,
  look: LookDocument,
  piece: LookPiece,
  references: ImageInput[],
) {
  try {
    const png = await generateImageFromReferences({
      images: references,
      prompt: buildPiecePrompt(piece, references.length > 1),
      size: '1024x1024',
      model: env.AI_PIECE_MODEL,
      quality: env.AI_PIECE_QUALITY,
    })
    const key = `users/${look.userId.toString()}/look-${look._id.toString()}-piece-${piece.id}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const result = await setPieceStatus(app, look._id, piece.id, { status: 'ready', imageKey: key })

    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
    }
  } catch (error) {
    app.log.error(
      { lookId: look._id.toString(), pieceId: piece.id, err: errorMessage(error) },
      'Piece render failed',
    )
    await setPieceStatus(app, look._id, piece.id, { status: 'failed', imageKey: null })
  }
}

// Renders the given pieces as separate product photos, a few at a time.
export async function runPieceRenders(app: FastifyInstance, lookId: ObjectId, pieceIds: string[]) {
  const look = await app.collections.looks.findOne({ _id: lookId })

  if (!look?.imageKey) {
    return
  }

  const [lookImage, reference] = await Promise.all([
    storage.read(look.imageKey),
    look.referenceKey ? storage.read(look.referenceKey) : Promise.resolve(null),
  ])
  const references: ImageInput[] = [{ data: lookImage, filename: 'look.webp', contentType: 'image/webp' }]

  if (reference) {
    references.push({ data: reference, filename: 'outfit.jpg', contentType: 'image/jpeg' })
  }

  const queue = (look.pieces ?? []).filter((piece) => pieceIds.includes(piece.id))

  await Promise.all(
    Array.from({ length: PIECE_CONCURRENCY }, async () => {
      for (let piece = queue.shift(); piece; piece = queue.shift()) {
        await renderPiece(app, look, piece, references)
      }
    }),
  )
}

export function startPieceRenders(app: FastifyInstance, lookId: ObjectId, pieceIds: string[]) {
  void runPieceRenders(app, lookId, pieceIds).catch((error: unknown) => {
    app.log.error({ err: error, lookId: lookId.toString() }, 'Piece renders crashed')
    void app.collections.looks
      .updateOne(
        { _id: lookId },
        { $set: { 'pieces.$[piece].status': 'failed', updatedAt: new Date() } },
        { arrayFilters: [{ 'piece.status': 'processing', 'piece.id': { $in: pieceIds } }] },
      )
      .catch(() => undefined)
  })
}
