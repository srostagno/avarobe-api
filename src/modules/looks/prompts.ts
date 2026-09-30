import type { AvatarDocument, LookDocument, LookItem, LookPlan, RemixChange } from '../../types/mongo.js'
import { describePalette } from '../avatar/prompts.js'
import { bodyOf } from '../avatar/body.js'

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

// The stylist reads the brief before designing anything: writing the asks,
// the decoded style and the weather first is what keeps the looks on it.
const briefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['asks', 'styleSignature', 'climate'],
  properties: {
    asks: {
      type: 'array',
      description:
        'Every explicit thing the client asked for, 2 to 6 short phrases close to their words: the event, any style, person, era, music or aesthetic they named, colors or pieces they want or refuse, the season or weather. Only what they wrote in the occasion and notes: never their profile, their taste profile or the number of looks.',
      items: { type: 'string' },
    },
    styleSignature: {
      type: 'string',
      description:
        'The concrete signature of the style they named (a person, film, era, subculture, music or aesthetic): its key garments, colors, fabrics, fits, footwear and accessories. If they named none, the signature of what the occasion calls for.',
    },
    climate: {
      type: 'string',
      description:
        'The weather the looks must handle and what it rules in or out, e.g. "Summer heat outdoors: breathable fabrics and short sleeves; no jackets unless carried for the evening."',
    },
  },
}

const lookSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'vibe', 'summary', 'whyItWorks', 'items', 'stylingTips', 'tasteApplied'],
  properties: {
    title: { type: 'string', description: '2 to 4 words.' },
    vibe: {
      type: 'string',
      description: 'This look\'s take on the brief in 1 or 2 plain words, e.g. "Sixties cool", "Rock edge", "Polished", "Relaxed".',
    },
    summary: { type: 'string', description: 'One sentence describing the look.' },
    whyItWorks: {
      type: 'string',
      description:
        'Two sentences: how it delivers what they asked for (the style they named, the occasion, the weather) and why its colors and cut work on them.',
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
    tasteApplied: {
      type: 'array',
      description:
        'Up to 2 of the client\'s "Loves" lines that this look uses, each copied word for word as one short line. Empty when there is no taste profile or the look uses none of them.',
      items: { type: 'string' },
    },
  },
}

export const lookPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['brief', 'dressCode', 'occasionSummary', 'looks'],
  properties: {
    brief: briefSchema,
    dressCode: {
      type: 'string',
      description:
        'The dress code this occasion calls for, e.g. "Cocktail attire", "Business casual", "Golf course attire".',
    },
    occasionSummary: {
      type: 'string',
      description: 'One sentence restating the occasion and what it asks of an outfit, including any style they named.',
    },
    looks: { type: 'array', items: lookSchema },
  },
}

export const LOOK_PLAN_INSTRUCTIONS = [
  'You are Avarobe, a senior personal stylist for American clients.',
  'You design complete head-to-toe outfits that deliver exactly what the client asked for and flatter this specific person.',
  'Read the brief before designing. Every explicit ask is a requirement: the event, any style, person, era, music or aesthetic they name, the colors or pieces they want or refuse, and the weather.',
  'When they name a style reference (a person, a film, an era, a subculture, a music genre), every look must read unmistakably as that reference: build it from the reference\'s signature garments, colors, fabrics, fits, footwear and accessories, adapted to the occasion and the weather, with at least two signature pieces in every look. A fashion editor should recognize it at a glance. When they name several references (an icon and a music genre, say), blend all of them in every look instead of giving each look one of them.',
  'Music they mention is a style signal too (rock or metal: black, denim, leather, boots; country: denim and western boots; jazz: dark and tailored): show it in every look.',
  'Vary the looks within the brief, never away from it: give different takes on the same reference (another hero piece, level of polish or moment of the day, with colors still true to the reference). Without a named style, make them meaningfully different, for example one classic, one modern, one bolder.',
  'Dress for the weather they state or imply (season, place, indoors or outdoors). In heat, use breathable fabrics and skip jackets and heavy layers unless the look says they are carried for the evening; in cold, include real outerwear.',
  'Make each look coherent and wearable as a whole: shoes, layers and fabrics agree with each other, with the weather and with the formality.',
  'Know US dress codes precisely: white tie, black tie, black tie optional, formal, cocktail, semi-formal, business formal, business casual, smart casual, casual.',
  'Know venue rules: golf courses usually require collared shirts and tailored shorts or trousers, no denim; country clubs lean preppy; many tennis clubs require whites; houses of worship and funerals call for modest, dark colors.',
  'Colors: use the client palette closest to the face and their neutrals elsewhere; keep avoid-colors away from the face. A named style\'s signature colors come first (black for rock or metal, navy and white for nautical): keep them, and when one is hard on the client, place it away from the face (trousers, boots, a jacket worn open) or use its most flattering shade near the face. Never add a color just to show off the palette.',
  'Choose cuts that suit their build and height. Never mention weight or body flaws; frame advice positively.',
  'If the client has a taste profile, honor it: never use anything they avoid, and bring in what they love wherever it suits the brief. Translate their taste to the weather rather than ignoring either (a summer version of a leather-and-boots taste: a dark tee, light denim, suede boots). A color they love that is hard on them goes away from the face, and whyItWorks says why. When the brief and their taste conflict (an invitation that requires a tie for someone who avoids ties), the brief wins; say so kindly in a styling tip.',
  'Every garment must be a real, common item a person can find at mainstream US retailers. No brand names and no logos: describe signature pieces generically, e.g. "tortoiseshell keyhole-bridge sunglasses".',
  'The summary, whyItWorks and tips must describe exactly the listed items and colors, never a garment or color that is not in the list.',
  'Write in warm, concise American English, second person.',
].join(' ')

// The taste the stylist designs for: the person's own words plus what their
// feedback taught us (see modules/taste).
export type StylistTaste = {
  statement: string | null
  summary: string | null
  loves: string[]
  avoids: string[]
}

export function describeTaste(taste: StylistTaste | null | undefined) {
  if (!taste || (!taste.statement && taste.loves.length === 0 && taste.avoids.length === 0)) {
    return null
  }

  return [
    'Client taste profile (their own words and what their feedback on past looks taught us):',
    taste.statement ? `In their words: "${taste.statement}"` : null,
    taste.summary ? `Summary: ${taste.summary}` : null,
    taste.loves.length > 0 ? `Loves:\n${taste.loves.map((line) => `- ${line}`).join('\n')}` : null,
    taste.avoids.length > 0 ? `Avoids (never use):\n${taste.avoids.map((line) => `- ${line}`).join('\n')}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function describeClient(avatar: AvatarDocument, taste: StylistTaste | null | undefined) {
  const body = bodyOf(avatar)

  return [
    'Client profile:',
    `- Dresses in: ${body.presentation}`,
    `- Height ${body.heightCm} cm, weight ${body.weightKg} kg, ${body.build} build`,
    describePalette(avatar.colorAnalysis),
    describeTaste(taste),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function buildLookPlanRequest(input: {
  avatar: AvatarDocument
  occasion: string
  notes: string | null
  count: number
  taste?: StylistTaste | null
}) {
  return [
    `Occasion: ${input.occasion}`,
    input.notes ? `Extra notes from the client: ${input.notes}` : null,
    `Design exactly ${input.count} look${input.count > 1 ? 's' : ''}.`,
    '',
    describeClient(input.avatar, input.taste),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

const REMIX_CHANGES: Record<RemixChange, (detail: string | null) => string> = {
  colors: () =>
    'Keep the same kinds of pieces and silhouettes and give it a new color story from their palette; reuse no color from the original except basic neutrals the style needs.',
  season: (detail) =>
    `Adapt it to ${detail ?? 'the opposite season'}: that season's fabrics, layers, footwear and colors, with the same attitude.`,
  dressier: () => 'Take it one clear step dressier, for a nicer venue or the evening, keeping its attitude.',
  casual: () => 'Take it one clear step more casual, for a weekend or daytime plan, keeping its attitude.',
  occasion: (detail) => `Restyle it for this occasion: ${detail ?? 'another plan they might have'}.`,
  surprise: () =>
    'Your call: one meaningful twist that keeps the style, such as a new hero piece, an unexpected color from their palette or a different moment of the day.',
  custom: (detail) => `The client asks: ${detail ?? 'another take on it'}.`,
  fix: (detail) => `The client disliked it. Their feedback: ${detail ?? 'not for them'}.`,
}

// A variant of a look the person liked: same style, one clear change.
export function buildRemixRequest(input: {
  avatar: AvatarDocument
  base: Pick<LookDocument, 'plan' | 'occasion'>
  change: RemixChange
  detail: string | null
  taste?: StylistTaste | null
}) {
  const { plan, occasion } = input.base
  const fixing = input.change === 'fix'

  return [
    fixing
      ? 'Design exactly 1 new look for the same occasion, replacing a look this client disliked.'
      : 'Design exactly 1 look: a variant of a look this client liked.',
    `${fixing ? 'The look they disliked' : 'Original look'}: "${plan.title}" (${plan.vibe}), styled for "${occasion.text}". ${plan.summary}`,
    `Its pieces: ${plan.items.map(describeItem).join('; ')}.`,
    fixing
      ? 'Fix every point of their feedback. Keep only the pieces they liked, and nothing they disliked or anything like it. The new look must still deliver the original occasion and any style they named there.'
      : 'Keep its style DNA (the same aesthetic, attitude and silhouette language) so it reads as a sibling of the original, not a copy. Change at least three pieces unless the change below keeps them.',
    `${fixing ? 'Feedback' : 'Change'}: ${REMIX_CHANGES[input.change](input.detail)}`,
    input.change === 'occasion' || fixing
      ? null
      : `Occasion: the same as the original, "${occasion.text}", unless the change says otherwise.`,
    '',
    describeClient(input.avatar, input.taste),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function buildLookRenderPrompt(plan: LookPlan, occasion: string) {
  const garments = plan.items.map(describeItem).join('; ')

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
  const body = bodyOf(avatar)

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
  const name = item.name.toLowerCase()
  const material = item.material.toLowerCase()
  // "Suede" and "Suede overshirt" would read "suede suede overshirt".
  return `${item.color} ${name.includes(material) ? '' : `${material} `}${name} (${item.fit})`
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
