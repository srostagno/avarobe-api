import type { AvatarDocument, LookItem, LookPlan } from '../../types/mongo.js'
import { describePalette } from '../avatar/prompts.js'

export const LOOK_SLOTS = [
  'top',
  'layer',
  'outerwear',
  'bottom',
  'dress',
  'suit',
  'shoes',
  'accessory',
  'bag',
] as const

const LOOK_VIBES = ['classic', 'modern', 'relaxed', 'bold', 'minimal', 'romantic', 'sporty']

const lookItemProperties = {
  slot: { type: 'string', enum: [...LOOK_SLOTS] },
  name: {
    type: 'string',
    description: 'Generic garment name, no brands, e.g. "Single-breasted blazer".',
  },
  color: { type: 'string', description: 'Specific shade name.' },
  colorHex: { type: 'string', description: 'Hex like #1F3A5F.' },
  material: { type: 'string' },
  fit: { type: 'string', description: 'Cut and fit, e.g. "slim, tapered".' },
}

export const lookPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dressCode', 'occasionSummary', 'looks'],
  properties: {
    dressCode: {
      type: 'string',
      description:
        'The dress code this occasion calls for, e.g. "Cocktail attire", "Business casual", "Golf course attire".',
    },
    occasionSummary: {
      type: 'string',
      description: 'One sentence restating the occasion and what it asks of an outfit.',
    },
    looks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'vibe', 'summary', 'whyItWorks', 'items', 'stylingTips'],
        properties: {
          title: { type: 'string', description: '2 to 4 words.' },
          vibe: { type: 'string', enum: LOOK_VIBES },
          summary: { type: 'string', description: 'One sentence describing the look.' },
          whyItWorks: {
            type: 'string',
            description:
              'Two sentences tying the colors to their season and the cut to their body and the occasion.',
          },
          items: {
            type: 'array',
            description: 'Every garment head to toe, 4 to 7 items, always including shoes.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: Object.keys(lookItemProperties),
              properties: lookItemProperties,
            },
          },
          stylingTips: {
            type: 'array',
            description: '2 or 3 short, practical tips.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}

export const LOOK_PLAN_INSTRUCTIONS = [
  'You are Avarobe, a senior personal stylist for American clients.',
  'You design complete head-to-toe outfits that are right for the occasion and flattering on this specific person.',
  'Know US dress codes precisely: white tie, black tie, black tie optional, formal, cocktail, semi-formal, business formal, business casual, smart casual, casual.',
  'Know venue rules: golf courses usually require collared shirts and tailored shorts or trousers, no denim; country clubs lean preppy; many tennis clubs require whites; houses of worship and funerals call for modest, dark colors.',
  'Use the client color palette for the colors closest to the face; neutrals are fine elsewhere; keep avoid-colors away from the face.',
  'Choose cuts that suit their build and height. Never mention weight or body flaws; frame advice positively.',
  'Every garment must be a real, common item a person can find at mainstream US retailers. No brand names, no logos.',
  'Make the looks meaningfully different from each other (for example one classic, one modern, one with a bolder color), all appropriate for the occasion.',
  'The summary, whyItWorks and tips must describe exactly the listed items and colors, never a garment or color that is not in the list.',
  'Write in warm, concise American English, second person.',
].join(' ')

export function buildLookPlanRequest(input: {
  avatar: AvatarDocument
  occasion: string
  notes: string | null
  count: number
}) {
  const { body } = input.avatar

  return [
    `Occasion: ${input.occasion}`,
    input.notes ? `Extra notes from the client: ${input.notes}` : null,
    `Design exactly ${input.count} look${input.count > 1 ? 's' : ''}.`,
    '',
    'Client profile:',
    `- Dresses in: ${body.presentation}`,
    `- Height ${body.heightCm} cm, weight ${body.weightKg} kg, ${body.build} build`,
    describePalette(input.avatar.colorAnalysis),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function buildLookRenderPrompt(plan: LookPlan, occasion: string) {
  const garments = plan.items
    .map((item) => `${item.color} ${item.material} ${item.name.toLowerCase()} (${item.fit})`)
    .join('; ')

  return [
    'Image 1 is this person in full body. Image 2 is a close-up of the same face.',
    'Create a new full-body photo of this SAME person: identical face, hair, facial hair, skin tone, body shape and height proportions.',
    `They are dressed for: ${occasion}.`,
    `Outfit, head to toe: ${garments}.`,
    'Show every garment clearly with realistic fabric, drape and fit on their body.',
    'Keep the face fully visible: sunglasses, if part of the outfit, are hooked on the shirt or held in hand, never worn over the eyes.',
    'Pose: standing, facing the camera, relaxed and natural, the whole body visible from head to shoes.',
    'Seamless light warm-grey studio backdrop, soft even lighting, realistic fashion lookbook photo, no text, no logos.',
  ].join(' ')
}

// Try-on: read the outfit in a photo the person uploaded, so the look gets
// the same plan (pieces, colors, notes) as a styled one.
export const tryOnAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hasOutfit', 'dressCode', 'title', 'vibe', 'summary', 'whyItWorks', 'items', 'stylingTips'],
  properties: {
    hasOutfit: {
      type: 'boolean',
      description: 'False when the photo shows no clothing that can be worn (a landscape, food, a pet, text).',
    },
    dressCode: {
      type: 'string',
      description: 'The dress code this outfit fits best, e.g. "Smart casual", "Cocktail attire".',
    },
    title: { type: 'string', description: '2 to 4 words naming the outfit.' },
    vibe: { type: 'string', enum: LOOK_VIBES },
    summary: { type: 'string', description: 'One sentence describing the outfit.' },
    whyItWorks: {
      type: 'string',
      description:
        'Two honest, kind sentences on how these colors and cuts work on this person, and one tweak if something is off for their palette.',
    },
    items: {
      type: 'array',
      description:
        'Every garment visible in the photo, head to toe, plus the pieces needed to complete the outfit (for example shoes when the photo shows none).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...Object.keys(lookItemProperties), 'fromPhoto'],
        properties: {
          ...lookItemProperties,
          fromPhoto: {
            type: 'boolean',
            description: 'True if the item appears in the photo, false if you added it to complete the outfit.',
          },
        },
      },
    },
    stylingTips: {
      type: 'array',
      description: '2 or 3 short, practical tips for wearing it.',
      items: { type: 'string' },
    },
  },
}

export const TRY_ON_INSTRUCTIONS = [
  'You are Avarobe, a senior personal stylist for American clients.',
  'The client uploaded a photo of an outfit they want to try on. It may show a model, a mannequin, a flat lay or a store listing.',
  'List exactly the garments you see, with their real colors, fabrics and cuts. Ignore the person wearing them, the pose and the background.',
  'If the photo does not show a full outfit, add the fewest common pieces needed to complete it head to toe, chosen to suit the client, and mark them fromPhoto false.',
  'Judge the colors against the client palette honestly and kindly. Never mention weight or body flaws.',
  'Use generic garment names, never brand names or logos.',
  'Write in warm, concise American English, second person.',
].join(' ')

export function buildTryOnRequest(avatar: AvatarDocument, notes: string | null) {
  const { body } = avatar

  return [
    notes ? `Where the client wants to wear it: ${notes}` : null,
    'Client profile:',
    `- Dresses in: ${body.presentation}`,
    `- Height ${body.heightCm} cm, weight ${body.weightKg} kg, ${body.build} build`,
    describePalette(avatar.colorAnalysis),
    '',
    'Read the outfit in the attached photo.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function describeItem(item: LookItem) {
  return `${item.color} ${item.material} ${item.name.toLowerCase()} (${item.fit})`
}

export function buildTryOnRenderPrompt(plan: LookPlan) {
  const fromPhoto = plan.items.filter((item) => item.fromPhoto !== false)
  const added = plan.items.filter((item) => item.fromPhoto === false)

  return [
    'Image 1 is this person in full body. Image 2 is a close-up of the same face. Image 3 is a reference photo of clothing they want to try on; it may show another person, a mannequin or a flat lay.',
    'Create a new full-body photo of the SAME person from images 1 and 2 wearing the clothing from image 3.',
    `Reproduce each garment from image 3 faithfully, with the same color, fabric, pattern, print, cut, length and details: ${fromPhoto.map(describeItem).join('; ')}.`,
    added.length > 0 ? `To complete the outfit they also wear: ${added.map(describeItem).join('; ')}.` : null,
    'Never take the face, hair, skin tone, body shape or pose from image 3. The person keeps their identical face, hair, facial hair, skin tone, body shape and height proportions from images 1 and 2, and the garments fit their body naturally.',
    'Keep the face fully visible: sunglasses, if part of the outfit, are hooked on the shirt or held in hand, never worn over the eyes.',
    'Pose: standing, facing the camera, relaxed and natural, the whole body visible from head to shoes.',
    'Seamless light warm-grey studio backdrop, soft even lighting, realistic fashion lookbook photo, no text, no logos.',
  ]
    .filter((line): line is string => line !== null)
    .join(' ')
}

// Pieces: one product photo per garment, taken from the rendered look (and
// the uploaded photo for try-ons). No person may appear: these images go to
// the store search provider.
export function buildPiecePrompt(piece: LookItem, hasReference: boolean) {
  return [
    hasReference
      ? 'Image 1 shows a person wearing a complete outfit. Image 2 is the original photo of the same clothing.'
      : 'Image 1 shows a person wearing a complete outfit.',
    `Create a clean e-commerce product photo of only one item from it: the ${describeItem(piece)}.`,
    `Reproduce that exact item: same color (${piece.colorHex}), fabric, texture, pattern, cut, length and details.`,
    'Show it by itself, front view, as a ghost-mannequin or neatly laid-out packshot, centered with some margin on a plain pure white background, soft studio light.',
    'No person, no face, no skin, no hands, no mannequin, no other garments, no text, no logos, no watermark.',
  ].join(' ')
}
