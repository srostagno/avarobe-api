import type { AvatarDocument, LookPlan } from '../../types/mongo.js'
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
          vibe: {
            type: 'string',
            enum: ['classic', 'modern', 'relaxed', 'bold', 'minimal', 'romantic', 'sporty'],
          },
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
              required: ['slot', 'name', 'color', 'colorHex', 'material', 'fit'],
              properties: {
                slot: { type: 'string', enum: [...LOOK_SLOTS] },
                name: {
                  type: 'string',
                  description: 'Generic garment name, no brands, e.g. "Single-breasted blazer".',
                },
                color: { type: 'string', description: 'Specific shade name.' },
                colorHex: { type: 'string', description: 'Hex like #1F3A5F.' },
                material: { type: 'string' },
                fit: { type: 'string', description: 'Cut and fit, e.g. "slim, tapered".' },
              },
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
