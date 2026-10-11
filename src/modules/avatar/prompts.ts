import type {
  AvatarAdjustment,
  AvatarBody,
  BodyBuild,
  ColorAnalysis,
} from '../../types/mongo.js'

export const COLOR_SEASONS = [
  'Light Spring',
  'Warm Spring',
  'Bright Spring',
  'Light Summer',
  'Cool Summer',
  'Soft Summer',
  'Soft Autumn',
  'Warm Autumn',
  'Deep Autumn',
  'Deep Winter',
  'Cool Winter',
  'Bright Winter',
] as const

const BUILD_DESCRIPTIONS: Record<BodyBuild, string> = {
  slim: 'slim, narrow frame',
  athletic: 'athletic, toned build',
  average: 'average build',
  broad: 'broad, solid build with wide shoulders',
  curvy: 'curvy build with defined waist and fuller hips',
  plus: 'plus-size, full-figured build',
}

const swatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'hex'],
  properties: {
    name: { type: 'string' },
    hex: { type: 'string', description: 'Hex color like #1F3A5F' },
  },
}

export const colorAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'season',
    'undertone',
    'contrast',
    'summary',
    'bestColors',
    'neutrals',
    'avoidColors',
    'metals',
    'confidence',
    'photoNote',
  ],
  properties: {
    season: { type: 'string', enum: [...COLOR_SEASONS] },
    undertone: { type: 'string', enum: ['warm', 'cool', 'neutral', 'olive'] },
    contrast: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: {
      type: 'string',
      description:
        'Two short sentences, second person, explaining the season from skin, hair and eyes.',
    },
    bestColors: {
      type: 'array',
      description: '10 flattering colors across hues, specific named shades.',
      items: swatchSchema,
    },
    neutrals: {
      type: 'array',
      description: '5 wardrobe neutrals that work as base colors.',
      items: swatchSchema,
    },
    avoidColors: {
      type: 'array',
      description: '4 colors to keep away from the face.',
      items: swatchSchema,
    },
    metals: { type: 'string', enum: ['gold', 'silver', 'both'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    photoNote: {
      type: ['string', 'null'],
      description:
        'If lighting, filters or makeup make the read uncertain, one sentence of advice; otherwise null.',
    },
  },
}

export const COLOR_ANALYSIS_INSTRUCTIONS = [
  'You are an expert color analyst using the 12-season system.',
  "Read the person's skin undertone, hair color, eye color and overall contrast from the photo.",
  'Account for lighting: warm indoor light or filters can shift the read, so lower confidence when unsure.',
  'Never comment on attractiveness, age, weight or ethnicity. Only color.',
  'Write in plain, warm American English.',
].join(' ')

// The scored read, step 1 (measure.ts): what the photo shows, scored on four
// traits with fixed settings, in English whatever their language, so the
// same face gets the same scores. The model never names a season: code
// derives it from the scores (seasons.ts).
const trait = (description: string) => ({ type: 'integer', description })

export const colorMeasureSchema = {
  type: 'object',
  additionalProperties: false,
  // Generated in this order: what it sees, the light, then the scores.
  required: ['coloring', 'lightingQuality', 'olive', 'scores'],
  properties: {
    coloring: {
      type: 'object',
      additionalProperties: false,
      required: ['skin', 'hair', 'eyes', 'lighting'],
      properties: {
        skin: { type: 'string', description: 'Skin depth and undertone cues, a few words.' },
        hair: { type: 'string', description: 'Natural hair color and depth, a few words.' },
        eyes: { type: 'string', description: 'Eye color and clarity, a few words.' },
        lighting: { type: 'string', description: 'How the light or white balance tints the photo, a few words.' },
      },
    },
    lightingQuality: {
      type: 'string',
      enum: ['good', 'tinted', 'poor'],
      description:
        'good: even light, true colors. tinted: a cast you can correct for. poor: too dark, a heavy filter or colored light hides the true coloring.',
    },
    olive: { type: 'boolean', description: 'True only if the skin has a green or grey-green undertone.' },
    scores: {
      type: 'object',
      additionalProperties: false,
      required: ['warmth', 'depth', 'chroma', 'contrast'],
      properties: {
        warmth: trait('-5 icy cool .. 0 neutral .. +5 golden warm, after correcting for the photo tint'),
        depth: trait('-5 very light .. +5 very deep, the whole coloring, hair weighed most'),
        chroma: trait('-5 very soft, muted, greyed .. +5 very clear, bright, saturated'),
        contrast: trait('-5 very low contrast between hair, skin and eyes .. +5 very high'),
      },
    },
  },
}

export const COLOR_MEASURE_INSTRUCTIONS = [
  'You are an expert color analyst.',
  "Read the person's skin undertone, hair color, eye color and overall contrast from the photo.",
  'Work in this order. First describe the skin, natural hair and eyes, and how the light tints the photo.',
  'Judge the undertone from relative cues (skin against hair, eyes and any white in the frame), never from the overall tint of the photo.',
  'Then rate the light, and score four traits on integer scales from -5 to +5: warmth (cool to warm), depth (light to deep), chroma (soft to clear) and contrast (between hair, skin and eyes).',
  'Score what you see; the same face must always get the same scores.',
  'Never comment on attractiveness, age, weight or ethnicity. Only color.',
  'Write in plain American English.',
].join(' ')

// The scored read, step 2: the palette for the season the code decided, in
// their language. It never judges the season again.
export const colorPaletteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'bestColors', 'neutrals', 'avoidColors', 'photoNote'],
  properties: {
    summary: colorAnalysisSchema.properties.summary,
    bestColors: colorAnalysisSchema.properties.bestColors,
    neutrals: colorAnalysisSchema.properties.neutrals,
    avoidColors: {
      type: 'array',
      description: '4 colors to keep away from the face: common choices that fight this coloring, never one of the best colors or neutrals.',
      items: swatchSchema,
    },
    photoNote: {
      type: ['string', 'null'],
      description: 'Only if the light is tinted or poor: one sentence of advice for a truer photo. Otherwise null.',
    },
  },
}

export function colorPaletteInstructions(season: string) {
  return [
    'You are an expert color analyst using the 12-season system.',
    `The season is decided: ${season}. Do not judge it again.`,
    'Write this person’s palette within that season: specific, named shades a person can recognize in stores, suited to the skin, hair and eyes described and seen in the photo.',
    'Never comment on attractiveness, age, weight or ethnicity. Only color.',
    'Write in plain, warm American English.',
  ].join(' ')
}

function neutralOutfit(body: AvatarBody) {
  if (body.presentation === 'womenswear') {
    return 'a plain fitted white crew-neck t-shirt, straight mid-grey trousers and white minimalist sneakers'
  }

  return body.presentation === 'menswear'
    ? 'a plain fitted white crew-neck t-shirt, mid-grey chino trousers and white minimalist sneakers'
    : 'a plain white crew-neck t-shirt, relaxed mid-grey trousers and white minimalist sneakers'
}

// The failure people notice most is a head that looks pasted onto a stock
// body: wrong scale, a neck that doesn't fit, or skin that changes tone below
// the jaw. These lines ask for one coherent photograph.
export const COHERENCE_RULES = [
  'It must look like ONE real photograph taken in a single shot, never a composite.',
  'The head is in natural proportion to the body for an adult of this height (roughly one-seventh to one-eighth of total height), with a neck whose width and length fit the build.',
  'Skin tone, texture, lighting and color temperature are identical on the face, neck, arms and hands; the body looks the same age as the face.',
  'Shot on an 85mm lens from chest height about 3 meters away, so there is no wide-angle distortion.',
]

function bodyDescription(body: AvatarBody) {
  const meters = body.heightCm / 100
  const bmi = body.weightKg / (meters * meters)

  return `${body.heightCm} cm tall, ${body.weightKg} kg (BMI about ${bmi.toFixed(1)}), ${BUILD_DESCRIPTIONS[body.build]}`
}

export function buildAvatarPrompt(body: AvatarBody, hasBodyPhoto: boolean) {
  return [
    hasBodyPhoto
      ? 'Image 1 is a selfie of a person; image 2 is a full-body photo of the same person. Create a new full-body studio photo of them.'
      : 'Create a full-body studio photo of the SAME person from the reference selfie.',
    'Keep their exact face, facial proportions, skin tone, hair, facial hair and eye color so they are instantly recognisable.',
    hasBodyPhoto
      ? `Take the body shape, shoulder width, proportions and posture from image 2, ignoring its clothes and background. For reference they are ${bodyDescription(body)}.`
      : `Body: ${bodyDescription(body)}. Proportions must match these measurements realistically.`,
    ...COHERENCE_RULES,
    'They stand facing the camera in a relaxed neutral pose, arms at their sides, the whole body visible from head to shoes with a little margin.',
    `Wearing ${neutralOutfit(body)}.`,
    'Seamless light warm-grey studio backdrop, soft even lighting, realistic photo, no text, no logos.',
  ].join(' ')
}

export const AVATAR_ADJUSTMENTS: Record<AvatarAdjustment, string> = {
  more_like_me:
    'Make the face match the selfie more closely: same face shape, jawline, eyes, nose, mouth, eyebrows, hairline and facial hair.',
  head_smaller: 'Make the head a little smaller relative to the body so the proportions look natural.',
  head_larger: 'Make the head a little larger relative to the body so the proportions look natural.',
  slimmer: 'Make the body slightly slimmer, keeping the same height and frame.',
  fuller: 'Make the body slightly fuller, keeping the same height and frame.',
  broader_shoulders: 'Make the shoulders and chest slightly broader.',
  narrower_shoulders: 'Make the shoulders slightly narrower.',
  match_skin:
    'Make the skin tone and texture of the neck, arms and hands match the face exactly, with the same lighting.',
}

export function buildRefinePrompt(input: {
  adjustments: AvatarAdjustment[]
  notes: string | null
  hasBodyPhoto: boolean
}) {
  const changes = [
    ...input.adjustments.map((key) => AVATAR_ADJUSTMENTS[key]),
    ...(input.notes ? [`The person also asked: "${input.notes}".`] : []),
  ]

  return [
    `Image 1 is this person's current full-body avatar. Image 2 is their selfie${input.hasBodyPhoto ? ' and image 3 a full-body photo of them' : ''}.`,
    'Edit image 1. Keep everything else exactly the same: pose, framing, outfit, background, lighting and identity.',
    `Apply only these changes: ${changes.join(' ')}`,
    ...COHERENCE_RULES,
    'Realistic photo, no text, no logos.',
  ].join(' ')
}

export function describePalette(analysis: ColorAnalysis | null) {
  if (!analysis) {
    return 'Color season unknown; favor versatile, balanced colors.'
  }

  const list = (swatches: ColorAnalysis['bestColors']) =>
    swatches.map((swatch) => `${swatch.name} ${swatch.hex}`).join(', ')

  return [
    `Color season: ${analysis.season} (${analysis.undertone} undertone, ${analysis.contrast} contrast). Metals: ${analysis.metals}.`,
    `Best colors: ${list(analysis.bestColors)}.`,
    `Neutrals: ${list(analysis.neutrals)}.`,
    `Avoid near the face: ${list(analysis.avoidColors)}.`,
  ].join('\n')
}
