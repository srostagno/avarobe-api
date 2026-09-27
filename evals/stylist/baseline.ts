// Frozen copy of the stylist prompt as it was in production on 27-sep-2026,
// before the brief-decoding and taste changes. The evals compare against it.
import type { AvatarDocument } from '../../src/types/mongo.js'
import { describePalette } from '../../src/modules/avatar/prompts.js'
import { LOOK_SLOTS } from '../../src/modules/looks/prompts.js'

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

export const baselineLookPlanSchema = {
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

export const BASELINE_LOOK_PLAN_INSTRUCTIONS = [
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

export function buildBaselineLookPlanRequest(input: {
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

