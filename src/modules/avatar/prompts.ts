import type { AvatarBody, BodyBuild, ColorAnalysis } from '../../types/mongo.js'

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

export function buildAvatarPrompt(body: AvatarBody) {
  const garments =
    body.presentation === 'womenswear'
      ? 'a plain fitted white crew-neck t-shirt, straight mid-grey trousers and white minimalist sneakers'
      : body.presentation === 'menswear'
        ? 'a plain fitted white crew-neck t-shirt, mid-grey chino trousers and white minimalist sneakers'
        : 'a plain white crew-neck t-shirt, relaxed mid-grey trousers and white minimalist sneakers'

  return [
    'Create a full-body studio photo of the SAME person from the reference selfie.',
    'Keep their exact face, facial proportions, skin tone, hair, facial hair and eye color so they are instantly recognisable.',
    `Body: ${body.heightCm} cm tall, ${body.weightKg} kg, ${BUILD_DESCRIPTIONS[body.build]}. Proportions must match these measurements realistically.`,
    'They stand facing the camera in a relaxed neutral pose, arms at their sides, the whole body visible from head to shoes with a little margin.',
    `Wearing ${garments}.`,
    'Seamless light warm-grey studio backdrop, soft even lighting, realistic photo, no text, no logos.',
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
