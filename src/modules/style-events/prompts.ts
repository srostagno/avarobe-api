import type { AvatarDocument, EventBudget, LookDocument } from '../../types/mongo.js'

// The Event Stylist: the brief the look planner gets for an event (budget and
// day on top of their notes), and how to finish the looks it made.

const BUDGETS: Record<EventBudget, string> = {
  save: 'Budget: keep it affordable, high-street pieces that are easy to find (roughly under $60 a piece).',
  mid: 'Budget: mid-range, quality high-street to contemporary brands (roughly $60 to $200 a piece).',
  splurge: 'Budget: investment pieces worth keeping, premium and designer.',
}

// "2026-10-10" as "Saturday, October 10, 2026".
export function describeDay(date: string) {
  const day = new Date(`${date}T12:00:00Z`)

  if (Number.isNaN(day.getTime())) {
    return null
  }

  return day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function buildEventNotes(input: { notes: string | null; budget: EventBudget; date: string | null }) {
  const day = input.date ? describeDay(input.date) : null

  return [
    input.notes,
    BUDGETS[input.budget],
    day ? `The event is on ${day}; dress for the season and weather that day usually brings.` : null,
    'Each look must be complete and ready to wear to this event, with shoes and a bag or the accessories it needs.',
  ]
    .filter(Boolean)
    .join(' ')
}

export const EVENT_PREP_INSTRUCTIONS = [
  'You are a personal stylist finishing your client’s outfits for one event.',
  'Write in second person, warm and specific, plain words, no fashion jargon.',
  'Use what you know about them: their color season, hair and the three looks you planned.',
  'Never mention prices or brands.',
].join(' ')

export const eventPrepSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hair', 'face', 'accessories', 'checklist'],
  properties: {
    hair: {
      type: 'string',
      description: 'How to wear their hair for this event and these looks, 1 or 2 sentences.',
    },
    face: {
      type: 'string',
      description:
        'Makeup for womenswear (lips, eyes, blush in their colors), or grooming for menswear (beard, skin, finish), 1 or 2 sentences.',
    },
    accessories: {
      type: 'string',
      description: 'Jewelry, metals, watch, bag or belt that finish the looks, in their best metal, 1 or 2 sentences.',
    },
    checklist: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: { type: 'string' },
      description: 'Short things to sort out before the day (a fitting, steaming, breaking in shoes, a layer for the evening), each under 12 words.',
    },
  },
}

export function buildEventPrepRequest(input: {
  avatar: Pick<AvatarDocument, 'body' | 'colorAnalysis' | 'hairProfile'>
  occasion: string
  dressCode: string
  date: string | null
  looks: Pick<LookDocument, 'plan'>[]
}) {
  const colors = input.avatar.colorAnalysis
  const hair = input.avatar.hairProfile?.data
  const day = input.date ? describeDay(input.date) : null

  return [
    `Event: ${input.occasion}`,
    `Dress code: ${input.dressCode}`,
    day ? `Day: ${day}` : null,
    `Presentation: ${input.avatar.body?.presentation ?? 'unisex'}`,
    colors ? `Color season: ${colors.season}; undertone ${colors.undertone}; best metal ${colors.metals}.` : null,
    hair ? `Hair: ${hair.hairType.texture}, ${hair.hairType.density}, ${hair.hairType.currentLength}; face shape ${hair.faceShape}.` : null,
    'The looks:',
    ...input.looks.map(
      (look, index) =>
        `${index + 1}. ${look.plan.title}: ${look.plan.items.map((item) => `${item.color} ${item.name}`).join(', ')}`,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}
