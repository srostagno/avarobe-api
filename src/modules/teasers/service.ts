import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { AvatarDocument, HairstyleDocument, LookDocument, MakeupTryOnDocument, TeaserDocument, TeaserKind } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { blurTeaser, toStoredWebp } from '../../utils/images.js'
import { generateImageFromReferences, type ImageInput } from '../../utils/openai.js'
import { currentLocale } from '../../utils/request-locale.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { billingState, loadBillingUser } from '../billing/entitlements.js'
import { buildHairstylePrompt } from '../hair/prompts.js'
import { NotAHaircutError, planHairRequest } from '../hair/service.js'
import { lookImageRequest } from '../looks/service.js'
import { BEST_FACE_PREFIX, bestFaceRender } from '../makeup/service.js'
import { buildMakeupPrompt } from '../makeup/prompts.js'
import { planFix } from '../scores/fix.js'

// Her best version, drawn ahead of time and shown blurred (Oct 18, 2026;
// Pro conversion plan, phase 1: "let her see her best version before she
// pays"). After her first Hair Score (or her Color Advisor) her perfect
// haircut, after her first Look Score her perfect look, after her first
// Face Age read her best face: once each, only without Pro, only when her
// avatar (or selfie) can draw it; the perfect haircut also from her Hair
// Score photo or selfie alone, before any avatar (a visitor from the haircut
// page or ad). With Pro, unlocking it shows it at once and makes it hers (a
// haircut, a look, a makeup try-on), at no credit.

const say = (text: { en: string; es: string; 'pt-BR': string }) => text[currentLocale() ?? 'en'] ?? text.en

type Context = {
  // What the read said to change (score or Face Age tips).
  tips: string[]
  // The score photo, for the perfect look (her outfit).
  photoKey?: string | null
  // Face Age's tips with their areas, for her best face.
  faceTips?: { area: string; text: string }[]
}

async function eligible(app: FastifyInstance, userId: ObjectId, kind: TeaserKind) {
  const user = await loadBillingUser(app, userId)

  if (!user || billingState(user).proActive) {
    return false
  }

  return !(await app.collections.teasers.findOne({ userId, kind }, { projection: { _id: 1 } }))
}

// Starts one when it can (never throws: it's a gift, not a step).
export async function maybeStartTeaser(app: FastifyInstance, userId: ObjectId, kind: TeaserKind, sourceId: ObjectId, context: Context) {
  try {
    if (!(await eligible(app, userId, kind))) {
      return null
    }

    const avatar = await app.collections.avatars.findOne({ userId })
    const withAvatar = Boolean(avatar?.avatarKey && avatar.status !== 'failed')
    // Without an avatar, the perfect haircut from her Hair Score photo, else her selfie.
    const photoKey = kind === 'perfect_haircut' && !withAvatar ? (context.photoKey ?? avatar?.selfieKey ?? null) : null
    const drawable = kind === 'best_face' ? Boolean(avatar?.selfieKey) : kind === 'perfect_look' ? withAvatar && Boolean(avatar?.body) : withAvatar || Boolean(photoKey)

    if (!drawable) {
      return null
    }

    // Drawn from her avatar or selfie (a new selfie takes it away), or from another photo of hers.
    const fromSelfie = avatar && (kind !== 'perfect_haircut' || withAvatar || photoKey === avatar.selfieKey) ? avatar : null

    // One of the day's pictures, like any other.
    if (!(await reserveGenerations(app, userId, 'image', 1))) {
      return null
    }

    const now = new Date()
    const teaser: TeaserDocument = {
      _id: new ObjectId(),
      userId,
      kind,
      sourceId,
      status: 'processing',
      error: null,
      key: null,
      lockedKey: null,
      plan: null,
      avatarId: fromSelfie?._id ?? null,
      selfieKey: fromSelfie?.selfieKey ?? null,
      unlockedAt: null,
      resultId: null,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await app.collections.teasers.insertOne(teaser)
    } catch {
      await releaseGenerations(app, userId, 'image', 1)
      return null
    }

    void runTeaser(app, teaser, avatar, context, photoKey).catch((error: unknown) => {
      app.log.error({ err: errorMessage(error), teaserId: teaser._id.toString() }, 'Teaser crashed')
    })
    void trackServerEvent(app, { name: 'teaser_started', userId, props: { kind } })

    return teaser
  } catch (error) {
    app.log.error({ err: errorMessage(error), kind }, 'Teaser could not start')
    return null
  }
}

// Like OpenAI wants it named: a stored photo is a JPEG, PNG or WebP.
function photoInput(data: Buffer): ImageInput {
  const type = data.subarray(0, 4).toString('latin1') === 'RIFF' ? 'webp' : data[0] === 0x89 ? 'png' : 'jpeg'
  return { data, filename: `photo.${type === 'jpeg' ? 'jpg' : type}`, contentType: `image/${type}` }
}

// On her avatar (full body and selfie), or (`photoKey`, no avatar yet) on
// one photo of her.
async function drawHaircut(avatar: AvatarDocument | null, context: Context, photoKey: string | null) {
  const ideal = avatar?.hairProfile?.data?.recommendations[0] ?? null
  const description = [
    'The haircut that would flatter this person most.',
    ideal ? `Their stylist's ideal cut for them: ${ideal.name}: ${ideal.render}.` : null,
    context.tips.length ? `What their hair needs: ${context.tips.join(' ')}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 900)
  const photo = avatar?.avatarKey ? null : await storage.read(photoKey!)
  let plan: Awaited<ReturnType<typeof planHairRequest>>

  try {
    plan = await planHairRequest({ avatar, face: photo ?? undefined, description, photo: null })
  } catch (error) {
    if (error instanceof NotAHaircutError && ideal) {
      plan = { name: ideal.name, render: ideal.render, stylistBrief: ideal.stylistBrief, fit: { verdict: 'great', note: ideal.why } }
    } else {
      throw error
    }
  }

  const images: ImageInput[] =
    avatar?.avatarKey && !photo
      ? [
          { data: await storage.read(avatar.avatarKey), filename: 'avatar.webp', contentType: 'image/webp' },
          { data: await storage.read(avatar.selfieKey), filename: 'face.jpg', contentType: 'image/jpeg' },
        ]
      : [photoInput(photo!)]
  const png = await generateImageFromReferences({
    images,
    prompt: buildHairstylePrompt({ name: plan.name, render: plan.render, hasReference: false, photoOnly: Boolean(photo) }),
    size: '1024x1536',
  })

  return { png, plan: { name: plan.name, render: plan.render, stylistBrief: plan.stylistBrief, fit: plan.fit } }
}

async function drawLook(app: FastifyInstance, teaser: TeaserDocument, avatar: AvatarDocument & { avatarKey: string }, context: Context) {
  if (!context.photoKey) {
    throw new Error('No photo to fix.')
  }

  const photo = await storage.read(context.photoKey)
  const { plan, dressCode } = await planFix(avatar, photo, context.tips)
  const look: LookDocument = {
    _id: new ObjectId(),
    userId: teaser.userId,
    avatarId: avatar._id,
    batchId: new ObjectId(),
    occasion: { text: 'Look Score', dressCode, summary: plan.summary },
    plan,
    source: 'stylist',
    status: 'processing',
    error: null,
    imageKey: null,
    collectionIds: [],
    favorite: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    readyAt: null,
  }
  const png = await generateImageFromReferences(await lookImageRequest(look, avatar))

  return { png, plan: { name: plan.title, render: plan.summary, look: plan, dressCode } }
}

async function drawBestFace(avatar: AvatarDocument, context: Context) {
  const tips = context.faceTips ?? []
  const render = bestFaceRender(tips)
  const [avatarImage, selfie] = await Promise.all([avatar.avatarKey ? storage.read(avatar.avatarKey) : Promise.resolve(null), storage.read(avatar.selfieKey)])
  const images: ImageInput[] = [
    ...(avatarImage ? [{ data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' }] : []),
    { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
  ]
  const name = say({ en: 'Your best face', es: 'Tu mejor rostro', 'pt-BR': 'Seu melhor rosto' })
  const png = await generateImageFromReferences({ images, prompt: buildMakeupPrompt({ name, render, hasAvatar: Boolean(avatarImage) }), size: '1024x1536' })

  return { png, plan: { name, render } }
}

async function runTeaser(app: FastifyInstance, teaser: TeaserDocument, avatar: AvatarDocument | null, context: Context, photoKey: string | null) {
  try {
    const drawn =
      teaser.kind === 'perfect_haircut'
        ? await drawHaircut(avatar, context, photoKey)
        : teaser.kind === 'perfect_look'
          ? await drawLook(app, teaser, { ...avatar!, avatarKey: avatar!.avatarKey! }, context)
          : await drawBestFace(avatar!, context)
    const stamp = Date.now()
    const key = `users/${teaser.userId.toString()}/teaser-${teaser._id.toString()}-${stamp}.webp`
    const lockedKey = `users/${teaser.userId.toString()}/teaser-${teaser._id.toString()}-${stamp}-locked.webp`
    const webp = await toStoredWebp(drawn.png)

    await Promise.all([storage.put(key, webp, 'image/webp'), storage.put(lockedKey, await blurTeaser(webp), 'image/webp')])

    const saved = await app.collections.teasers.findOneAndUpdate(
      { _id: teaser._id, status: 'processing' },
      { $set: { status: 'ready', key, lockedKey, plan: drawn.plan, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!saved) {
      await Promise.all([key, lockedKey].map((stale) => storage.remove(stale).catch(() => undefined)))
      return
    }

    void trackServerEvent(app, { name: 'teaser_ready', userId: teaser.userId, props: { kind: teaser.kind } })

    // Unlocked while it drew: hers now.
    if (saved.unlockedAt && !saved.resultId) {
      await materialize(app, saved)
    }
  } catch (error) {
    app.log.error({ err: errorMessage(error), teaserId: teaser._id.toString() }, 'Teaser failed')
    await app.collections.teasers.updateOne({ _id: teaser._id, status: 'processing' }, { $set: { status: 'failed', error: 'We could not draw it.', updatedAt: new Date() } })
    await releaseGenerations(app, teaser.userId, 'image', 1)
  }
}

// A ready teaser becomes hers: the haircut, the look or the makeup try-on,
// already drawn (its picture moves over; the blurred copy goes).
async function materialize(app: FastifyInstance, teaser: TeaserDocument) {
  if (teaser.status !== 'ready' || !teaser.key || !teaser.plan) {
    return null
  }

  const claimed = await app.collections.teasers.updateOne({ _id: teaser._id, resultId: null }, { $set: { resultId: new ObjectId(), updatedAt: new Date() } })

  if (claimed.modifiedCount === 0) {
    return (await app.collections.teasers.findOne({ _id: teaser._id }))?.resultId ?? null
  }

  const now = new Date()
  const plan = teaser.plan
  let resultId: ObjectId

  if (teaser.kind === 'perfect_haircut') {
    const hairstyle: HairstyleDocument = {
      _id: new ObjectId(),
      userId: teaser.userId,
      avatarId: teaser.avatarId,
      source: 'described',
      recommendationId: null,
      name: plan.name,
      why: null,
      stylistBrief: plan.stylistBrief ?? null,
      fit: plan.fit ?? null,
      render: plan.render,
      request: 'Teaser',
      referenceKey: null,
      status: 'ready',
      error: null,
      imageKey: teaser.key,
      previewKey: null,
      creditSpent: false,
      freeRun: false,
      createdAt: now,
      updatedAt: now,
      readyAt: now,
    }
    await app.collections.hairstyles.insertOne(hairstyle)
    await app.collections.scoreChecks.updateOne({ _id: teaser.sourceId, userId: teaser.userId }, { $set: { perfectHairstyleId: hairstyle._id } })
    resultId = hairstyle._id
  } else if (teaser.kind === 'perfect_look') {
    const look: LookDocument = {
      _id: new ObjectId(),
      userId: teaser.userId,
      avatarId: teaser.avatarId!,
      batchId: new ObjectId(),
      occasion: { text: 'Look Score', dressCode: plan.dressCode ?? '', summary: plan.look?.summary ?? plan.render },
      plan: plan.look!,
      source: 'stylist',
      status: 'ready',
      error: null,
      imageKey: teaser.key,
      creditSpent: false,
      collectionIds: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
      readyAt: now,
    }
    await app.collections.looks.insertOne(look)
    await app.collections.scoreChecks.updateOne({ _id: teaser.sourceId, userId: teaser.userId }, { $set: { fixLookId: look._id } })
    resultId = look._id
  } else {
    const tryOn: MakeupTryOnDocument = {
      _id: new ObjectId(),
      userId: teaser.userId,
      avatarId: teaser.avatarId,
      selfieKey: teaser.selfieKey ?? '',
      presetId: `${BEST_FACE_PREFIX}${teaser.sourceId.toString()}`,
      name: plan.name,
      render: plan.render,
      status: 'ready',
      error: null,
      imageKey: teaser.key,
      previewKey: null,
      creditSpent: false,
      freeUse: false,
      createdAt: now,
      updatedAt: now,
      readyAt: now,
    }
    await app.collections.makeupTryOns.insertOne(tryOn)
    resultId = tryOn._id
  }

  await app.collections.teasers.updateOne({ _id: teaser._id }, { $set: { resultId, lockedKey: null, updatedAt: now } })

  if (teaser.lockedKey) {
    await storage.remove(teaser.lockedKey).catch(() => undefined)
  }

  void trackServerEvent(app, { name: 'teaser_unlocked', userId: teaser.userId, props: { kind: teaser.kind } })

  return resultId
}

// With Pro: hers now if it's drawn, or as soon as it is.
export async function unlockTeaser(app: FastifyInstance, teaser: TeaserDocument) {
  await app.collections.teasers.updateOne({ _id: teaser._id, unlockedAt: null }, { $set: { unlockedAt: new Date(), updatedAt: new Date() } })
  const fresh = await app.collections.teasers.findOne({ _id: teaser._id })

  return fresh?.status === 'ready' ? materialize(app, fresh) : null
}

export async function serializeTeaser(teaser: TeaserDocument | null) {
  if (!teaser) {
    return null
  }

  return {
    id: teaser._id.toString(),
    kind: teaser.kind,
    sourceId: teaser.sourceId.toString(),
    status: teaser.status,
    name: teaser.plan?.name ?? null,
    // Only the blurred copy while it's locked.
    lockedUrl: teaser.resultId ? null : await signedUrlOrNull(teaser.lockedKey),
    unlocked: Boolean(teaser.unlockedAt),
    resultId: teaser.resultId?.toString() ?? null,
    createdAt: teaser.createdAt.toISOString(),
  }
}

export type SerializedTeaser = NonNullable<Awaited<ReturnType<typeof serializeTeaser>>>

// Her teasers' files and rows (her account or her content deleted). A
// teaser already unlocked hands its picture to what it became.
// All of hers, or (`sourceIds`) the ones drawn from those reads, or
// (`fromSelfie`, for a new selfie) the ones drawn from her avatar and selfie.
// One she unlocked keeps its picture: it's her haircut, look or makeup now.
export async function deleteTeasers(app: FastifyInstance, userId: ObjectId, scope: { sourceIds?: ObjectId[]; fromSelfie?: boolean } = {}) {
  const filter = {
    userId,
    ...(scope.sourceIds ? { sourceId: { $in: scope.sourceIds } } : {}),
    ...(scope.fromSelfie ? { selfieKey: { $ne: null } } : {}),
  }
  const teasers = await app.collections.teasers.find(filter).toArray()
  const keys = teasers.flatMap((teaser) => [teaser.resultId ? null : teaser.key, teaser.lockedKey]).filter((key): key is string => Boolean(key))

  await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
  await app.collections.teasers.deleteMany(filter)
}

// Ones a restart cut short: failed, their picture given back.
export async function failStaleTeasers(app: FastifyInstance, now = new Date()) {
  const stuck = await app.collections.teasers.find({ status: 'processing', updatedAt: { $lt: new Date(now.getTime() - 10 * 60 * 1000) } }).toArray()

  for (const teaser of stuck) {
    const result = await app.collections.teasers.updateOne({ _id: teaser._id, status: 'processing' }, { $set: { status: 'failed', error: 'Interrupted.', updatedAt: now } })

    if (result.modifiedCount) {
      await releaseGenerations(app, teaser.userId, 'image', 1)
    }
  }

  return stuck.length
}
