import type { ColorAnalysis, FaceReading } from '../../types/mongo.js'

// Face Age: one face photo in; how old the face reads, what adds years in
// this photo and what would take them off out. The age it gives is the
// model's own; what she sees is calibrated (look/age.ts), so no number ever
// appears in the words it writes.

const TIP_AREAS = ['color', 'hair', 'makeup', 'brows', 'skin', 'glasses', 'light', 'expression'] as const

export const FACE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['usable', 'problem', 'apparentAge', 'potentialYears', 'headline', 'strengths', 'agingFactors', 'tips', 'photo'],
  properties: {
    usable: { type: 'boolean' },
    // 'none' rather than null: plain enums are the safest in strict mode.
    problem: { type: 'string', enum: ['none', 'no_face', 'several_faces', 'minor', 'too_dark', 'too_blurry'] },
    apparentAge: { type: 'integer', minimum: 10, maximum: 100 },
    potentialYears: { type: 'integer', minimum: 0, maximum: 8 },
    headline: { type: 'string' },
    strengths: { type: 'array', maxItems: 2, items: { type: 'string' } },
    agingFactors: { type: 'array', maxItems: 3, items: { type: 'string' } },
    tips: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'text'],
        properties: { area: { type: 'string', enum: TIP_AREAS }, text: { type: 'string' } },
      },
    },
    photo: {
      type: 'object',
      additionalProperties: false,
      required: ['light', 'glasses', 'makeup', 'expression', 'angle'],
      properties: {
        light: { type: 'string', enum: ['good', 'dim', 'harsh'] },
        glasses: { type: 'boolean' },
        makeup: { type: 'string', enum: ['none', 'light', 'full'] },
        expression: { type: 'string', enum: ['neutral', 'smile', 'other'] },
        angle: { type: 'string', enum: ['front', 'tilted'] },
      },
    },
  },
} as const

// Her palette goes in only once she owns it: no best colors before paying
// (Oct 3, 2026). Without it the color tip is about what this photo shows.
// `decade`: her real age's decade (50 for her 50s) when she gave her birth
// date, for tips that fit her stage of life; never for the age it reads.
export function buildFaceInstructions(input: { palette: ColorAnalysis | null; old: boolean; decade: number | null }) {
  const swatches = (list: { name: string; hex: string }[]) => list.map((swatch) => swatch.name).join(', ')
  const palette = input.palette
    ? [
        `Her color season is ${input.palette.season} (${input.palette.undertone} undertone, ${input.palette.contrast} contrast). Her best colors: ${swatches(input.palette.bestColors)}. Colors to keep away from her face: ${swatches(input.palette.avoidColors)}.`,
        'A color tip may name her best colors.',
      ]
    : [
        'You do not know her personal color palette. A color tip may say what the colors in this photo do to her face (for example a dark top casting shadows, or a cool grey dulling warm skin) and the direction to go (softer, warmer, lighter, brighter), but never name specific colors, a palette or a season for her: her own colors are in her Color Advisor.',
      ]

  return [
    'You are a seasoned image consultant and makeup artist. The image is a photo of a woman (or man) who wants to look fresher, more alive and younger, and to track it over time.',
    input.old ? 'This is an older photo from her own albums, added to see how her look has changed.' : 'This is a recent photo, taken for today.',
    'First check the photo:',
    '- "no_face": no human face is clearly visible.',
    '- "several_faces": more than one person\'s face is clearly visible. Do not read any of them.',
    '- "minor": the person looks under 18. Do not read them.',
    '- "too_dark" / "too_blurry": the face cannot be judged.',
    'If any applies, set usable false, that problem, apparentAge 30, potentialYears 0, empty texts and lists, and still describe the photo conditions.',
    'Otherwise set usable true and problem "none", and:',
    'apparentAge: the age a panel of strangers would guess on average from this photo alone, as a whole number. Judge the face as it looks here, light, makeup and expression included. Do not round to a multiple of five.',
    'photo: the light on the face (good: soft and even; dim; harsh: hard shadows or flash), glasses, how much makeup, the expression and whether the face is turned or tilted.',
    'strengths: one or two specific things in this photo that read fresh and youthful.',
    'agingFactors: one to three things in this photo that add years and that she can change: colors near the face, hair color or cut, makeup, brows, glasses frames, the light, the expression. Say them kindly.',
    'tips: exactly three concrete changes for her next photo or today, each with its area. Practical and specific to what you see, things she can do herself.',
    ...palette,
    ...(input.decade !== null
      ? [`She is in her ${input.decade}s. Use that only to make the tips fit her stage of life; it must not change apparentAge, which comes from the face alone.`]
      : []),
    'potentialYears: how many years those three changes could realistically take off how old she reads in a photo like this, from 0 to 8.',
    'headline: one warm, honest sentence about her face today, to her ("you").',
    'Never write any age, number of years or other number in headline, strengths, agingFactors or tips. Never comment on weight, body or face shape, wrinkles as such, or features she cannot change. Never suggest medical or cosmetic procedures, injections, surgery or brand names. Write to her as "you", like a kind expert friend.',
  ].join('\n')
}

// What the model returns: `problem` 'none' where the stored reading has null.
export type FaceReadingRaw = Omit<FaceReading, 'problem'> & { problem: NonNullable<FaceReading['problem']> | 'none' }

export function toFaceReading(raw: FaceReadingRaw): FaceReading {
  return { ...raw, problem: raw.problem === 'none' ? null : raw.problem }
}
