import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { AvatarDocument, MakeupTryOnDocument } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toPreviewWebp, toStoredWebp } from '../../utils/images.js'
import type { Locale } from '../../utils/locale.js'
import { generateImageFromReferences, type ImageInput } from '../../utils/openai.js'
import { currentLocale } from '../../utils/request-locale.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { releaseGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { billingState, loadBillingUser, refundCredits, releaseFreeUse, usePresetTryOn } from '../billing/entitlements.js'
import { MAKEUP_COLLECTIONS, MAKEUP_PRESETS, type MakeupPreset, findMakeupPreset } from './presets.js'
import { buildMakeupPrompt } from './prompts.js'

// Makeup try-ons (Face, Oct 17, 2026): a preset from the collections, or her
// own colors from the Color Report, drawn on her. One free without Pro
// (FREE_MAKEUP_TRY_ONS), then a credit each; the same preset again on the
// same selfie shows the one she has, at no charge.

const RENDER_FAILED = 'We could not show this makeup on you. Try again.'
const NEW_DAYS = 7
export const MY_COLORS = 'my-colors'

const say = (text: { en: string; es: string; 'pt-BR': string }, locale: Locale) => text[locale] ?? text.en

type Resolved = { id: string; name: string; render: string }

export class MakeupNotFoundError extends Error {}
export class MakeupLockedError extends Error {}

// Her lipstick shades to wear, from the Color Report's face test.
function myLips(avatar: AvatarDocument | null) {
  const test = avatar?.colorReport?.data.faceTest

  return test?.kind === 'lips' ? test.panels.filter((panel) => panel.verdict === 'wear') : []
}

async function ownsColorReport(app: FastifyInstance, userId: ObjectId) {
  const user = await loadBillingUser(app, userId)

  return Boolean(user && billingState(user).colorReport)
}

export async function resolveMakeupPreset(app: FastifyInstance, avatar: AvatarDocument, id: string): Promise<Resolved> {
  const locale = currentLocale() ?? 'en'
  const preset = findMakeupPreset(id)

  if (preset) {
    return { id: preset.id, name: say(preset.name, locale), render: preset.render }
  }

  if (id === MY_COLORS) {
    const lips = myLips(avatar)

    if (lips.length === 0) {
      throw new MakeupNotFoundError('No colors yet.')
    }

    if (!(await ownsColorReport(app, avatar.userId))) {
      throw new MakeupLockedError('Makeup in your colors comes with your Color Advisor.')
    }

    const lip = lips[0]!
    const names = { en: 'My colors', es: 'Mis colores', 'pt-BR': 'Minhas cores' }

    return {
      id,
      name: say(names, locale),
      render: `Polished natural makeup in her own colors: a satin ${lip.name} lipstick (close to ${lip.hex}), a soft blush in a matching tone, a wash of soft neutral shadow, brown-black mascara, groomed brows, even skin with real texture.`,
    }
  }

  throw new MakeupNotFoundError('No such makeup.')
}

export function makeupKeys(tryOn: Pick<MakeupTryOnDocument, 'imageKey' | 'previewKey'>) {
  return [tryOn.imageKey, tryOn.previewKey].filter((key): key is string => Boolean(key))
}

// Every makeup try-on of hers with its pictures: a new selfie (they show the
// old face), her avatar or her account deleted.
export async function deleteMakeupTryOns(app: FastifyInstance, userId: ObjectId) {
  const tryOns = await app.collections.makeupTryOns.find({ userId }, { projection: { imageKey: 1, previewKey: 1 } }).toArray()

  await Promise.all(tryOns.flatMap(makeupKeys).map((key) => storage.remove(key).catch(() => undefined)))
  await app.collections.makeupTryOns.deleteMany({ userId })
}

// A preset on her: the one she has for this selfie (`started` false, nothing
// charged), a failed one retried in place, or a new one. Throws PaywallError
// once her free one is used without Pro. The caller reserved 'makeup'.
export async function startMakeupTryOn(app: FastifyInstance, avatar: AvatarDocument, preset: Resolved) {
  const existing = await app.collections.makeupTryOns.findOne(
    { userId: avatar.userId, presetId: preset.id, selfieKey: avatar.selfieKey },
    { sort: { createdAt: -1 } },
  )

  if (existing && existing.status !== 'failed') {
    return { tryOn: existing, started: false }
  }

  const { creditSpent, freeUse } = await usePresetTryOn(app, avatar.userId, 'makeup', 'Trying on makeup')
  const now = new Date()
  const fields = {
    status: 'processing' as const,
    error: null,
    imageKey: null,
    previewKey: null,
    creditSpent,
    freeUse,
    updatedAt: now,
    readyAt: null,
  }
  let tryOn: MakeupTryOnDocument

  if (existing) {
    tryOn = { ...existing, ...fields }
    await app.collections.makeupTryOns.updateOne({ _id: existing._id }, { $set: fields })
  } else {
    tryOn = {
      _id: new ObjectId(),
      userId: avatar.userId,
      avatarId: avatar.avatarKey ? avatar._id : null,
      selfieKey: avatar.selfieKey,
      presetId: preset.id,
      name: preset.name,
      render: preset.render,
      createdAt: now,
      ...fields,
    }
    await app.collections.makeupTryOns.insertOne(tryOn)
  }

  startMakeupRender(app, tryOn._id)

  return { tryOn, started: true }
}

// Gives back what a failed render took: the credit or her free try-on, and
// today's makeup allowance with its picture.
export async function markMakeupFailed(app: FastifyInstance, tryOnId: ObjectId, error = RENDER_FAILED) {
  const tryOn = await app.collections.makeupTryOns.findOneAndUpdate(
    { _id: tryOnId, status: 'processing' },
    { $set: { status: 'failed', error, previewKey: null, updatedAt: new Date() } },
  )

  if (!tryOn) {
    return
  }

  await releaseGenerations(app, tryOn.userId, 'makeup', 1)

  if (tryOn.creditSpent) {
    const claimed = await app.collections.makeupTryOns.updateOne({ _id: tryOnId, creditSpent: true }, { $set: { creditSpent: false } })

    if (claimed.modifiedCount) {
      await refundCredits(app, tryOn.userId, 1)
    }
  }

  if (tryOn.freeUse) {
    const claimed = await app.collections.makeupTryOns.updateOne({ _id: tryOnId, freeUse: true }, { $set: { freeUse: false } })

    if (claimed.modifiedCount) {
      await releaseFreeUse(app, tryOn.userId, 'makeup')
    }
  }
}

// Draws the makeup on her (~25 s), saving previews as the model refines it.
export async function runMakeupRender(app: FastifyInstance, tryOnId: ObjectId) {
  const tryOn = await app.collections.makeupTryOns.findOne({ _id: tryOnId })

  if (!tryOn) {
    return
  }

  const avatar = await app.collections.avatars.findOne({ userId: tryOn.userId })

  if (!avatar || avatar.selfieKey !== tryOn.selfieKey) {
    await markMakeupFailed(app, tryOnId)
    return
  }

  const previewKey = `users/${tryOn.userId.toString()}/makeup-${tryOn._id.toString()}-preview.webp`
  const hasAvatar = Boolean(avatar.avatarKey)

  try {
    const [avatarImage, selfie] = await Promise.all([
      avatar.avatarKey ? storage.read(avatar.avatarKey) : Promise.resolve(null),
      storage.read(avatar.selfieKey),
    ])
    const images: ImageInput[] = [
      ...(avatarImage ? [{ data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' }] : []),
      { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
    ]
    const png = await generateImageFromReferences({
      images,
      prompt: buildMakeupPrompt({ name: tryOn.name, render: tryOn.render, hasAvatar }),
      size: '1024x1536',
      onPartial: async (partial) => {
        await storage.put(previewKey, await toPreviewWebp(partial), 'image/webp')
        await app.collections.makeupTryOns.updateOne({ _id: tryOnId, status: 'processing' }, { $set: { previewKey, updatedAt: new Date() } })
      },
    })
    const key = `users/${tryOn.userId.toString()}/makeup-${tryOn._id.toString()}-${Date.now()}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const now = new Date()
    const result = await app.collections.makeupTryOns.updateOne(
      { _id: tryOnId, status: 'processing' },
      { $set: { status: 'ready', error: null, imageKey: key, previewKey: null, updatedAt: now, readyAt: now } },
    )

    // Deleted (or cleared by a new selfie) while it rendered.
    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
      return
    }

    void trackServerEvent(app, { name: 'makeup_ready', userId: tryOn.userId, props: { preset: tryOn.presetId, free: tryOn.freeUse } })
  } catch (error) {
    app.log.error({ tryOnId: tryOnId.toString(), err: errorMessage(error) }, 'Makeup render failed')
    await markMakeupFailed(app, tryOnId)
  } finally {
    await storage.remove(previewKey).catch(() => undefined)
  }
}

export function startMakeupRender(app: FastifyInstance, tryOnId: ObjectId) {
  void runMakeupRender(app, tryOnId).catch(async (error: unknown) => {
    app.log.error({ err: error, tryOnId: tryOnId.toString() }, 'Makeup render crashed')
    await markMakeupFailed(app, tryOnId).catch(() => undefined)
  })
}

export async function serializeMakeupTryOn(tryOn: MakeupTryOnDocument) {
  const [imageUrl, previewUrl] = await Promise.all([signedUrlOrNull(tryOn.imageKey), signedUrlOrNull(tryOn.previewKey)])

  return {
    id: tryOn._id.toString(),
    presetId: tryOn.presetId,
    name: tryOn.name,
    status: tryOn.status,
    error: tryOn.error,
    imageUrl,
    previewUrl,
    createdAt: tryOn.createdAt.toISOString(),
    readyAt: tryOn.readyAt?.toISOString() ?? null,
  }
}

function isNew(droppedAt: string | null, now: number) {
  if (!droppedAt) {
    return false
  }

  const at = Date.parse(`${droppedAt}T00:00:00Z`)
  return at <= now && now - at < NEW_DAYS * 24 * 60 * 60 * 1000
}

// The steps to do it at home, for Pro only (the rest see that there are).
function presetView(preset: MakeupPreset, locale: Locale, pro: boolean) {
  return {
    id: preset.id,
    name: say(preset.name, locale),
    note: say(preset.note, locale),
    intensity: preset.intensity,
    swatches: preset.swatches,
    image: `/makeup-presets/${preset.id}.webp`,
    steps: pro ? preset.steps.map((step) => say(step, locale)) : [],
    stepsCount: preset.steps.length,
  }
}

// The studio: the collections (a dropped one first while new), her own
// colors (named only if she owns the Color Report), her try-ons for this
// selfie, and what she can still try free.
export async function serializeMakeupStudio(app: FastifyInstance, avatar: AvatarDocument | null, userId: ObjectId) {
  const locale = currentLocale() ?? 'en'
  const user = await loadBillingUser(app, userId)
  const state = user ? billingState(user) : null
  const pro = Boolean(state?.proActive)
  const now = Date.now()
  const lips = myLips(avatar)
  const tryOns = avatar
    ? await app.collections.makeupTryOns.find({ userId, selfieKey: avatar.selfieKey }).sort({ createdAt: -1 }).limit(60).toArray()
    : []
  const collections = [...MAKEUP_COLLECTIONS]
    .filter((collection) => !collection.droppedAt || Date.parse(`${collection.droppedAt}T00:00:00Z`) <= now)
    .sort((a, b) => Number(isNew(b.droppedAt, now)) - Number(isNew(a.droppedAt, now)))

  return {
    ready: Boolean(avatar?.selfieKey),
    hasAvatar: Boolean(avatar?.avatarKey),
    collections: collections.map((collection) => ({
      id: collection.id,
      emoji: collection.emoji,
      name: say(collection.name, locale),
      isNew: isNew(collection.droppedAt, now),
      presets: MAKEUP_PRESETS.filter((preset) => preset.collection === collection.id).map((preset) => presetView(preset, locale, pro)),
    })),
    myColors:
      lips.length === 0
        ? null
        : state?.colorReport
          ? { locked: false, lips: lips.slice(0, 3).map((lip) => ({ name: lip.name, hex: lip.hex })) }
          : { locked: true, lips: [] },
    tryOns: await Promise.all(tryOns.map(serializeMakeupTryOn)),
    freeLeft: state?.freeLeft?.makeup ?? null,
    pro,
  }
}
