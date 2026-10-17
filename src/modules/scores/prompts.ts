import type { ScoreKind } from '../../types/mongo.js'
import { CRITERIA, PROBLEMS, TIP_AREAS, criterionIds } from './rubrics.js'

// Look Score / Hair Score in two calls. 1. Measure (English, fixed settings):
// is the photo usable, and each criterion 0–4 against its anchors. 2. Words
// (her language): what works, what holds it back and three tips, written
// around the ratings measured, which it can't change.

const SUBJECT: Record<ScoreKind, string> = {
  look: 'a full-body photo of a woman (or man) wearing an outfit she wants rated',
  hair: 'a photo of a woman (or man) showing her hair, which she wants rated',
}

const PROBLEM_RULES: Record<string, string> = {
  no_person: '"no_person": no person is clearly visible.',
  several_people: '"several_people": more than one person is clearly the subject. Do not rate any of them.',
  minor: '"minor": the person looks under 18. Do not rate them.',
  too_dark: '"too_dark": too dark to judge.',
  too_blurry: '"too_blurry": too blurry to judge.',
  not_full_body:
    '"not_full_body": no outfit can be judged: only the face or head is visible, or the clothes are cut off above the chest. A photo from the waist or chest down to the hips is NOT this problem: rate it with framing "partial".',
  hair_not_visible: '"hair_not_visible": the hair is not clearly visible (covered, out of frame or too far away).',
}

const GUARDRAILS = [
  'Rate only the clothes and styling (a look) or the hair (hair). Never rate, mention or let her body, weight, shape, height, face, skin or age affect anything: a great outfit on any body scores high.',
  'No brand names, no medical or cosmetic procedures.',
]

export const SHOWS = ['face', 'hair', 'upper_body', 'full_body', 'no_person'] as const
export type Shows = (typeof SHOWS)[number]

export function measureSchema(kind: ScoreKind) {
  const ids = criterionIds(kind)

  return {
    type: 'object',
    additionalProperties: false,
    required: ['usable', 'problem', 'shows', 'photo', 'criteria'],
    properties: {
      usable: { type: 'boolean' },
      problem: { type: 'string', enum: ['none', ...PROBLEMS[kind]] },
      // What the photo mainly shows, so a photo that can't be rated here
      // can be sent to the studio it fits (Face Age, Look Score, Hair Score).
      shows: { type: 'string', enum: SHOWS },
      photo: {
        type: 'object',
        additionalProperties: false,
        required: ['light', 'framing'],
        properties: {
          light: { type: 'string', enum: ['good', 'dim', 'harsh'] },
          framing: { type: 'string', enum: ['good', 'partial'] },
        },
      },
      criteria: {
        type: 'object',
        additionalProperties: false,
        required: ids,
        properties: Object.fromEntries(ids.map((id) => [id, { type: 'integer', enum: [0, 1, 2, 3, 4] }])),
      },
    },
  } as const
}

export function buildMeasureInstructions(kind: ScoreKind) {
  const criteria = CRITERIA[kind].map(
    (criterion) =>
      `- ${criterion.id} (${criterion.measures}): ${criterion.anchors.map((anchor, rating) => `${rating} = ${anchor}`).join('; ')}.`,
  )

  return [
    `You are a strict, consistent ${kind === 'look' ? 'stylist' : 'hair stylist'} rating ${SUBJECT[kind]}.`,
    'First check the photo:',
    ...PROBLEMS[kind].map((problem) => `- ${PROBLEM_RULES[problem]}`),
    'If any applies, set usable false, that problem, every criterion 0, and still describe the photo.',
    'shows: what the photo mainly shows: "face" (a face or head and shoulders, the clothes barely visible), "hair" (mostly the hair, from behind or the side), "upper_body" (from the waist or chest up), "full_body" (head to knees or toes), "no_person".',
    'Otherwise set usable true, problem "none", and rate each criterion with the whole number whose description fits best:',
    ...criteria,
    "Rate each criterion on its own, from what you see for that criterion only; criteria often differ. When a 0 or 1 description names something visible in the photo, give that rating even if the rest is fine. Give 4 only when its description truly fits. Judge what is visible; the light of the photo is not the outfit's or the hair's fault.",
    `photo: the light (good: soft and even; dim; harsh: hard shadows or flash) and the framing (good: ${kind === 'look' ? 'head to toe' : 'the whole hair clearly visible'}; partial).`,
    ...(kind === 'look'
      ? ['With framing "partial", rate every criterion on what is visible; never lower a rating for what is out of frame (shoes, hems).']
      : []),
    ...GUARDRAILS,
  ].join('\n')
}

export function wordsSchema(kind: ScoreKind) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'strengths', 'holdingBack', 'tips'],
    properties: {
      headline: { type: 'string' },
      strengths: { type: 'array', maxItems: 2, items: { type: 'string' } },
      holdingBack: { type: 'array', maxItems: 2, items: { type: 'string' } },
      tips: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['area', 'criterion', 'text'],
          properties: {
            area: { type: 'string', enum: TIP_AREAS[kind] },
            criterion: { type: 'string', enum: criterionIds(kind) },
            text: { type: 'string' },
          },
        },
      },
    },
  } as const
}

// `ratings`: the measured criteria (fixed). `palette`: her season, free to
// everyone; `bestColors` only when she owns the Color Report (no best
// colors before paying). `hair`: what the Hair studio read (face shape, hair
// type), when it has.
export function buildWordsInstructions(input: {
  kind: ScoreKind
  ratings: Record<string, number>
  weakest: string[]
  palette: { season: string; undertone: string; contrast: string } | null
  bestColors: string[] | null
  hair: { faceShape: string; texture: string; density: string } | null
}) {
  const criteria = CRITERIA[input.kind]
  const rated = criteria.map((criterion) => `- ${criterion.id} (${criterion.measures}): ${input.ratings[criterion.id]} of 4`)
  const color = input.bestColors?.length
    ? `Her color season is ${input.palette?.season ?? 'known'}. Her best colors: ${input.bestColors.join(', ')}. A color tip may name them.`
    : input.palette
      ? `Her color season is ${input.palette.season} (${input.palette.undertone} undertone, ${input.palette.contrast} contrast). A color tip may say the direction to go (warmer, softer, lighter, deeper), but never name specific colors for her: her own colors are in her Color Advisor.`
      : 'You do not know her personal colors. A color tip may say what the colors in the photo do and the direction to go, but never name a palette or season for her.'

  return [
    `You are a warm, honest ${input.kind === 'look' ? 'stylist' : 'hair stylist'}. The image is ${SUBJECT[input.kind]}.`,
    'An expert panel already rated it (0 to 4 per criterion). These ratings are final: your words must agree with them and never contradict them.',
    ...rated,
    `The weakest criteria, from the lowest: ${input.weakest.join(', ')}.`,
    color,
    ...(input.hair ? [`From her hair read: ${input.hair.faceShape} face, ${input.hair.texture} texture, ${input.hair.density} density.`] : []),
    'headline: one warm, honest sentence about this photo, to her ("you").',
    'strengths: one or two specific things in this photo that work, from the higher-rated criteria.',
    'holdingBack: one or two specific things that cost the most, from the weakest criteria, said kindly.',
    `tips: exactly three concrete changes, the first for the weakest criterion, each with its criterion and the area it belongs to. Practical and specific to what you see: ${input.kind === 'look' ? 'swaps, fixes or additions she can make with what she likely owns, or one small purchase' : 'what to ask at the salon, a product type or a styling step'}.`,
    'Never write any score, rating or other number. Write to her as "you", like a kind expert friend.',
    ...GUARDRAILS,
  ].join('\n')
}
