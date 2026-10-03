import type { AvatarDocument, ColorSwatch, LookDocument, Presentation, StyleProfile } from '../../types/mongo.js'
import { describePalette } from '../avatar/prompts.js'
import { bodyOf } from '../avatar/body.js'

// Schemas follow structured-output rules: every property required and
// additionalProperties false.
const swatch = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'hex'],
  properties: { name: { type: 'string' }, hex: { type: 'string', description: 'Hex like #1F3A5F.' } },
}

const swatches = (description: string) => ({ type: 'array', description, items: swatch })

const verdict = { type: 'string', enum: ['wear', 'avoid'] }

const testSwatches = (description: string) => ({
  type: 'array',
  description,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'hex', 'verdict'],
    properties: { ...swatch.properties, verdict },
  },
})

// A side-by-side test the app renders as one image on their face or body:
// the options in the order they appear, then the verdict and why.
const comparison = (input: {
  panels: Record<string, unknown>
  insight: string
  note: string
  extra?: Record<string, unknown>
}) => ({
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(input.extra ?? {}), 'panels', 'insight', 'note'],
  properties: {
    ...input.extra,
    panels: input.panels,
    insight: { type: 'string', description: `The headline, 3 to 7 words, a confident verdict, e.g. "${input.insight}".` },
    note: { type: 'string', description: input.note },
  },
})

const COLOR_NOTE = 'One or two sentences on why, tied to their own skin, hair or eyes.'

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

// Properties are written in this order: what the model sees in the selfie
// comes first, so everything after it can build on it.
export const colorReportSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'coloring',
    'seasonLean',
    'signature',
    'scales',
    'palette',
    'combinations',
    'guides',
    'avoidAdvice',
    'drape',
    'neutralsTest',
    'whitesTest',
    'metalsTest',
    'faceTest',
    'hairTest',
    'paletteLooks',
    'gameChangers',
  ],
  properties: {
    coloring: {
      type: 'object',
      additionalProperties: false,
      required: ['skin', 'hair', 'eyes'],
      description: 'What you really see in their selfie, one short, specific and warm phrase each.',
      properties: {
        skin: {
          type: 'string',
          description: 'Its depth, undertone and character in color terms, e.g. "Fair and peachy, with golden warmth and freckles".',
        },
        hair: { type: 'string', description: 'Their hair color as it is, e.g. "Copper red with strawberry lights".' },
        eyes: { type: 'string', description: 'Their eye color, e.g. "Soft grey-green with a darker rim".' },
      },
    },
    seasonLean: {
      type: 'string',
      description: 'The season, and the neighboring season it leans toward if any, e.g. "Deep Autumn, leaning Deep Winter".',
    },
    signature: {
      type: 'string',
      description:
        'One line on the standout quality of their coloring and what it means for them, e.g. "Your copper hair is the star: colors that echo its warmth make your whole face glow."',
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
    neutralsTest: comparison({
      panels: testSwatches(
        'Exactly 4 neutrals, in this order: their 2 best neutrals (wear), one of them the dark neutral that does the job of black for them (black itself if it suits them), then 2 common neutrals that work against them (avoid), black among them if it doesn’t suit them.',
      ),
      insight: 'Espresso is your black',
      note: COLOR_NOTE,
    }),
    whitesTest: comparison({
      panels: testSwatches(
        'Exactly 4 whites and off-whites, in this order: the 2 that flatter them most (wear), e.g. cream, ivory, soft white or crisp optic white, then 2 that fight their coloring (avoid).',
      ),
      insight: 'Cream is your white',
      note: COLOR_NOTE,
    }),
    metalsTest: {
      type: 'object',
      additionalProperties: false,
      required: ['best', 'insight', 'note'],
      properties: {
        best: { type: 'string', enum: ['gold', 'silver', 'both'], description: 'The metals from the earlier analysis.' },
        insight: { type: 'string', description: 'The headline, 3 to 7 words, a confident verdict, e.g. "Gold wakes up your skin".' },
        note: { type: 'string', description: COLOR_NOTE },
      },
    },
    faceTest: comparison({
      panels: testSwatches(
        'Exactly 4 options worn at the face, in this order: 2 that flatter them (wear), then 2 popular ones that don’t (avoid). Lipstick shades or shirt colors, as the request says; name the shade only, e.g. "Brick red", not "Brick red lipstick".',
      ),
      insight: 'Brick red is your red',
      note: COLOR_NOTE,
    }),
    hairTest: comparison({
      extra: {
        current: {
          type: 'string',
          description:
            'In 2 to 4 words, their current hair color (e.g. "Natural copper red") or, when the request asks for facial hair, their current facial hair (e.g. "Light stubble").',
        },
      },
      panels: testSwatches(
        'Hair colors: exactly 3 to compare with their current one, in this order: 2 that would flatter them (wear), realistic for them, such as a richer, softer or deeper take on their own color, then 1 popular color that would wash them out (avoid). An empty list only if they have no visible hair. Facial hair, when the request asks for it: exactly 3 clearly different styles to compare with their current one, in the same order, 2 that suit their face shape, jaw and features (wear) and 1 popular style that works against them (avoid); name the style only (e.g. "Short boxed beard") and use their natural hair color as hex.',
      ),
      insight: 'Go richer, never ashy',
      note: COLOR_NOTE,
    }),
    paletteLooks: {
      type: 'array',
      description:
        'Exactly 4 complete outfits built from their palette for different moments (e.g. work, weekend, an evening out, a celebration), right for how they dress.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'outfit'],
        properties: {
          name: { type: 'string', description: '2 or 3 words, e.g. "Weekend olive".' },
          outfit: {
            type: 'string',
            description:
              'Head to toe in one line, every piece with its color, shoes last, e.g. "olive silk blouse, camel wide-leg trousers, cream loafers".',
          },
        },
      },
    },
    gameChangers: textBlock(
      'Exactly 3 surprising, specific discoveries about their colors that most people with their coloring miss. title: 2 to 5 words, e.g. "Espresso beats black". text: one or two sentences on what to do and what it does for their face.',
    ),
  },
}

export const COLOR_REPORT_INSTRUCTIONS = [
  'You are an expert color analyst using the 12-season system, writing a premium personal color report.',
  'You receive the client’s earlier analysis and their selfie. Keep the same season; refine and expand it.',
  'Choose specific, named shades a person can recognize in stores.',
  'Make them feel seen: describe what is really in their photo (the exact shade of their hair, their eyes, their skin) and tie every recommendation to it. Nothing generic that could fit anyone.',
  'The tests are rendered side by side on their own face: pick options with a clear, visible difference, and for the ones to avoid, choices people commonly make.',
  NEVER,
  'Write in warm, concise American English, second person.',
].join(' ')

// Someone who came for their colors may have no body yet: how they shop is
// asked on its own then.
export function buildColorReportRequest(avatar: AvatarDocument, presentation: Presentation) {
  const body = avatar.body

  return [
    `They dress in: ${presentation}.${body ? ` Height ${body.heightCm} cm, ${body.build} build.` : ''}`,
    `Face test: ${presentation === 'menswear' ? 'shirt colors' : 'lipstick shades'}.`,
    `Hair test: ${presentation === 'menswear' ? 'facial hair styles' : 'hair colors'}.`,
    'Earlier analysis:',
    describePalette(avatar.colorAnalysis),
    '',
    'Write their advanced color report from the attached selfie.',
  ].join('\n')
}

function describeSwatch(swatch: ColorSwatch) {
  return `${swatch.name} (${swatch.hex})`
}

// The free preview: their best and worst color from the color analysis,
// two head-and-shoulders portraits side by side.
export function buildDrapePreviewPrompt(best: ColorSwatch, worst: ColorSwatch) {
  return [
    'Image 1 is this person. Image 2 is a close-up of the same face.',
    'Create one landscape image divided into two side-by-side head-and-shoulders portraits of this SAME person, like a professional color analysis draping session.',
    'In both portraits they have the identical face, hair, skin tone and expression, facing the camera, with the same neutral light-grey background and the same soft daylight.',
    'In each portrait a plain, matte, solid-colored fabric drape covers their shoulders and chest up to the neck, hiding their clothes.',
    `Drape colors: left ${describeSwatch(best)}, right ${describeSwatch(worst)}.`,
    'Render the true effect of each color on their complexion, the way it really looks in daylight; do not retouch the skin differently between portraits.',
    'A thin white gutter between the two portraits. No text, no labels, no logos.',
  ].join(' ')
}

// The same pair from the selfie alone, for someone who came for their colors
// and has no avatar yet: their real face, which is what the colors are read
// from anyway.
export function buildSelfieDrapePreviewPrompt(best: ColorSwatch, worst: ColorSwatch) {
  return [
    'Image 1 is a selfie of this person.',
    'Create one landscape image divided into two side-by-side head-and-shoulders portraits of this SAME person, like a professional color analysis draping session.',
    'Keep them exactly recognizable: the same face, features, hair, skin tone and undertone as in the selfie. In both portraits they have the identical face and expression, facing the camera, with the same neutral light-grey background and the same soft daylight.',
    'In each portrait a plain, matte, solid-colored fabric drape covers their shoulders and chest up to the neck, hiding their clothes.',
    `Drape colors: left ${describeSwatch(best)}, right ${describeSwatch(worst)}.`,
    'Render the true effect of each color on their complexion, the way it really looks in daylight; do not retouch the skin differently between portraits.',
    'A thin white gutter between the two portraits. No text, no labels, no logos.',
  ].join(' ')
}

// The free preview as a 2x2: their three best colors and their worst
// (bottom right), from the avatar and the selfie, or the selfie alone.
export function buildDrapeGridPreviewPrompt(bests: ColorSwatch[], worst: ColorSwatch, fromSelfie: boolean) {
  const [first, second, third] = bests

  return [
    fromSelfie
      ? 'Image 1 is a selfie of this person. Keep them exactly recognizable: the same face, features, hair, skin tone and undertone as in the selfie.'
      : 'Image 1 is this person. Image 2 is a close-up of the same face.',
    'Create one square image divided into a 2 by 2 grid of four head-and-shoulders portraits of this SAME person, like a professional color analysis draping session.',
    'In every panel they have the identical face, hair, skin tone and expression, facing the camera, with the same neutral light-grey background and the same soft daylight.',
    'In each panel a plain, matte, solid-colored fabric drape covers their shoulders and chest up to the neck, hiding their clothes.',
    `Drape colors: top-left ${describeSwatch(first!)}, top-right ${describeSwatch(second!)}, bottom-left ${describeSwatch(third!)}, bottom-right ${describeSwatch(worst)}.`,
    'Render the true effect of each color on their complexion, the way it really looks in daylight; do not retouch the skin differently between panels.',
    'Thin white gutters between panels. No text, no labels, no logos.',
  ].join(' ')
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

// The report boards: one image comparing options on the person, labeled by
// the app. Panels are listed in reading order (a grid is top-left,
// top-right, bottom-left, bottom-right).
const PORTRAIT_REFS = 'Image 1 is this person. Image 2 is a close-up of the same face.'
// Before the avatar (colors first) the portraits come from the selfie alone.
const SELFIE_REFS =
  'Image 1 is a selfie of this person. Keep them exactly recognizable: the same face, features, hair, skin tone and undertone as in the selfie.'

export function selfieOnly(prompt: string) {
  return prompt.replace(PORTRAIT_REFS, SELFIE_REFS)
}
const BODY_REFS = 'Image 1 is this person in full body.'
const GRID = 'Create one square image divided into a 2 by 2 grid of four'
const GRID_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const SAME_FACE =
  'In every panel they have the identical face, hair, facial hair, skin tone and expression, facing the camera, with the same neutral light-grey background and the same soft daylight. Render the true effect of each option on their complexion; do not retouch the skin differently between panels. Thin white gutters between panels. No text, no labels, no logos.'
// The prototype's wording. Asking for empty floor under the shoes only made
// the model fill the frame more; the web labels these boards at the corners.
const FULL_BODY =
  'full-body photos of this SAME person (identical face, hair, facial hair, skin tone, body shape and height proportions), standing and facing the camera, the whole body visible'
const SAME_STUDIO =
  'Same neutral light-grey studio background and soft even light in every panel. Thin white gutters between panels. No text, no labels, no logos.'

const inGrid = (options: string[]) => options.map((option, index) => `${GRID_POSITIONS[index]}: ${option}`).join('; ')

// Neutrals and whites, draped like the drape test.
export function buildDrapeBoardPrompt(panels: ColorSwatch[]) {
  return [
    PORTRAIT_REFS,
    `${GRID} head-and-shoulders portraits of this SAME person, like a professional color analysis draping session.`,
    'In each panel a plain, matte, solid-colored fabric drape covers their shoulders and chest up to the neck, hiding their clothes.',
    `Drape colors: ${inGrid(panels.map(describeSwatch))}.`,
    SAME_FACE,
  ].join(' ')
}

// A tight crop and bold pieces, so gold against silver reads at a glance.
export function buildMetalsBoardPrompt(metals: readonly ['gold' | 'silver', 'gold' | 'silver'], presentation: Presentation) {
  const menswear = presentation === 'menswear'
  const jewelry = (metal: string) =>
    menswear
      ? `a bold, chunky, highly polished ${metal} chain necklace resting on the skin at the base of the neck`
      : `large, bold, highly polished ${metal} hoop earrings, clearly visible, and a chunky ${metal} chain necklace resting on the skin`

  return [
    PORTRAIT_REFS,
    'Create one wide image divided into two side-by-side close-up portraits of this SAME person, cropped tight from the top of the head to just below the collarbones, so the face, ears and neck fill each panel.',
    `They wear ${menswear ? 'the same plain oatmeal shirt, open at the collar' : 'the same plain oatmeal top with a scoop neckline'} in both panels.`,
    `Left panel: ${jewelry(metals[0])}. Right panel: ${jewelry(metals[1])}.`,
    'The jewelry is the same design and size in both panels; only the metal changes.',
    SAME_FACE,
  ].join(' ')
}

export function buildLipsBoardPrompt(panels: ColorSwatch[]) {
  return [
    PORTRAIT_REFS,
    `${GRID} close-up head-and-shoulders portraits of this SAME person, wearing the same plain oatmeal crew-neck top and the same light natural makeup, changing ONLY the lipstick color.`,
    `Lipstick: ${inGrid(panels.map(describeSwatch))}.`,
    'The lipstick is satin and clearly visible.',
    SAME_FACE,
  ].join(' ')
}

export function buildShirtsBoardPrompt(panels: ColorSwatch[]) {
  return [
    PORTRAIT_REFS,
    `${GRID} head-and-shoulders portraits of this SAME person, each wearing the same classic button-up shirt with an open collar, changing ONLY the shirt color.`,
    `Shirt colors: ${inGrid(panels.map(describeSwatch))}.`,
    SAME_FACE,
  ].join(' ')
}

// Their current color stays in the first panel for comparison.
export function buildHairBoardPrompt(current: string, panels: ColorSwatch[]) {
  return [
    PORTRAIT_REFS,
    `${GRID} head-and-shoulders portraits of this SAME person, wearing the same plain oatmeal crew-neck top, with the identical haircut, length and texture, changing ONLY the hair color.`,
    `Hair color: ${inGrid([`their current color (${current.toLowerCase()}), unchanged`, ...panels.map(describeSwatch)])}.`,
    'Realistic salon-quality hair color.',
    SAME_FACE,
  ].join(' ')
}

// Menswear: their current facial hair first, then three styles to compare.
export function buildBeardBoardPrompt(current: string, styles: string[]) {
  return [
    PORTRAIT_REFS,
    `${GRID} head-and-shoulders portraits of this SAME person, wearing the same plain oatmeal crew-neck top, with the identical haircut and hair color, changing ONLY the facial hair.`,
    `Facial hair: ${inGrid([`their current facial hair (${current.toLowerCase()}), unchanged`, ...styles.map((style) => style.toLowerCase())])}.`,
    'Realistic, well-groomed facial hair in their natural color. In every panel they have the identical face shape, features, skin tone and expression, facing the camera, with the same neutral light-grey background and the same soft daylight. Thin white gutters between panels. No text, no labels, no logos.',
  ].join(' ')
}

export function buildPaletteBoardPrompt(outfits: string[], season: string) {
  return [
    BODY_REFS,
    `${GRID} ${FULL_BODY}, each wearing a different outfit in their ${season} colors.`,
    `Outfits: ${inGrid(outfits)}.`,
    'Every garment and the shoes exactly as described.',
    SAME_STUDIO,
  ].join(' ')
}

// One color in every panel, so only the cut changes. The shoes are spelled
// out: left alone, the model copies the avatar's sneakers.
export function buildSilhouettesBoardPrompt(outfits: string[], color: ColorSwatch) {
  return [
    BODY_REFS,
    `${GRID} ${FULL_BODY}.`,
    `All the clothing in every panel is the same ${describeSwatch(color)}, so only the silhouette changes; the shoes are exactly as described.`,
    `Outfits: ${inGrid(outfits)}.`,
    SAME_STUDIO,
  ].join(' ')
}

export function buildNecklinesBoardPrompt(tops: string[], color: ColorSwatch) {
  return [
    PORTRAIT_REFS,
    `${GRID} upper-body portraits of this SAME person, framed from the waist up, each wearing a visibly different top in the same ${describeSwatch(color)}.`,
    `Tops: ${inGrid(tops)}.`,
    'Each top is a different garment with its own neckline or collar, clearly visible.',
    SAME_FACE,
  ].join(' ')
}

export function buildCapsuleBoardPrompt(items: StyleProfile['capsule']) {
  const pieces = items.map((item) => {
    const name = item.name.toLowerCase()
    const material = item.material.toLowerCase()

    return `${item.color.toLowerCase()} ${name.includes(material) ? '' : `${material} `}${name}`
  })

  return [
    `A clean, beautiful top-down flat-lay (knolling) of ${items.length} clothing items neatly arranged in a grid on a light natural linen surface,`,
    'soft daylight, realistic product photography, no people, no text:',
    `${pieces.join(', ')}.`,
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
    'silhouetteTest',
    'necklineTest',
    'signaturePieces',
    'capsule',
    'capsuleNote',
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
    silhouetteTest: comparison({
      panels: {
        type: 'array',
        description:
          'Exactly 4 silhouettes for their build and height, in this order: 2 that flatter their proportions (wear), then 2 common ones that work against them (avoid). They are shown in one neutral color, so name no colors except for the shoes. Menswear gets menswear silhouettes, e.g. tapered vs skinny trousers, tucked vs untucked shirts, jacket lengths.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'garment', 'verdict'],
          properties: {
            name: { type: 'string', description: 'The silhouette in 2 to 4 words, e.g. "Belted wrap dress".' },
            garment: {
              type: 'string',
              description:
                'The whole outfit in one line (cut, length and fit), ending with the shoes, e.g. "knee-length wrap dress that defines the waist, tan block-heel pumps".',
            },
            verdict,
          },
        },
      },
      insight: 'Define your waist',
      note: 'One or two sentences on why, about proportion, line and balance on their build and height.',
    }),
    necklineTest: comparison({
      panels: {
        type: 'array',
        description:
          'Exactly 4 visibly different tops, each with its own neckline or collar, in this order: 2 that flatter them (wear), then 2 that don’t (avoid). Necklines (e.g. V-neck knit, scoop-neck tee, crew-neck sweater, turtleneck) or collars (e.g. open-collar shirt, crew-neck tee, henley, mock neck), as the request says.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'verdict'],
          properties: {
            name: { type: 'string', description: 'The top and its neckline in 2 to 4 words, e.g. "V-neck knit".' },
            verdict,
          },
        },
      },
      insight: 'Open necklines are yours',
      note: 'One or two sentences on why, framed as what it does for them (balance, line, how it frames their face).',
    }),
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
    capsuleNote: {
      type: 'string',
      description: 'One or two sentences on how the capsule works for them: what anchors it and how the pieces mix.',
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
  'Make them feel understood: tie every choice to their own build, height and coloring, and say what it does for them. Nothing generic that could fit anyone.',
  'Talk about proportion, line and balance, never about weight or flaws: say what a cut does for them, never that another makes them look heavier, wider or shorter.',
  NEVER,
  'Write in warm, concise American English, second person.',
].join(' ')

export function buildStyleProfileRequest(avatar: AvatarDocument, looks: LookDocument[]) {
  const body = bodyOf(avatar)
  const coloring = avatar.colorReport?.data.coloring
  const saved = looks.map(
    (look) =>
      `- ${look.plan.title} (${look.plan.vibe}, for "${look.occasion.text}"): ${look.plan.items
        .map((item) => `${item.color} ${item.name.toLowerCase()}`)
        .join(', ')}`,
  )

  return [
    `Dresses in: ${body.presentation}. Height ${body.heightCm} cm, weight ${body.weightKg} kg, ${body.build} build.`,
    `Neckline test: ${body.presentation === 'menswear' ? 'collars' : 'necklines'}.`,
    describePalette(avatar.colorAnalysis),
    ...(coloring ? [`Their coloring: ${coloring.skin} (skin); ${coloring.hair} (hair); ${coloring.eyes} (eyes).`] : []),
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
    `Client: dresses in ${bodyOf(avatar).presentation}, ${bodyOf(avatar).heightCm} cm, ${bodyOf(avatar).build} build.`,
    describePalette(avatar.colorAnalysis),
    '',
    'The attached image shows them wearing it.',
  ].join('\n')
}
