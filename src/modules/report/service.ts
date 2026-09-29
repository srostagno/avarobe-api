import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type {
  AvatarDocument,
  ColorReport,
  ColorSwatch,
  LookAnalysis,
  LookDocument,
  Presentation,
  StyleProfile,
  TestSwatch,
  Verdict,
} from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { toStoredWebp } from '../../utils/images.js'
import { createStructuredResponse, generateImageFromReferences, toDataUrl } from '../../utils/openai.js'
import { storage } from '../../utils/storage.js'
import { hairReference } from '../avatar/hair.js'
import {
  COLOR_REPORT_INSTRUCTIONS,
  LOOK_ANALYSIS_INSTRUCTIONS,
  STYLE_PROFILE_INSTRUCTIONS,
  buildColorReportRequest,
  buildDrapePrompt,
  buildLookAnalysisRequest,
  buildStyleProfileRequest,
  colorReportSchema,
  lookAnalysisSchema,
  styleProfileSchema,
} from './prompts.js'

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

export async function generateColorReport(avatar: AvatarDocument): Promise<ColorReport> {
  const selfie = await storage.read(avatar.selfieKey)
  const report = await createStructuredResponse<ColorReport>({
    instructions: COLOR_REPORT_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: buildColorReportRequest(avatar) },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'color_report',
    schema: colorReportSchema,
    timeoutMs: 120_000,
  })

  return cleanColorReport(report, avatar.body.presentation)
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

// Renders the drape test in the background (one image, ~30 s).
export async function runDrapeTest(app: FastifyInstance, avatarId: ObjectId) {
  const avatar = await app.collections.avatars.findOne({ _id: avatarId })
  const drape = avatar?.drape

  if (!avatar?.avatarKey || !drape || drape.wear.length < 2 || drape.avoid.length < 2) {
    await markDrape(app, avatarId, { 'drape.status': 'failed', 'drape.updatedAt': new Date() })
    return
  }

  try {
    const [avatarImage, selfie, hair] = await Promise.all([
      storage.read(avatar.avatarKey),
      storage.read(avatar.selfieKey),
      hairReference(avatar, 3),
    ])
    const png = await generateImageFromReferences({
      images: [
        { data: avatarImage, filename: 'avatar.webp', contentType: 'image/webp' },
        { data: selfie, filename: 'face.jpg', contentType: 'image/jpeg' },
        ...(hair ? [hair.image] : []),
      ],
      prompt: hair ? `${buildDrapePrompt(drape)} ${hair.line}` : buildDrapePrompt(drape),
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

  return cleanStyleProfile(profile, avatar.body.presentation)
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
