import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { emailCopy, monthYear } from '../../i18n/emails.js'
import type {
  AvatarDocument,
  EmailAsset,
  HairRecommendation,
  HairstyleDocument,
  LookDocument,
  UserDocument,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { generateImageFromReferences, type ImageInput } from '../../utils/openai.js'
import { withLocale } from '../../utils/request-locale.js'
import { seasonName } from '../../utils/seasons.js'
import { storage } from '../../utils/storage.js'
import { reserveGenerations } from '../../utils/usage.js'
import { presentationOf } from '../avatar/body.js'
import { billingState } from '../billing/entitlements.js'
import { hairstyleKeys, runHairProfile, runHairstyleRender } from '../hair/service.js'
import { EDITS, type Edit } from '../looks/edits.js'
import { catalogTable, iconImageUrl, looksFor, serializeIconLook } from '../looks/icon-routes.js'
import { lookStorageKeys, planLooks, runLookRender } from '../looks/service.js'
import { buildMagazinePhotoPrompt } from '../magazine/prompts.js'
import { readTaste, toStylistTaste } from '../taste/service.js'
import type { CrossSellKind } from './cross-sell.js'

// The pictures the cross-sell emails lead with, made from the buyer's own
// avatar, selfie and colors, so each email shows her something new about
// herself and the product is the way to see the rest (Oct 2026: the stock
// photos got opens and no clicks). Each one is made once, in the
// background, before its email is due to go out; one that fails is never
// retried, and the email goes out with its stock picture
// (lifecycle/service.ts sendCrossSells).

// Waiting on work that runs on its own (her free ideal cut, a hair read in
// progress): how often to look, and for how long.
const POLL_MS = 10_000
const WAIT_MS = 15 * 60 * 1000

type Job = { app: FastifyInstance; user: UserDocument; editId: string | null }
type Picture = { key: string; ref: string | null } | null

// Where a kind's picture is kept on the user (users.xsellAssets): by kind,
// or per Edit for the new-Edit email, which comes back with every Edit.
export function assetSlot(kind: CrossSellKind, editId: string | null) {
  return kind === 'xsell_edit' ? `edit:${editId ?? ''}` : kind
}

// An Edit's name and line in the reader's language (catalog.*.ts), inside
// withLocale.
export function editText(edit: Pick<Edit, 'id' | 'name' | 'tagline'>) {
  const text = catalogTable()?.edits[edit.id]
  return { id: edit.id, name: text?.name ?? edit.name, tagline: text?.tagline ?? edit.tagline }
}

// The Edit a look was tried on from.
export function editOfIcon(iconId: string | null | undefined) {
  return iconId ? (EDITS.find((edit) => edit.looks.some((look) => look.id === iconId)) ?? null) : null
}

const readyAvatar = (avatar: AvatarDocument | null): avatar is AvatarDocument & { avatarKey: string } =>
  Boolean(avatar && avatar.status === 'ready' && avatar.avatarKey)

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + WAIT_MS
  let value = await read()

  while (!done(value) && Date.now() < until) {
    await sleep(POLL_MS, undefined, { ref: false })
    value = await read()
  }

  return value
}

// ---------------------------------------------------------------- looks

// Draws a gift look and gives back its picture. One that fails is removed:
// she never asked for it, and retrying it in the app would cost a credit.
async function renderGiftLook(app: FastifyInstance, lookId: ObjectId): Promise<Picture> {
  await runLookRender(app, lookId).catch((error: unknown) => {
    app.log.error({ err: errorMessage(error), lookId: lookId.toString() }, 'Gift look render crashed')
  })

  const look = await app.collections.looks.findOne({ _id: lookId })

  if (look?.status === 'ready' && look.imageKey) {
    return { key: look.imageKey, ref: lookId.toString() }
  }

  if (look) {
    await app.collections.looks.deleteOne({ _id: lookId, status: { $ne: 'ready' } })
    await Promise.all(lookStorageKeys(look).map((key) => storage.remove(key).catch(() => undefined)))
  }

  return null
}

// xsell_style: a look styled around her #1 color, as POST /looks plans one
// (with her taste), its main piece set to exactly that color. A gift: it
// shows in her Looks, takes no credit and none of today's allowance.
async function giftLook({ app, user }: Job): Promise<Picture> {
  const avatar = await app.collections.avatars.findOne({ userId: user._id })
  const best = avatar?.colorAnalysis?.bestColors[0]

  if (!readyAvatar(avatar) || !best) {
    return null
  }

  const brief = emailCopy(user.locale).crossSell.gift
  const notes = brief.notes(best.name, best.hex)
  const plan = await planLooks({
    avatar,
    occasion: brief.occasion,
    notes,
    count: 1,
    taste: toStylistTaste(await readTaste(app, user._id)),
  })
  const planned = plan.looks[0]

  if (!planned) {
    return null
  }

  // The stylist was asked to build around it; this makes sure the piece the
  // look leads with is exactly her color.
  const [hero, ...rest] = planned.items
  const items = hero ? [{ ...hero, color: best.name, colorHex: best.hex.toUpperCase() }, ...rest] : rest
  const now = new Date()
  const look: LookDocument = {
    _id: new ObjectId(),
    userId: user._id,
    avatarId: avatar._id,
    batchId: new ObjectId(),
    occasion: { text: brief.occasion, notes, dressCode: plan.dressCode, summary: plan.occasionSummary, asks: plan.asks },
    plan: { ...planned, items },
    gift: 'email',
    status: 'processing',
    error: null,
    imageKey: null,
    creditSpent: false,
    collectionIds: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
  }

  await app.collections.looks.insertOne(look)

  return renderGiftLook(app, look._id)
}

// xsell_pro, xsell_edit: the first look of an Edit for how she dresses,
// tried on her avatar like a tap in the Edits (looks/try-on.ts) without the
// plan, credit or allowance, and without the stylist's read of the photo:
// the catalog has the pieces. A gift, like the look above.
async function editTryOn({ app, user, editId }: Job): Promise<Picture> {
  const edit = EDITS.find((item) => item.id === editId)
  const avatar = await app.collections.avatars.findOne({ userId: user._id })

  if (!edit || !readyAvatar(avatar)) {
    return null
  }

  const icon = looksFor(edit.looks, presentationOf(avatar))[0]

  if (!icon) {
    return null
  }

  const photo = await readFile(iconImageUrl(icon))
  // What she reads in her language; the pieces stay as the catalog has them
  // for the image model, as in the app's try-ons.
  const shown = serializeIconLook(icon)
  const lookId = new ObjectId()
  const referenceKey = `users/${user._id.toString()}/look-${lookId.toString()}-reference.jpg`
  const now = new Date()
  const look: LookDocument = {
    _id: lookId,
    userId: user._id,
    avatarId: avatar._id,
    batchId: new ObjectId(),
    occasion: { text: editText(edit).name, dressCode: shown.mood, summary: shown.description },
    plan: {
      title: shown.name,
      vibe: shown.mood.slice(0, 24),
      summary: shown.description,
      whyItWorks: shown.description,
      items: icon.items.map((item) => ({ ...item, fromPhoto: true })),
      stylingTips: [],
    },
    source: 'tryon',
    iconId: icon.id,
    referenceKey,
    gift: 'email',
    status: 'processing',
    error: null,
    imageKey: null,
    creditSpent: false,
    collectionIds: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
  }

  await storage.put(referenceKey, photo, 'image/jpeg')

  try {
    await app.collections.looks.insertOne(look)
  } catch (error) {
    await storage.remove(referenceKey).catch(() => undefined)
    throw error
  }

  return renderGiftLook(app, lookId)
}

// ---------------------------------------------------------------- hair

// Her ideal cut rendered on her, free: what startRecommendedHairstyle does,
// without the entitlement or the allowance. A failed cut of hers is redone
// in place; a new one that fails is removed.
async function giftCut(
  app: FastifyInstance,
  avatar: AvatarDocument,
  ideal: HairRecommendation,
  failed: HairstyleDocument | null,
): Promise<HairstyleDocument | null> {
  const now = new Date()
  const fields = {
    status: 'processing' as const,
    error: null,
    imageKey: null,
    previewKey: null,
    creditSpent: false,
    freeRun: false,
    gift: 'email' as const,
    updatedAt: now,
    readyAt: null,
  }
  let id: ObjectId

  if (failed) {
    id = failed._id
    await app.collections.hairstyles.updateOne({ _id: id, status: 'failed' }, { $set: fields })
  } else {
    id = new ObjectId()
    await app.collections.hairstyles.insertOne({
      _id: id,
      userId: avatar.userId,
      avatarId: avatar._id,
      source: 'recommended',
      recommendationId: ideal.id,
      name: ideal.name,
      why: ideal.why,
      stylistBrief: ideal.stylistBrief,
      fit: null,
      render: ideal.render,
      request: null,
      referenceKey: null,
      createdAt: now,
      ...fields,
    })
  }

  await runHairstyleRender(app, id)

  const done = await app.collections.hairstyles.findOne({ _id: id })

  if (done && done.status !== 'ready') {
    if (failed) {
      // Hers again, as it was: a retry from the app takes her allowance.
      await app.collections.hairstyles.updateOne({ _id: id }, { $unset: { gift: '' } })
    } else {
      await app.collections.hairstyles.deleteOne({ _id: id, status: { $ne: 'ready' } })
      await Promise.all(hairstyleKeys(done).map((key) => storage.remove(key).catch(() => undefined)))
    }
  }

  return done
}

// xsell_hair: the cut that suits her best (the read's first recommendation)
// on her photo. Shown as it is, unblurred: the Hair studio gives it free.
async function idealCut({ app, user }: Job): Promise<Picture> {
  let avatar = await app.collections.avatars.findOne({ userId: user._id })

  if (!avatar?.avatarKey || avatar.status === 'failed') {
    return null
  }

  const avatarId = avatar._id
  const readAvatar = () => app.collections.avatars.findOne({ _id: avatarId })

  if (avatar.hairProfile?.status === 'processing') {
    avatar = await waitFor(readAvatar, (current) => current?.hairProfile?.status !== 'processing')
  } else if (avatar.hairProfile?.status !== 'ready' || !avatar.hairProfile.data) {
    // Her hair read first, as the Hair studio starts it (it counts toward
    // today's hair allowance, which a failed read gives back). With her free
    // haircut left, it starts the ideal cut on its own.
    if (!(await reserveGenerations(app, user._id, 'hair', 1))) {
      return null
    }

    const startedAt = new Date()

    await app.collections.avatars.updateOne(
      { _id: avatarId },
      { $set: { hairProfile: { status: 'processing', data: null, error: null, startedAt, updatedAt: startedAt } } },
    )
    await runHairProfile(app, avatarId, startedAt)
    avatar = await readAvatar()
  }

  const ideal = avatar?.hairProfile?.status === 'ready' ? avatar.hairProfile.data?.recommendations[0] : undefined

  if (!avatar || !ideal) {
    return null
  }

  const find = () => app.collections.hairstyles.findOne({ userId: user._id, source: 'recommended', recommendationId: ideal.id })
  let hairstyle = await find()

  if (hairstyle?.status === 'processing') {
    hairstyle = await waitFor(find, (current) => current?.status !== 'processing')
  }

  if (!hairstyle || hairstyle.status === 'failed') {
    hairstyle = await giftCut(app, avatar, ideal, hairstyle)
  }

  return hairstyle?.status === 'ready' && hairstyle.imageKey ? { key: hairstyle.imageKey, ref: hairstyle._id.toString() } : null
}

// ---------------------------------------------------------------- magazine

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

const SERIF = "Didot, 'Bodoni 72', 'Playfair Display', Georgia, 'Times New Roman', 'DejaVu Serif', serif"

let textWorks: Promise<boolean> | null = null

// Whether this machine can draw SVG text at all: it uses the system's fonts,
// and a server with none draws nothing. Checked once, by drawing a word and
// looking for ink.
function canDrawText() {
  textWorks ??= sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="45" font-family="${SERIF}" font-size="40" fill="#000">Avarobe</text></svg>`,
    ),
  )
    .ensureAlpha()
    .stats()
    .then((stats) => (stats.channels[3]?.max ?? 0) > 0)
    .catch(() => false)

  return textWorks
}

// The cover's words over the photo: her first name as the masthead
// (AVAROBE without one) and the issue line at the bottom. Drawn here, not by
// the image model, so the name is spelled right. Where no font can be drawn,
// the cover goes without words rather than with an empty masthead.
export async function withMasthead(image: Buffer, firstName: string, issue: string, log?: { warn: (message: string) => void }) {
  if (!(await canDrawText())) {
    log?.warn('No font to draw the magazine masthead with; sending the cover without it (install a serif font)')
    return sharp(image).webp({ quality: 88 }).toBuffer()
  }

  const { width = 1024, height = 1536 } = await sharp(image).metadata()
  const masthead = (firstName.trim() || 'Avarobe').toUpperCase().slice(0, 24)
  // Long names get smaller type, so the masthead stays inside the cover.
  const size = Math.round(Math.min(width * 0.2, (width * 0.88) / (masthead.length * 0.74)))
  const sans = "'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif"
  const issueSize = Math.round(width * 0.024)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <filter id="shadow" x="-10%" y="-20%" width="120%" height="160%"><feDropShadow dx="0" dy="${Math.round(size * 0.02)}" stdDeviation="${Math.round(size * 0.04)}" flood-color="#000000" flood-opacity="0.35"/></filter>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.4"/></linearGradient>
  </defs>
  <text x="50%" y="${Math.round(height * 0.035 + size * 0.82)}" text-anchor="middle" font-family="${SERIF}" font-size="${size}" letter-spacing="${Math.round(size * 0.04)}" fill="#ffffff" filter="url(#shadow)">${escapeXml(masthead)}</text>
  <rect x="0" y="${height - Math.round(height * 0.12)}" width="${width}" height="${Math.round(height * 0.12)}" fill="url(#fade)"/>
  <text x="50%" y="${height - Math.round(height * 0.035)}" text-anchor="middle" font-family="${sans}" font-size="${issueSize}" letter-spacing="${Math.round(issueSize * 0.25)}" fill="#ffffff" filter="url(#shadow)">${escapeXml(issue.toUpperCase())}</text>
</svg>`

  return sharp(image)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 88 })
    .toBuffer()
}

// xsell_magazine: the cover of the magazine she could have, from her avatar
// and selfie like the magazine's own photos. Only Color Advisor owners wear
// their best colors on it; anyone else wears classic neutrals, so the cover
// gives none of their colors away.
async function magazineCover({ app, user }: Job): Promise<Picture> {
  const avatar = await app.collections.avatars.findOne({ userId: user._id })

  if (!readyAvatar(avatar)) {
    return null
  }

  const [avatarImage, selfie] = await Promise.all([storage.read(avatar.avatarKey), storage.read(avatar.selfieKey)])
  const images: ImageInput[] = [
    { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
    { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
  ]
  const colors = billingState(user).colorReport ? (avatar.colorAnalysis?.bestColors ?? []).slice(0, 3) : []
  const outfit = colors.length
    ? `one standout outfit made only of these colors from their color analysis, no other colors: ${colors.map((color) => `${color.name} (${color.hex})`).join(', ')}`
    : 'one standout outfit in classic, refined neutrals (navy, camel, ivory or charcoal)'
  const png = await generateImageFromReferences({
    images,
    prompt: buildMagazinePhotoPrompt(
      {
        location: 'a clean photo studio with a plain seamless backdrop in a soft, muted tone that flatters the outfit, softly lit',
        outfit,
        pose: 'a confident editorial cover pose, standing tall with relaxed shoulders, looking straight into the camera',
      },
      { cover: true },
    ),
    size: '1024x1536',
    model: 'gpt-image-2',
    quality: 'medium',
  })
  const season = avatar.colorAnalysis ? seasonName(avatar.colorAnalysis.season, user.locale) : null
  const issue = emailCopy(user.locale).crossSell.magazine.issue(season, monthYear(new Date(), user.locale))
  const key = `users/${user._id.toString()}/email-magazine-${Date.now()}.webp`

  await storage.put(key, await withMasthead(png, user.firstName, issue, app.log), 'image/webp')

  return { key, ref: null }
}

// ---------------------------------------------------------------- running

const GENERATORS: Partial<Record<CrossSellKind, (job: Job) => Promise<Picture>>> = {
  xsell_style: giftLook,
  xsell_hair: idealCut,
  xsell_pro: editTryOn,
  xsell_edit: editTryOn,
  xsell_magazine: magazineCover,
}

export function hasGenerator(kind: CrossSellKind) {
  return Boolean(GENERATORS[kind])
}

// Makes a kind's picture for her and returns it (null when it can't be
// made), in her language: background work has no request to take it from.
// Exported for scripts/xsell-asset.ts.
export async function generateAsset(app: FastifyInstance, user: UserDocument, kind: CrossSellKind, editId: string | null) {
  const generate = GENERATORS[kind]
  return generate ? withLocale(user.locale ?? 'en', () => generate({ app, user, editId })) : null
}

// Claims the slot and makes its picture in the background. False when
// there's nothing to make or another run claimed it first.
export async function startAsset(app: FastifyInstance, user: UserDocument, kind: CrossSellKind, editId: string | null, now: Date) {
  if (!hasGenerator(kind)) {
    return false
  }

  const field = `xsellAssets.${assetSlot(kind, editId)}`
  const processing: EmailAsset = { status: 'processing', key: null, ref: null, startedAt: now }
  const claimed = await app.collections.users.updateOne({ _id: user._id, [field]: { $exists: false } }, { $set: { [field]: processing } })

  if (claimed.modifiedCount === 0) {
    return false
  }

  // Only this run can finish it.
  const finish = (picture: Picture) => {
    const asset: EmailAsset = picture
      ? { status: 'ready', key: picture.key, ref: picture.ref, startedAt: now, readyAt: new Date() }
      : { status: 'failed', key: null, ref: null, startedAt: now }
    return app.collections.users.updateOne({ _id: user._id, [`${field}.startedAt`]: now }, { $set: { [field]: asset } })
  }

  void generateAsset(app, user, kind, editId)
    .then(async (picture) => {
      const saved = await finish(picture)

      // The account went (or started over) meanwhile. The magazine cover is
      // its own file; the others belong to a look or a haircut.
      if (saved.matchedCount === 0 && picture && kind === 'xsell_magazine') {
        await storage.remove(picture.key).catch(() => undefined)
      }

      app.log.info({ userId: user._id.toString(), kind, ready: Boolean(picture) }, 'Cross-sell picture')
    })
    .catch(async (error: unknown) => {
      app.log.error({ err: errorMessage(error), userId: user._id.toString(), kind }, 'Cross-sell picture failed')
      await finish(null).catch(() => undefined)
    })

  return true
}
