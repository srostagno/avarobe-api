import type { ColorAnalysis } from '../../types/mongo.js'

// "Does this color suit me?": reading a garment photo against their colors,
// and drawing that color next to their face.

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
