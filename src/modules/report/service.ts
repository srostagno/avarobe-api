import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type {
  AvatarDocument,
  ColorReport,
  ColorSwatch,
  DrapePreviewLayout,
  LookAnalysis,
  LookDocument,
  Presentation,
  StyleProfile,
  TestSwatch,
  Verdict,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { lockBestPanels, lockBestSide, toStoredWebp } from '../../utils/images.js'
import { createStructuredResponse, generateImageFromReferences, toDataUrl } from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'
import { hairReference } from '../avatar/hair.js'
import {
  COLOR_REPORT_INSTRUCTIONS,
  LOOK_ANALYSIS_INSTRUCTIONS,
  STYLE_PROFILE_INSTRUCTIONS,
  buildColorReportRequest,
  buildDrapeGridPreviewPrompt,
  buildDrapePreviewPrompt,
  buildSelfieDrapePreviewPrompt,
  buildDrapePrompt,
  selfieOnly,
  buildLookAnalysisRequest,
  buildStyleProfileRequest,
  colorReportSchema,
  lookAnalysisSchema,
  styleProfileSchema,
} from './prompts.js'
import { bodyOf, presentationOf } from '../avatar/body.js'

const HEX = /^#[0-9a-f]{6}$/i

const cleanSwatches = (list: ColorSwatch[], max: number) =>
  list
    .filter((swatch) => HEX.test(swatch.hex))
    .slice(0, max)
    .map((swatch) => ({ name: swatch.name.trim(), hex: swatch.hex.toUpperCase() }))

const clampScore = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

// Tests read what to wear first, then what to avoid, whatever order the
// model wrote them in.
const wearFirst = <T extends { verdict: Verdict }>(panels: T[]) => [
  ...panels.filter((panel) => panel.verdict === 'wear'),
  ...panels.filter((panel) => panel.verdict !== 'wear'),
]

const cleanTestSwatches = (list: TestSwatch[], max: number) =>
  wearFirst(list.filter((swatch) => HEX.test(swatch.hex)))
    .slice(0, max)
    .map((swatch) => ({ name: swatch.name.trim(), hex: swatch.hex.toUpperCase(), verdict: swatch.verdict }))

// Written from the selfie; it needs how they shop (the body's, or asked on
// its own before the avatar) but not the avatar itself.
export async function generateColorReport(avatar: AvatarDocument, presentation = presentationOf(avatar) ?? 'unisex'): Promise<ColorReport> {
  const selfie = await storage.read(avatar.selfieKey)
  const report = await createStructuredResponse<ColorReport>({
    instructions: COLOR_REPORT_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: buildColorReportRequest(avatar, presentation) },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'color_report',
    schema: colorReportSchema,
    timeoutMs: 120_000,
  })

  return cleanColorReport(report, presentation)
}

// Keeps the model's report within what the page and the boards expect.
export function cleanColorReport(report: ColorReport, presentation: Presentation): ColorReport {
  const { neutralsTest, whitesTest, faceTest, hairTest } = report

  return {
    ...report,
    scales: {
      undertone: { ...report.scales.undertone, value: clampScore(report.scales.undertone.value) },
      depth: { ...report.scales.depth, value: clampScore(report.scales.depth.value) },
      chroma: { ...report.scales.chroma, value: clampScore(report.scales.chroma.value) },
      contrast: { ...report.scales.contrast, value: clampScore(report.scales.contrast.value) },
    },
    palette: {
      basics: cleanSwatches(report.palette.basics, 10),
      accents: cleanSwatches(report.palette.accents, 12),
      statements: cleanSwatches(report.palette.statements, 10),
    },
    combinations: report.combinations
      .slice(0, 6)
      .map((combination) => ({ ...combination, colors: cleanSwatches(combination.colors, 3) })),
    guides: report.guides.slice(0, 6),
    drape: { wear: cleanSwatches(report.drape.wear, 2), avoid: cleanSwatches(report.drape.avoid, 2) },
    gameChangers: report.gameChangers?.slice(0, 3),
    neutralsTest: neutralsTest && { ...neutralsTest, panels: cleanTestSwatches(neutralsTest.panels, 4) },
    whitesTest: whitesTest && { ...whitesTest, panels: cleanTestSwatches(whitesTest.panels, 4) },
    // Lips or shirts follow how they dress; the model only picks the colors.
    faceTest: faceTest && {
      ...faceTest,
      kind: presentation === 'menswear' ? 'shirts' : 'lips',
      panels: cleanTestSwatches(faceTest.panels, 4),
    },
    // Facial hair for menswear, hair color otherwise, like lips and shirts.
    hairTest: hairTest && {
      ...hairTest,
      kind: presentation === 'menswear' ? 'beard' : 'color',
      current: hairTest.current.trim(),
      panels: cleanTestSwatches(hairTest.panels, 3),
    },
    paletteLooks: report.paletteLooks?.slice(0, 4),
  }
}

async function markDrape(app: FastifyInstance, avatarId: ObjectId, set: Record<string, unknown>) {
  return app.collections.avatars.updateOne({ _id: avatarId, drape: { $ne: null } }, { $set: set })
}

// Renders the drape test in the background (one image, ~30 s): from the
// avatar and the selfie, or from the selfie alone before the avatar.
export async function runDrapeTest(app: FastifyInstance, avatarId: ObjectId) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })
  const drape = avatar?.drape

  if (!avatar || !drape || drape.wear.length < 2 || drape.avoid.length < 2) {
    await markDrape(app, avatarId, { 'drape.status': 'failed', 'drape.updatedAt': new Date() })
    return
  }

  try {
    const selfie = await storage.read(avatar.selfieKey)
    const face = { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' }
    const png = avatar.avatarKey
      ? await (async () => {
          const [avatarImage, hair] = await Promise.all([storage.read(avatar.avatarKey!), hairReference(avatar, 3)])

          return generateImageFromReferences({
            images: [{ data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' }, face, ...(hair ? [hair.image] : [])],
            prompt: hair ? `${buildDrapePrompt(drape)} ${hair.line}` : buildDrapePrompt(drape),
            size: '1024x1024',
          })
        })()
      : await generateImageFromReferences({
          images: [{ ...face, filename: 'selfie.jpg' }],
          prompt: selfieOnly(buildDrapePrompt(drape)),
          size: '1024x1024',
        })
    const key = `users/${avatar.userId.toString()}/drape-${Date.now()}.webp`

    await storage.put(key, await toStoredWebp(png), 'image/webp')

    const result = await markDrape(app, avatarId, { 'drape.status': 'ready', 'drape.key': key, 'drape.updatedAt': new Date() })

    if (result.matchedCount === 0) {
      await storage.remove(key).catch(() => undefined)
    } else if (drape.key && drape.key !== key) {
      await storage.remove(drape.key).catch(() => undefined)
    }
  } catch (error) {
    app.log.error({ avatarId: avatarId.toString(), err: errorMessage(error) }, 'Drape test failed')
    await markDrape(app, avatarId, { 'drape.status': 'failed', 'drape.updatedAt': new Date() })
  }
}

// The free preview (their best colors and their worst on their face):
// starts once per selfie, from the free color analysis. A failed one can
// start again. Returns whether it started.
export async function startDrapePreview(app: FastifyInstance, avatarId: ObjectId) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })
  const bests = avatar?.colorAnalysis?.bestColors.slice(0, 3) ?? []
  const best = bests[0]
  const worst = avatar?.colorAnalysis?.avoidColors[0]
  const layout: DrapePreviewLayout = env.BEST_COLORS_GRID && bests.length === 3 ? 'grid' : 'pair'

  // Without an avatar yet (colors first) it's drawn from the selfie alone.
  if (!avatar || avatar.status !== 'ready' || !best || !worst) {
    return false
  }

  const claimed = await app.collections.avatars.updateOne(
    {
      _id: avatarId,
      selfieKey: avatar.selfieKey,
      // Not made yet, failed a while ago, or stuck after a restart.
      $or: [
        { drapePreview: null },
        { 'drapePreview.status': 'failed', 'drapePreview.updatedAt': { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
        { 'drapePreview.status': 'processing', 'drapePreview.updatedAt': { $lt: new Date(Date.now() - 10 * 60 * 1000) } },
      ],
    },
    {
      $set: {
        drapePreview: { status: 'processing', key: null, layout, best, ...(layout === 'grid' ? { bests } : {}), worst, updatedAt: new Date() },
      },
    },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  void runDrapePreview(app, avatarId).catch((error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Drape preview crashed')
  })

  return true
}

async function runDrapePreview(app: FastifyInstance, avatarId: ObjectId) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })
  const preview = avatar?.drapePreview
  const mark = (set: Record<string, unknown>) =>
    app.collections.avatars.updateOne(
      { _id: avatarId, 'drapePreview.status': 'processing', selfieKey: avatar?.selfieKey },
      { $set: { ...set, 'drapePreview.updatedAt': new Date() } },
    )

  if (!avatar || !preview) {
    return
  }

  try {
    const [avatarImage, selfie, hair] = await Promise.all([
      avatar.avatarKey ? storage.read(avatar.avatarKey) : Promise.resolve(null),
      storage.read(avatar.selfieKey),
      avatar.avatarKey ? hairReference(avatar, 3) : Promise.resolve(null),
    ])
    const grid = preview.layout === 'grid' && preview.bests?.length === 3
    const base = grid
      ? buildDrapeGridPreviewPrompt(preview.bests!, preview.worst, !avatarImage)
      : avatarImage
        ? buildDrapePreviewPrompt(preview.best, preview.worst)
        : buildSelfieDrapePreviewPrompt(preview.best, preview.worst)
    const png = await generateImageFromReferences({
      images: avatarImage
        ? [
            { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
            { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
            ...(hair ? [hair.image] : []),
          ]
        : [{ data: selfie, filename: 'selfie.jpg', contentType: 'image/jpeg' }],
      prompt: hair ? `${base} ${hair.line}` : base,
      size: grid ? '1024x1024' : '1536x1024',
    })
    const stamp = Date.now()
    const key = `users/${avatar.userId.toString()}/drape-preview-${stamp}.webp`
    const webp = await toStoredWebp(png)

    await storage.put(key, webp, 'image/webp')
    const lockedKey = await storeLockedPreview(app, avatar.userId, webp, stamp, grid ? 'grid' : 'pair')

    // A new selfie while it rendered: the preview is of the old face.
    if ((await mark({ 'drapePreview.status': 'ready', 'drapePreview.key': key, 'drapePreview.lockedKey': lockedKey })).matchedCount === 0) {
      await Promise.all([key, lockedKey].map((stale) => (stale ? storage.remove(stale).catch(() => undefined) : undefined)))
    }
  } catch (error) {
    app.log.error({ avatarId: avatarId.toString(), err: errorMessage(error) }, 'Drape preview failed')
    await mark({ 'drapePreview.status': 'failed' })
  }
}

// The locked copy of the preview (the best colors blurred). Null if it
// couldn't be made: it's made again the next time it's needed.
async function storeLockedPreview(app: FastifyInstance, userId: ObjectId, webp: Buffer, stamp: number, layout: DrapePreviewLayout) {
  try {
    const key = `users/${userId.toString()}/drape-preview-${stamp}-locked.webp`

    await storage.put(key, await (layout === 'grid' ? lockBestPanels(webp) : lockBestSide(webp)), 'image/webp')
    return key
  } catch (error) {
    app.log.error({ err: errorMessage(error), userId: userId.toString() }, 'Locked drape preview failed')
    return null
  }
}

// Previews made before the lock existed get their locked copy the first
// time someone who hasn't unlocked it opens the studio.
export async function ensureLockedPreview(app: FastifyInstance, avatar: AvatarDocument): Promise<AvatarDocument> {
  const preview = avatar.drapePreview

  if (!env.LOCK_BEST_COLOR || preview?.status !== 'ready' || !preview.key || preview.lockedKey) {
    return avatar
  }

  try {
    const lockedKey = await storeLockedPreview(app, avatar.userId, await storage.read(preview.key), Date.now(), preview.layout ?? 'pair')

    if (!lockedKey) {
      return avatar
    }

    const updated = await app.collections.avatars.findOneAndUpdate(
      { _id: avatar._id, 'drapePreview.key': preview.key },
      { $set: { 'drapePreview.lockedKey': lockedKey } },
      { returnDocument: 'after' },
    )

    return updated ?? avatar
  } catch (error) {
    app.log.error({ err: errorMessage(error), avatarId: avatar._id.toString() }, 'Could not lock an existing drape preview')
    return avatar
  }
}

export function startDrapeTest(app: FastifyInstance, avatarId: ObjectId) {
  void runDrapeTest(app, avatarId).catch((error: unknown) => {
    app.log.error({ err: error, avatarId: avatarId.toString() }, 'Drape test crashed')
  })
}

export async function generateStyleProfile(app: FastifyInstance, avatar: AvatarDocument): Promise<StyleProfile> {
  const looks = await app.collections.looks
    .find(
      { userId: avatar.userId, status: 'ready', $or: [{ favorite: true }, { 'collectionIds.0': { $exists: true } }] },
      { projection: { plan: 1, occasion: 1 } },
    )
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray()
  const profile = await createStructuredResponse<StyleProfile>({
    instructions: STYLE_PROFILE_INSTRUCTIONS,
    content: [{ type: 'input_text', text: buildStyleProfileRequest(avatar, looks) }],
    schemaName: 'style_profile',
    schema: styleProfileSchema,
    timeoutMs: 120_000,
  })

  return cleanStyleProfile(profile, bodyOf(avatar).presentation)
}

export function cleanStyleProfile(profile: StyleProfile, presentation: Presentation): StyleProfile {
  const hex = (value: string) => (HEX.test(value) ? value.toUpperCase() : '#9A948C')
  const { silhouetteTest, necklineTest } = profile

  return {
    ...profile,
    keywords: profile.keywords.slice(0, 5),
    signaturePieces: profile.signaturePieces.slice(0, 4).map((piece) => ({ ...piece, colorHex: hex(piece.colorHex) })),
    capsule: profile.capsule.slice(0, 12).map((item) => ({ ...item, colorHex: hex(item.colorHex) })),
    silhouetteTest: silhouetteTest && { ...silhouetteTest, panels: wearFirst(silhouetteTest.panels).slice(0, 4) },
    necklineTest: necklineTest && {
      ...necklineTest,
      kind: presentation === 'menswear' ? 'collars' : 'necklines',
      panels: wearFirst(necklineTest.panels).slice(0, 4),
    },
  }
}

export async function generateLookAnalysis(avatar: AvatarDocument, look: LookDocument): Promise<LookAnalysis> {
  const image = look.imageKey ? await storage.read(look.imageKey) : null
  const analysis = await createStructuredResponse<LookAnalysis>({
    instructions: LOOK_ANALYSIS_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: buildLookAnalysisRequest(avatar, look) },
      ...(image ? [{ type: 'input_image' as const, image_url: toDataUrl(image, 'image/webp'), detail: 'low' as const }] : []),
    ],
    schemaName: 'look_analysis',
    schema: lookAnalysisSchema,
    timeoutMs: 90_000,
  })

  return {
    ...analysis,
    dressCodeFit: { ...analysis.dressCodeFit, score: clampScore(analysis.dressCodeFit.score) },
    paletteHarmony: { ...analysis.paletteHarmony, score: clampScore(analysis.paletteHarmony.score) },
    strengths: analysis.strengths.slice(0, 3),
    accessories: analysis.accessories.slice(0, 3),
  }
}
