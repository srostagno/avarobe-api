import { env } from '../../config/env.js'
import type { ColorAnalysis, ColorLighting, ColorScores, ColorSwatch } from '../../types/mongo.js'
import { createStructuredResponse, OpenAiRequestError, toDataUrl } from '../../utils/openai.js'
import { analysisHasForeignScript, cleanColorAnalysis } from './analysis.js'
import { CLOSE_GAP, type ScoredMeasure } from './decide.js'
import {
  COLOR_MEASURE_INSTRUCTIONS,
  colorMeasureSchema,
  colorPaletteInstructions,
  colorPaletteSchema,
} from './prompts.js'
import { averageScores, confidenceOf, contrastOf, metalsOf, rankSeasons, undertoneOf } from './seasons.js'

// The scored color read, in two calls. 1. Measure: four traits scored with
// fixed settings (COLOR_MEASURE_MODEL, reasoning none, temperature 0,
// English), so the same face scores the same in any language; the season
// follows in code (seasons.ts), and a close call is measured once more and
// averaged. 2. Palette: the colors for the season decided, in their
// language, from a low-detail look at the photo.

export type ColorDescription = { skin: string; hair: string; eyes: string; lighting: string }

export type Measurement = { coloring: ColorDescription | null; lighting: ColorLighting; olive: boolean; scores: ColorScores }

type MeasureResult = {
  coloring: ColorDescription
  lightingQuality: ColorLighting
  olive: boolean
  scores: ColorScores
}

const LIGHTING: ColorLighting[] = ['good', 'tinted', 'poor']

// Integers from -5 to +5, whatever came back.
const clampScore = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(-5, Math.min(5, Math.round(value))) : 0)

export function cleanMeasurement(result: MeasureResult): Measurement {
  return {
    coloring: result.coloring,
    lighting: LIGHTING.includes(result.lightingQuality) ? result.lightingQuality : 'tinted',
    olive: result.olive === true,
    scores: {
      warmth: clampScore(result.scores?.warmth),
      depth: clampScore(result.scores?.depth),
      chroma: clampScore(result.scores?.chroma),
      contrast: clampScore(result.scores?.contrast),
    },
  }
}

export async function measureColors(selfie: Buffer): Promise<Measurement> {
  const result = await createStructuredResponse<MeasureResult>({
    instructions: COLOR_MEASURE_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: 'Measure the coloring in this selfie.' },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'high' },
    ],
    schemaName: 'color_measure',
    schema: colorMeasureSchema,
    model: env.COLOR_MEASURE_MODEL,
    reasoningEffort: 'none',
    temperature: 0,
    locale: 'en',
  })

  return cleanMeasurement(result)
}

// A model that refuses one of the fixed settings (reasoning none, a
// temperature): that read goes the classic way instead of failing, so a
// refused setting can never fail every read.
export function refusedSetting(error: unknown) {
  return error instanceof OpenAiRequestError && error.statusCode === 400 && /Unsupported parameter|Unknown parameter/i.test(error.message)
}

// Whether a first measurement is a close call worth one more.
export function closeCall(measurement: Measurement) {
  return rankSeasons(measurement.scores).margin < CLOSE_GAP
}

const WORSE_LIGHT = (a: ColorLighting, b: ColorLighting) => (LIGHTING.indexOf(a) >= LIGHTING.indexOf(b) ? a : b)

export type ScoredRead = ScoredMeasure & { olive: boolean; coloring: ColorDescription | null }

// One or two measurements of the same photo as one read: the scores
// averaged, the worse light of the two.
export function scoredRead(first: Measurement, second: Measurement | null = null): ScoredRead {
  if (!second) {
    return { method: 'scored', scores: first.scores, lighting: first.lighting, samples: 1, olive: first.olive, coloring: first.coloring }
  }

  return {
    method: 'scored',
    scores: averageScores(first.scores, second.scores),
    lighting: WORSE_LIGHT(first.lighting, second.lighting),
    samples: 2,
    olive: first.olive,
    coloring: first.coloring,
  }
}

// The whole measuring step, without retries (the eval; the color job runs
// the two calls itself inside its retry loop).
export async function measurePhoto(selfie: Buffer): Promise<ScoredRead> {
  const first = await measureColors(selfie)

  return scoredRead(first, closeCall(first) ? await measureColors(selfie) : null)
}

type PaletteResult = Pick<ColorAnalysis, 'summary' | 'bestColors' | 'neutrals' | 'avoidColors' | 'photoNote'>

function requestPalette(selfie: Buffer, read: ScoredRead, season: string) {
  const { coloring } = read

  return createStructuredResponse<PaletteResult>({
    instructions: colorPaletteInstructions(season),
    content: [
      {
        type: 'input_text',
        text: [
          `Season: ${season} (${undertoneOf(read.scores, read.olive)} undertone, ${contrastOf(read.scores)} contrast). Light: ${read.lighting}.`,
          ...(coloring ? [`What the photo shows: skin ${coloring.skin}; hair ${coloring.hair}; eyes ${coloring.eyes}; light ${coloring.lighting}.`] : []),
          'Write the palette for this selfie.',
        ].join('\n'),
      },
      { type: 'input_image', image_url: toDataUrl(selfie, 'image/jpeg'), detail: 'low' },
    ],
    schemaName: 'color_palette',
    schema: colorPaletteSchema,
  })
}

// The analysis every reader downstream knows (the same shape as a classic
// read): the season decided, the rest derived from the scores, the palette
// in their language. Not cleaned yet (writePalette checks it first).
function draftAnalysis(read: ScoredRead, season: string, palette: PaletteResult): ColorAnalysis {
  const wear = new Set([...palette.bestColors, ...palette.neutrals].map((swatch) => swatch.hex.toUpperCase()))

  return {
    season,
    undertone: undertoneOf(read.scores, read.olive),
    contrast: contrastOf(read.scores),
    summary: palette.summary,
    bestColors: palette.bestColors,
    neutrals: palette.neutrals,
    // A color to avoid can't also be one to wear.
    avoidColors: palette.avoidColors.filter((swatch: ColorSwatch) => !wear.has(swatch.hex.toUpperCase())),
    metals: metalsOf(read.scores),
    confidence: confidenceOf(read.lighting, rankSeasons(read.scores, season).margin),
    photoNote: read.lighting === 'good' ? null : palette.photoNote,
  }
}

export function assembleAnalysis(read: ScoredRead, season: string, palette: PaletteResult): ColorAnalysis {
  return cleanColorAnalysis(draftAnalysis(read, season, palette))
}

// Step 2. A word from another script slipped into the text: asked once more
// (the season can't change here; it's decided).
export async function writePalette(selfie: Buffer, read: ScoredRead, season: string): Promise<ColorAnalysis> {
  let analysis = draftAnalysis(read, season, await requestPalette(selfie, read, season))

  if (analysisHasForeignScript(analysis)) {
    analysis = draftAnalysis(read, season, await requestPalette(selfie, read, season))
  }

  return cleanColorAnalysis(analysis)
}
