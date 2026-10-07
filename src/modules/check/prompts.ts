import type { AvatarBody, ColorAnalysis, StyleProfile } from '../../types/mongo.js'
import { type StylistTaste, describeTaste } from '../looks/prompts.js'

// "Will it suit me?": reading a garment photo against their colors (every
// check), and the full read (Pro, and everyone's first): why it works or
// not from several angles, how to wear it, and the piece on their avatar.

export const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['garment', 'color', 'verdict', 'reason', 'alternatives'],
  properties: {
    // What the photo shows, in a few words ("linen button-down shirt").
    garment: { type: 'string' },
    // The garment's main color, as it would sit near the face.
    color: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'hex'],
      properties: { name: { type: 'string' }, hex: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
    },
    // wear: near the face. away: fine as pants, skirts, shoes or bags. avoid: skip it.
    verdict: { type: 'string', enum: ['wear', 'away', 'avoid', 'unclear'] },
    reason: { type: 'string' },
    // Up to three colors from their palette to look for instead (or as well).
    alternatives: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'hex'],
        properties: { name: { type: 'string' }, hex: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
      },
    },
  },
} as const

export type CheckReading = {
  garment: string
  color: { name: string; hex: string }
  verdict: 'wear' | 'away' | 'avoid' | 'unclear'
  reason: string
  alternatives: { name: string; hex: string }[]
}

export function buildCheckInstructions(analysis: ColorAnalysis) {
  const swatches = (list: { name: string; hex: string }[]) => list.map((swatch) => `${swatch.name} ${swatch.hex}`).join(', ')

  return [
    'You are a professional color analyst. The image is a photo of one garment someone is thinking of buying: a product photo, a screenshot from a store, or a photo taken in a shop.',
    `Their color season is ${analysis.season}: ${analysis.undertone} undertone, ${analysis.contrast} contrast. Best metals: ${analysis.metals}.`,
    `Their best colors: ${swatches(analysis.bestColors)}.`,
    `Their neutrals: ${swatches(analysis.neutrals)}.`,
    `Colors to keep away from their face: ${swatches(analysis.avoidColors)}.`,
    'Identify the garment and its main color as it would sit near the face (ignore the background, the model, small trims and prints shown elsewhere). Give the color a plain name and an accurate hex.',
    'Verdict:',
    '- "wear": the color flatters them near the face (it sits in or close to their palette in undertone, depth and clarity).',
    '- "away": not ideal next to their face but fine away from it (pants, skirts, shoes, bags), or as a neutral base.',
    '- "avoid": it works against their coloring and the garment is worn near the face; suggest what to look for instead.',
    '- "unclear": the photo does not show a garment or its color clearly.',
    'Reason: one or two short sentences to them ("you"), about the color and their coloring only. Never comment on their body, age or looks, and never use words like "drains your face" more than once. Mention a styling fix when the verdict is "away".',
    'Alternatives: up to three colors from their palette in a similar spirit (same family or role), or none when the verdict is "wear".',
  ].join('\n')
}

// Their face from the selfie, the drape changed to the garment's color.
export function buildCheckRenderPrompt(color: { name: string; hex: string }) {
  return [
    'Image 1 is a selfie of this person.',
    'Create a head-and-shoulders photo of this SAME person in a color analysis draping session: identical face, features, hair, expression and skin, facing the camera, soft even daylight, a plain light neutral-grey backdrop.',
    `A plain matte fabric drape in ${color.name.toLowerCase()} (${color.hex}) covers their shoulders and chest up to the base of the neck, hiding all clothes.`,
    'Render the true effect of that color on their complexion, as in a real draping session: its reflected light and contrast next to the face. Do not retouch, slim or beautify; keep their skin texture.',
    'Realistic photograph, sharp focus on the eyes. No text, no logos, no watermark.',
  ].join(' ')
}

// The full read: the color reading above, plus the verdict from every angle.
export const DEEP_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CHECK_SCHEMA.required, 'deep'],
  properties: {
    ...CHECK_SCHEMA.properties,
    deep: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'headline', 'summary', 'angles', 'whyYes', 'whyNot', 'makeItWork', 'wearWith', 'complete'],
      properties: {
        overall: { type: 'string', enum: ['yes', 'depends', 'no'] },
        headline: { type: 'string' },
        summary: { type: 'string' },
        angles: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'verdict', 'note'],
            properties: {
              key: { type: 'string', enum: ['color', 'cut', 'style', 'versatility', 'occasions'] },
              verdict: { type: 'string', enum: ['good', 'mixed', 'poor'] },
              note: { type: 'string' },
            },
          },
        },
        whyYes: { type: 'array', maxItems: 4, items: { type: 'string' } },
        whyNot: { type: 'array', maxItems: 4, items: { type: 'string' } },
        makeItWork: { type: 'array', maxItems: 3, items: { type: 'string' } },
        // What to wear it with, in their colors.
        wearWith: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'hex'],
            properties: { name: { type: 'string' }, hex: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
          },
        },
        // For the picture: the fewest pieces that complete an outfit around it.
        complete: { type: 'array', maxItems: 4, items: { type: 'string' } },
      },
    },
  },
} as const

export type CheckAngle = { key: 'color' | 'cut' | 'style' | 'versatility' | 'occasions'; verdict: 'good' | 'mixed' | 'poor'; note: string }

export type DeepCheckReading = CheckReading & {
  deep: {
    overall: 'yes' | 'depends' | 'no'
    headline: string
    summary: string
    angles: CheckAngle[]
    whyYes: string[]
    whyNot: string[]
    makeItWork: string[]
    wearWith: { name: string; hex: string }[]
    complete: string[]
  }
}

function describeStyleProfile(profile: StyleProfile | null) {
  if (!profile) {
    return null
  }

  const best = (test: { panels: { name: string; verdict: string }[] } | undefined) =>
    test?.panels.filter((panel) => panel.verdict === 'wear').map((panel) => panel.name) ?? []

  return [
    `Their style profile: ${profile.archetype} (${profile.keywords.join(', ')}).`,
    profile.silhouettes.length > 0 ? `What suits their shape: ${profile.silhouettes.map((item) => `${item.area}: ${item.advice}`).join(' ')}` : null,
    best(profile.silhouetteTest).length > 0 ? `Silhouettes that work best on them: ${best(profile.silhouetteTest).join(', ')}.` : null,
    best(profile.necklineTest).length > 0 ? `Necklines or collars that work best: ${best(profile.necklineTest).join(', ')}.` : null,
    profile.skip.length > 0 ? `What they're better off skipping: ${profile.skip.join('; ')}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function buildDeepCheckInstructions(input: {
  analysis: ColorAnalysis
  body: AvatarBody | null
  styleProfile: StyleProfile | null
  taste: StylistTaste | null
}) {
  const { body } = input

  return [
    'You are Avarobe, a senior personal stylist and color analyst for American clients. The image is a photo of one garment (or accessory) someone is thinking of buying: a product photo, a screenshot from a store, a photo taken in a shop or someone wearing it.',
    'Part 1, the color reading, exactly as a color analyst would:',
    buildCheckInstructions(input.analysis),
    '',
    'Part 2, "deep": should they buy it? Read it honestly from every angle, the way a trusted stylist would in the fitting room.',
    'Client profile:',
    body
      ? `- Dresses in: ${body.presentation}. Height ${body.heightCm} cm, ${body.build} build.`
      : '- No body measurements yet (they have only sent a selfie).',
    describeStyleProfile(input.styleProfile),
    describeTaste(input.taste),
    '',
    'overall: "yes" when it works for them and is worth buying; "depends" when it works only with conditions (name them); "no" when they are better off skipping it (then point them to what to look for instead). Be honest: do not say yes to please them.',
    'headline: one short sentence with the verdict, to them ("Yes: this rust knit is made for you.").',
    'summary: two or three sentences with the main reasons.',
    'angles: exactly five, in this order:',
    '- color: the color against their palette, near the face or away from it.',
    body
      ? '- cut: the shape, length, fit and proportions on their build and height. Frame it positively: say what it does for them, or what would do it better. Never mention weight or body flaws.'
      : '- cut: the cut in general (shape, length, fit) and what tends to make it flattering; say that a full read on their body comes with their avatar.',
    '- style: how it fits their style profile and taste (when known), or the style it signals.',
    '- versatility: how many outfits it makes with the colors and pieces they likely own (their palette and neutrals); a piece that only goes with one thing is "mixed" at best.',
    '- occasions: where and when they would wear it, and whether that matches how they live.',
    'Each angle: verdict "good", "mixed" or "poor", and a note of one or two short sentences, specific to them.',
    'whyYes: up to four concrete reasons it works for them (empty if none). whyNot: up to four concrete reasons it does not, or what holds it back (empty if nothing does).',
    'makeItWork: up to three practical fixes when it is "depends" or "no" (a size up, tailoring, how to tuck or layer it, wearing it away from the face, the shade to look for instead); empty when it is "yes" and needs none.',
    'wearWith: two to four pieces to wear it with, named as garments in colors from their best colors or neutrals ("Ivory silk camisole"), each with that color\'s hex. Never a color from the ones to keep away from their face, not even for shoes.',
    'complete: for a picture of them wearing it, the fewest common garments and shoes (in their best colors or neutrals, matching how they dress) that complete a head-to-toe outfit around it; empty if the photo already shows a whole outfit.',
    'If the photo does not show a garment clearly, the color verdict is "unclear" and deep says so briefly, with overall "depends".',
    'Never comment on their age or looks. Use generic garment names, never brands. Warm, concise American English, second person.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

// The garment on their avatar, head to toe, with the pieces that complete it.
export function buildCheckOnAvatarPrompt(reading: DeepCheckReading) {
  return [
    'Image 1 is this person in full body. Image 2 is a close-up of the same face. Image 3 is a photo of one garment or accessory they are thinking of buying; it may be a product photo, a store photo or worn by someone else.',
    `Create a new full-body photo of the SAME person from images 1 and 2 wearing the ${reading.garment} from image 3, reproduced faithfully: the same color, fabric, pattern, print, cut, length and details.`,
    reading.deep.complete.length > 0 ? `To complete the outfit they also wear: ${reading.deep.complete.join('; ')}.` : null,
    'Never take the face, hair, skin tone, body shape or pose from image 3. The person keeps their identical face, hair, facial hair, skin tone, body shape and height proportions from images 1 and 2, and the garment fits their body naturally, as it really would.',
    'Keep the face fully visible. Pose: standing, facing the camera, relaxed and natural, the whole body visible from head to shoes.',
    'Seamless light warm-grey studio backdrop, soft even lighting, realistic fashion lookbook photo, no text, no logos.',
  ]
    .filter((line): line is string => line !== null)
    .join(' ')
}
