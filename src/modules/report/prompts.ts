import type { AvatarDocument, ColorSwatch, LookDocument } from '../../types/mongo.js'
import { describePalette } from '../avatar/prompts.js'

// Schemas follow structured-output rules: every property required and
// additionalProperties false.
const swatch = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'hex'],
  properties: { name: { type: 'string' }, hex: { type: 'string', description: 'Hex like #1F3A5F.' } },
}

const swatches = (description: string) => ({ type: 'array', description, items: swatch })

const scale = (description: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'label'],
  properties: {
    value: { type: 'integer', description },
    label: { type: 'string', description: 'Two or three words, e.g. "Warm, golden".' },
  },
})

const textBlock = (description: string) => ({
  type: 'array',
  description,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'text'],
    properties: { title: { type: 'string' }, text: { type: 'string' } },
  },
})

const NEVER = 'Never comment on attractiveness, age, weight, body flaws or ethnicity. Frame everything positively.'

export const colorReportSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['seasonLean', 'scales', 'palette', 'combinations', 'guides', 'avoidAdvice', 'drape'],
  properties: {
    seasonLean: {
      type: 'string',
      description: 'The season, and the neighboring season it leans toward if any, e.g. "Deep Autumn, leaning Deep Winter".',
    },
    scales: {
      type: 'object',
      additionalProperties: false,
      required: ['undertone', 'depth', 'chroma', 'contrast'],
      properties: {
        undertone: scale('0 = very cool, 100 = very warm.'),
        depth: scale('0 = very light, 100 = very deep.'),
        chroma: scale('0 = very soft/muted, 100 = very bright/clear.'),
        contrast: scale('0 = very low contrast between hair, skin and eyes, 100 = very high.'),
      },
    },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: ['basics', 'accents', 'statements'],
      properties: {
        basics: swatches('8 wardrobe base colors (neutrals and quiet shades).'),
        accents: swatches('10 accent colors that flatter near the face.'),
        statements: swatches('8 bold colors for statement pieces.'),
      },
    },
    combinations: {
      type: 'array',
      description: '5 outfit color combinations of 3 colors each from the palette.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'occasion', 'colors'],
        properties: {
          name: { type: 'string', description: '2 or 3 words.' },
          occasion: { type: 'string', description: 'Where it works, a few words.' },
          colors: swatches('Exactly 3 colors.'),
        },
      },
    },
    guides: textBlock(
      'Exactly 6 practical guides, one or two sentences each, with these titles in this order: "Prints and patterns", "Denim", "Metals and jewelry", "Eyewear", then two tailored to how they dress (for menswear e.g. "Shirts and ties" and "Suits"; for womenswear e.g. "Lips and blush" and "Dresses"; for unisex pick two).',
    ),
    avoidAdvice: {
      type: 'string',
      description: 'Two sentences on how to still wear the colors that don’t flatter them: away from the face, as bottoms, shoes or accessories.',
    },
    drape: {
      type: 'object',
      additionalProperties: false,
      required: ['wear', 'avoid'],
      properties: {
        wear: swatches('Exactly 2 of their most flattering colors, clearly different from each other.'),
        avoid: swatches('Exactly 2 colors that wash them out, clearly different from each other.'),
      },
    },
  },
}

export const COLOR_REPORT_INSTRUCTIONS = [
  'You are an expert color analyst using the 12-season system, writing a premium personal color report.',
  'You receive the client’s earlier analysis and their selfie. Keep the same season; refine and expand it.',
  'Choose specific, named shades a person can recognize in stores.',
  NEVER,
  'Write in warm, concise American English, second person.',
].join(' ')

export function buildColorReportRequest(avatar: AvatarDocument) {
  return [
    `They dress in: ${avatar.body.presentation}.`,
    'Earlier analysis:',
    describePalette(avatar.colorAnalysis),
    '',
    'Write their advanced color report from the attached selfie.',
  ].join('\n')
}

function describeSwatch(swatch: ColorSwatch) {
  return `${swatch.name} (${swatch.hex})`
}

// The drape test: four head-and-shoulders portraits in one image.
export function buildDrapePrompt(drape: { wear: ColorSwatch[]; avoid: ColorSwatch[] }) {
  const [wear1, wear2] = drape.wear
  const [avoid1, avoid2] = drape.avoid

  return [
    'Image 1 is this person. Image 2 is a close-up of the same face.',
    'Create one square image divided into a 2 by 2 grid of four head-and-shoulders portraits of this SAME person, like a professional color analysis draping session.',
    'In every panel they have the identical face, hair, skin tone and expression, facing the camera, with the same neutral light-grey background and the same soft daylight.',
    'In each panel a plain, matte, solid-colored fabric drape covers their shoulders and chest up to the neck, hiding their clothes.',
    `Drape colors: top-left ${describeSwatch(wear1!)}, top-right ${describeSwatch(wear2!)}, bottom-left ${describeSwatch(avoid1!)}, bottom-right ${describeSwatch(avoid2!)}.`,
    'Render the true effect of each color on their complexion, the way it really looks in daylight; do not retouch the skin differently between panels.',
    'Thin white gutters between panels. No text, no labels, no logos.',
  ].join(' ')
}

export const styleProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'archetype',
    'tagline',
    'description',
    'keywords',
    'shines',
    'adapt',
    'silhouettes',
    'signaturePieces',
    'capsule',
    'skip',
  ],
  properties: {
    archetype: { type: 'string', description: 'Their style archetype in 2 or 3 words, e.g. "Modern Classic".' },
    tagline: { type: 'string', description: 'One short line that sums up their style.' },
    description: { type: 'string', description: 'Two or three sentences on what defines their style and why it suits them.' },
    keywords: { type: 'array', description: '4 single-word style keywords.', items: { type: 'string' } },
    shines: {
      type: 'array',
      description: '4 situations where their style naturally stands out, and why.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['situation', 'why'],
        properties: { situation: { type: 'string' }, why: { type: 'string' } },
      },
    },
    adapt: {
      type: 'array',
      description: '3 situations where their style needs adjusting, and exactly how.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['situation', 'how'],
        properties: { situation: { type: 'string' }, how: { type: 'string' } },
      },
    },
    silhouettes: {
      type: 'array',
      description:
        'Exactly 5 fit guides with these areas in order: "Tops", "Bottoms", "Outerwear", "Dresses and suits", "Shoes and accessories". Specific cuts, lengths, rises, necklines or lapels that suit their build and height.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'advice'],
        properties: { area: { type: 'string' }, advice: { type: 'string' } },
      },
    },
    signaturePieces: {
      type: 'array',
      description: '4 signature pieces that express their style, in their colors.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'color', 'colorHex', 'why'],
        properties: {
          name: { type: 'string' },
          color: { type: 'string' },
          colorHex: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    capsule: {
      type: 'array',
      description: 'A capsule wardrobe of exactly 12 essentials in their colors that mix and match.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'name', 'color', 'colorHex', 'material'],
        properties: {
          slot: { type: 'string', enum: ['top', 'layer', 'outerwear', 'bottom', 'dress', 'suit', 'shoes', 'accessory', 'bag'] },
          name: { type: 'string', description: 'Generic garment name, no brands.' },
          color: { type: 'string' },
          colorHex: { type: 'string' },
          material: { type: 'string' },
        },
      },
    },
    skip: {
      type: 'array',
      description: '3 style traps to skip, each phrased as "Skip X; choose Y instead."',
      items: { type: 'string' },
    },
  },
}

export const STYLE_PROFILE_INSTRUCTIONS = [
  'You are Avarobe, a senior personal stylist writing a premium style profile for an American client.',
  'Base it on their build, height, palette and the looks they saved or marked as favorites.',
  'Be specific and practical: name cuts, lengths and fabrics. Every garment must be common at mainstream US retailers, no brands.',
  NEVER,
  'Write in warm, concise American English, second person.',
].join(' ')

export function buildStyleProfileRequest(avatar: AvatarDocument, looks: LookDocument[]) {
  const { body } = avatar
  const saved = looks.map(
    (look) =>
      `- ${look.plan.title} (${look.plan.vibe}, for "${look.occasion.text}"): ${look.plan.items
        .map((item) => `${item.color} ${item.name.toLowerCase()}`)
        .join(', ')}`,
  )

  return [
    `Dresses in: ${body.presentation}. Height ${body.heightCm} cm, weight ${body.weightKg} kg, ${body.build} build.`,
    describePalette(avatar.colorAnalysis),
    '',
    saved.length > 0 ? 'Looks they saved or loved:' : 'They have not saved looks yet; infer from their build and palette.',
    ...saved,
  ].join('\n')
}

export const lookAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dressCodeFit', 'paletteHarmony', 'flatters', 'strengths', 'dressUp', 'dressDown', 'dayToNight', 'weather', 'accessories'],
  properties: {
    dressCodeFit: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'verdict'],
      properties: {
        score: { type: 'integer', description: '0-100: how well the outfit meets the occasion’s dress code.' },
        verdict: { type: 'string', description: 'One sentence.' },
      },
    },
    paletteHarmony: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'verdict'],
      properties: {
        score: { type: 'integer', description: '0-100: how well the colors near the face suit their palette.' },
        verdict: { type: 'string', description: 'One sentence.' },
      },
    },
    flatters: { type: 'string', description: 'One or two sentences on how the cut and proportions work on their build.' },
    strengths: { type: 'array', description: '3 short reasons this look works.', items: { type: 'string' } },
    dressUp: { type: 'string', description: 'One specific swap to make it more formal.' },
    dressDown: { type: 'string', description: 'One specific swap to make it more casual.' },
    dayToNight: { type: 'string', description: 'How to take it from day to evening.' },
    weather: { type: 'string', description: 'How to adapt it for colder or hotter weather.' },
    accessories: { type: 'array', description: '3 accessories that would finish it, in their colors.', items: { type: 'string' } },
  },
}

export const LOOK_ANALYSIS_INSTRUCTIONS = [
  'You are Avarobe, a senior personal stylist giving an honest, expert read of one outfit on this client.',
  'Score fairly: great looks score high, but point out what could be better.',
  'Know US dress codes precisely.',
  NEVER,
  'Write in warm, concise American English, second person.',
].join(' ')

export function buildLookAnalysisRequest(avatar: AvatarDocument, look: LookDocument) {
  return [
    `Occasion: ${look.occasion.text} (dress code: ${look.occasion.dressCode}).`,
    `Outfit "${look.plan.title}": ${look.plan.items
      .map((item) => `${item.color} ${item.material} ${item.name.toLowerCase()} (${item.fit})`)
      .join('; ')}.`,
    `Client: dresses in ${avatar.body.presentation}, ${avatar.body.heightCm} cm, ${avatar.body.build} build.`,
    describePalette(avatar.colorAnalysis),
    '',
    'The attached image shows them wearing it.',
  ].join('\n')
}
