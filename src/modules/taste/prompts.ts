import type { FeedbackAspect, LookFeedback, LookItem, LookPlan } from '../../types/mongo.js'

// One look the person reacted to: a thumbs up or down (with what they
// singled out), or just saved as a favorite.
export type TasteSignal = {
  occasion: string
  plan: Pick<LookPlan, 'title' | 'vibe' | 'items'>
  feedback: Pick<LookFeedback, 'rating' | 'aspects' | 'pieces' | 'note'> | null
  favorite: boolean
}

const noteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'evidence'],
  properties: {
    text: {
      type: 'string',
      description:
        'A short, specific stylist note of 2 to 6 words, e.g. "Boots over sneakers", "No shorts", "Suede and leather jackets", "Dark, muted colors".',
    },
    evidence: {
      type: 'integer',
      description: 'How many of the listed looks support it.',
    },
  },
}

export const tasteLearningSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'loves', 'avoids'],
  properties: {
    summary: {
      type: 'string',
      description:
        'One sentence in second person on what defines their taste, or an empty string when the signals are too thin to say.',
    },
    loves: { type: 'array', description: 'At most 8, strongest first.', items: noteSchema },
    avoids: { type: 'array', description: 'At most 8, strongest first.', items: noteSchema },
  },
}

export const TASTE_LEARNING_INSTRUCTIONS = [
  'You keep a client\'s style taste profile for their personal stylist, who reads it before designing every outfit.',
  'Read how they reacted to past looks and write what they love and what they avoid as short, specific notes a stylist can act on: kinds of pieces, colors, fits, fabrics, attitude or references.',
  'Weigh the signals: their own words are the strongest; pieces they singled out come next; a thumbs up or down with reasons helps; a bare thumbs down or a favorite with no comment says little on its own.',
  'Name the pattern behind repeated reactions while staying concrete, for example "Not preppy (polos, loafers)" when they reject polos and loafers across looks.',
  'Only write a note that their own words state or that at least two looks support. When a single look is all you have, keep only what they spelled out.',
  'Keep taste apart from accuracy: "missed my request", "too formal", "too casual" and "wrong for the weather" describe that one occasion, not their taste, unless the same complaint repeats across different occasions.',
  'Write each note as the thing itself: loves as what to use ("Chelsea boots", "Wide-leg trousers"), avoids as what to leave out ("Polos", "Pastels"), never as a comparison and never as a double negative. A note never sits in both lists.',
  'Notes are about them, not about one event: "Black leather jackets" rather than "Leather jacket for bars".',
  'Newer reactions win over older ones when they conflict.',
  'Never repeat or contradict the notes the client wrote themselves, and never write a note they removed, even reworded.',
  'Write in American English.',
].join(' ')

export const FEEDBACK_ASPECTS = [
  'style',
  'colors',
  'fit',
  'occasion',
  'too_formal',
  'too_casual',
  'missed_request',
  'weather',
] as const satisfies readonly FeedbackAspect[]

const ASPECT_WORDS: Record<FeedbackAspect, { up: string; down: string }> = {
  style: { up: 'loved the style', down: 'not their style' },
  colors: { up: 'loved the colors', down: 'the colors were off' },
  fit: { up: 'loved the fit', down: 'the fit was off' },
  occasion: { up: 'right for the occasion', down: 'wrong for the occasion' },
  too_formal: { up: 'too formal', down: 'too formal' },
  too_casual: { up: 'too casual', down: 'too casual' },
  missed_request: { up: 'missed what they asked for', down: 'missed what they asked for' },
  weather: { up: 'wrong for the weather', down: 'wrong for the weather' },
}

function describePiece(item: LookItem) {
  return `${item.color.toLowerCase()} ${item.name.toLowerCase()}`
}

// "Thumbs down (not their style). Pieces they disliked: …. In their words: …"
export function describeFeedback(
  plan: Pick<LookPlan, 'items'>,
  feedback: Pick<LookFeedback, 'rating' | 'aspects' | 'pieces' | 'note'>,
) {
  const aspects = feedback.aspects.map((aspect) => ASPECT_WORDS[aspect][feedback.rating])
  const pick = (vote: 'up' | 'down') =>
    feedback.pieces
      .filter((piece) => piece.vote === vote)
      .map((piece) => plan.items[piece.index])
      .filter((item): item is LookItem => Boolean(item))
      .map(describePiece)
  const lines = [`Thumbs ${feedback.rating}${aspects.length > 0 ? ` (${aspects.join('; ')})` : ' (no reason given)'}.`]

  if (pick('up').length > 0) {
    lines.push(`Pieces they liked: ${pick('up').join('; ')}.`)
  }

  if (pick('down').length > 0) {
    lines.push(`Pieces they disliked: ${pick('down').join('; ')}.`)
  }

  if (feedback.note) {
    lines.push(`In their words: "${feedback.note}"`)
  }

  return lines.join(' ')
}

function describeSignal(signal: TasteSignal, index: number) {
  const { plan, feedback } = signal
  const lines = [`Look ${index + 1}, styled for "${signal.occasion}": "${plan.title}" (${plan.vibe}).`]

  if (feedback) {
    lines.push(`Reaction: ${describeFeedback(plan, feedback)}`)
  } else if (signal.favorite) {
    lines.push('Reaction: saved it as a favorite, no comment.')
  }

  lines.push(`All pieces: ${plan.items.map(describePiece).join('; ')}.`)

  return lines.join('\n')
}

export function buildTasteLearningRequest(input: {
  statement: string | null
  loves: string[]
  avoids: string[]
  // What earlier passes learned, so notes keep their wording between passes.
  learnedLoves: string[]
  learnedAvoids: string[]
  dismissed: string[]
  signals: TasteSignal[]
}) {
  const learned = [...input.learnedLoves.map((note) => `love: ${note}`), ...input.learnedAvoids.map((note) => `avoid: ${note}`)]

  return [
    input.statement ? `In the client's own words: "${input.statement}"` : null,
    learned.length > 0
      ? `Notes you learned before (keep each one word for word while the reactions still support it; drop or change it only when newer reactions say otherwise): ${learned.join('; ')}`
      : null,
    input.loves.length > 0 ? `Notes the client wrote, loves (already in the profile): ${input.loves.join('; ')}` : null,
    input.avoids.length > 0 ? `Notes the client wrote, avoids (already in the profile): ${input.avoids.join('; ')}` : null,
    input.dismissed.length > 0 ? `Removed by the client, never write these: ${input.dismissed.join('; ')}` : null,
    '',
    `Their reactions to past looks, newest first (${input.signals.length}):`,
    ...input.signals.map(describeSignal),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
