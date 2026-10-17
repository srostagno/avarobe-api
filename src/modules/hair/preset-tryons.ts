import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { AvatarDocument, HairstyleDocument } from '../../types/mongo.js'
import type { Locale } from '../../utils/locale.js'
import { currentLocale } from '../../utils/request-locale.js'
import { billingState, loadBillingUser, usePresetTryOn } from '../billing/entitlements.js'
import { HAIR_PRESET_COLLECTIONS, HAIR_PRESETS, type HairPreset, PERSONAL_COLOR_PREFIX, findHairPreset } from './presets.js'
import { startHairstyleRender } from './service.js'

// Hair presets on her (Oct 17, 2026): the catalog's cuts and colors, and her
// own best hair colors from the Color Report. One free try without Pro
// (FREE_HAIR_PRESETS), then a credit each; trying one again on the same
// avatar shows the one she has, at no charge.

const say = (text: { en: string; es: string; 'pt-BR': string }, locale: Locale) => text[locale] ?? text.en

// A preset ready to render: from the catalog, or one of her best colors.
type Resolved = { id: string; kind: 'cut' | 'color'; name: string; note: string | null; brief: string | null; render: string }

// Her best hair colors (the Color Report's shades to wear), only for who
// owns the report or the Hair Advisor: nobody sees her colors before paying.
function personalColors(avatar: AvatarDocument | null) {
  const test = avatar?.colorReport?.data.hairTest

  if (!test || test.kind === 'beard') {
    return []
  }

  return test.panels
    .filter((panel) => panel.verdict === 'wear')
    .slice(0, 3)
    .map((panel, index) => ({ id: `${PERSONAL_COLOR_PREFIX}${index + 1}`, name: panel.name, hex: panel.hex }))
}

async function ownsPersonalColors(app: FastifyInstance, userId: ObjectId) {
  const user = await loadBillingUser(app, userId)
  const state = user ? billingState(user) : null

  return Boolean(state && (state.colorReport || state.hairAdvisor))
}

function resolveCatalog(preset: HairPreset, locale: Locale): Resolved {
  return {
    id: preset.id,
    kind: preset.kind,
    name: say(preset.name, locale),
    note: say(preset.note, locale),
    brief: say(preset.brief, locale),
    render: preset.render,
  }
}

export class PresetNotFoundError extends Error {}
export class PresetLockedError extends Error {}

export async function resolveHairPreset(app: FastifyInstance, avatar: AvatarDocument, id: string): Promise<Resolved> {
  const locale = currentLocale() ?? 'en'
  const preset = findHairPreset(id)

  if (preset) {
    return resolveCatalog(preset, locale)
  }

  if (id.startsWith(PERSONAL_COLOR_PREFIX)) {
    const color = personalColors(avatar).find((item) => item.id === id)

    if (!color) {
      throw new PresetNotFoundError('No such color.')
    }

    if (!(await ownsPersonalColors(app, avatar.userId))) {
      throw new PresetLockedError('Your best hair colors come with your Color Advisor.')
    }

    return {
      id,
      kind: 'color',
      name: color.name,
      note: null,
      brief: null,
      render: `A natural, dimensional ${color.name} hair color (close to ${color.hex}), soft and glossy, with gentle tonal variation as real colored hair has.`,
    }
  }

  throw new PresetNotFoundError('No such preset.')
}

// A preset on her: the one she already has on this avatar (`started` false,
// nothing charged), a failed one retried in place, or a new one. Throws
// PaywallError without Pro once her free one is used. The caller reserved
// today's 'hair' allowance.
export async function startPresetHairstyle(
  app: FastifyInstance,
  avatar: AvatarDocument,
  preset: Resolved,
): Promise<{ hairstyle: HairstyleDocument; started: boolean }> {
  const existing = await app.collections.hairstyles.findOne(
    { userId: avatar.userId, avatarId: avatar._id, source: 'preset', presetId: preset.id },
    { sort: { createdAt: -1 } },
  )

  if (existing && existing.status !== 'failed') {
    return { hairstyle: existing, started: false }
  }

  const { creditSpent, freeUse } = await usePresetTryOn(app, avatar.userId, 'hair_preset', 'Trying more hairstyles')
  const now = new Date()
  const fields = {
    status: 'processing' as const,
    error: null,
    imageKey: null,
    previewKey: null,
    creditSpent,
    freeRun: false,
    freePreset: freeUse,
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
      source: 'preset',
      recommendationId: null,
      presetId: preset.id,
      name: preset.name,
      why: preset.note,
      stylistBrief: preset.brief,
      fit: null,
      render: preset.render,
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

// The catalog in her language, her best colors (or how many there are,
// locked), and what she has tried on this avatar.
export async function serializeHairPresets(app: FastifyInstance, avatar: AvatarDocument | null, userId: ObjectId) {
  const locale = currentLocale() ?? 'en'
  const colors = personalColors(avatar)
  const owner = colors.length > 0 && (await ownsPersonalColors(app, userId))

  return {
    collections: HAIR_PRESET_COLLECTIONS.map((collection) => ({
      id: collection.id,
      emoji: collection.emoji,
      name: say(collection.name, locale),
      presets: HAIR_PRESETS.filter((preset) => preset.collection === collection.id).map((preset) => ({
        id: preset.id,
        kind: preset.kind,
        name: say(preset.name, locale),
        note: say(preset.note, locale),
        length: preset.length,
        upkeep: preset.upkeep,
        image: `/hair-presets/${preset.id}.webp`,
      })),
    })),
    // Her best colors: named and shown only to who owns them.
    personal: owner
      ? { locked: false, count: colors.length, colors: colors.map((color) => ({ id: color.id, name: color.name, hex: color.hex })) }
      : { locked: colors.length > 0, count: colors.length, colors: [] },
  }
}
