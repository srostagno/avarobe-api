import type { AvatarDocument, LookDocument, LookFeedback, LookItem, LookPlan, RemixChange } from '../../types/mongo.js'
import { describePalette } from '../avatar/prompts.js'
import { bodyOf } from '../avatar/body.js'
import { describeFeedback } from '../taste/prompts.js'

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
  required: ['asks', 'hardRules', 'styleSignature', 'climate'],
  properties: {
    asks: {
      type: 'array',
      description:
        'Every explicit thing the client asked for, 2 to 6 short phrases close to their words: the event, any style, person, era, music or aesthetic they named, colors or pieces they want or refuse, the season or weather. Only what they wrote in the occasion and notes: never their profile, their taste profile or the number of looks.',
      items: { type: 'string' },
    },
    hardRules: {
      type: 'array',
      description:
        'Every requirement or refusal in the client\'s own words, each as a short rule you can check a look against: from the occasion, their notes and, when restyling, every piece of feedback they gave on this look and the earlier ones for this occasion (a newer word wins over an older one). Garment types ("a dress"), lengths ("floor-length"), necklines, fits, fabrics, details ("no slit"), colors or palette to use or avoid ("no mauve"), pieces to leave out ("no jacket or coat"). They beat the dress code\'s usual norms, the color analysis, the taste profile and your defaults. Empty when they stated none.',
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
        'The weather the looks must handle and what it rules in or out, e.g. "Summer heat outdoors: breathable fabrics and short sleeves, no jackets." or "Not stated, an indoor evening: no outer layer needed."',
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
  'The client\'s own words are hard rules that beat everything else: the dress code\'s usual norms, their color analysis, their taste profile and your own defaults. A floor-length dress they ask for at a cocktail-attire wedding is floor-length (welcome there), never midi, tea or ankle length. When they say which palette or colors suit them, or that a color does not, follow them even if their color analysis disagrees. When they refuse a piece, a fabric, a cut or a color, no look has it or anything of the same kind. Only a venue rule that truly bars something (white at a wedding, a golf club\'s collar rule) can override them; then say so kindly in a tip. Write the lengths, necklines, fabrics and details they asked for into the item\'s name or fit, so the look visibly delivers them.',
  'When they name a style reference (a person, a film, an era, a subculture, a music genre), every look must read unmistakably as that reference: build it from the reference\'s signature garments, colors, fabrics, fits, footwear and accessories, adapted to the occasion and the weather, with at least two signature pieces in every look. A fashion editor should recognize it at a glance. When they name several references (an icon and a music genre, say), blend all of them in every look instead of giving each look one of them.',
  'Music they mention is a style signal too (rock or metal: black, denim, leather, boots; country: denim and western boots; jazz: dark and tailored): show it in every look.',
  'Vary the looks within the brief, never away from it: give different takes on the same reference (another hero piece, level of polish or moment of the day, with colors still true to the reference). Without a named style, make them meaningfully different, for example one classic, one modern, one bolder.',
  'Dress for the weather they state or imply (season, place, indoors or outdoors). In heat, use breathable fabrics and no jackets or heavy layers; in real cold (winter, snow, an outdoor evening in a cold month), include a real coat.',
  'No outer layer by default. Add a jacket, blazer, coat, cardigan, vest, wrap or any other cover-up only when the client asks for one, the weather they state or imply needs it, the dress code calls for it (a suit or sport coat in menswear for formal, cocktail or business dress), or it is the hero of the look (a sharp blazer for work, a leather jacket for a rock look). An evening, a dressy event or an unstated season is no reason to add one: the outfit must be complete without it. When they say no jacket, no layer of any kind.',
  'Make each look coherent and wearable as a whole: shoes, layers and fabrics agree with each other, with the weather and with the formality.',
  'Know US dress codes precisely: white tie, black tie, black tie optional, formal, cocktail, semi-formal, business formal, business casual, smart casual, casual.',
  'Set the formality from the event, not from words in a venue\'s name. A date or a dinner at a nice bar or restaurant, an anniversary dinner or a night out is date-night dressing (polished, relaxed, a little alluring), not cocktail attire, unless they say the place is formal or give a dress code; cocktail attire is for events that ask for it, like a wedding or a party with that dress code. Never dress a date or a party like the office: no suits, pencil skirts, button-up shirts, sheath dresses or tailored trousers with pumps unless they ask.',
  'Dress every client with a current eye, never from a template and never older than they are. No mother-of-the-bride pieces (sheer wraps, shawls, stoles, boleros, shrugs, dusters, cropped evening jackets, embellished flats) unless they ask. A wrap midi dress (in satin or any other fabric) with block-heel ankle-strap sandals and an envelope clutch is a template: do not reach for it. Build each look on a real hero piece for the moment, for example a one-shoulder, off-shoulder or square-neck dress, a slip dress, a sequin or metallic top with a fluid skirt or trousers, a velvet dress in winter, a column gown, a dressy jumpsuit, or dark jeans with a silk top and heeled boots for a date; and vary silhouettes, fabrics, shoes and bags.',
  'Most womenswear clients are women between 35 and 65 who want to look current, polished and attractive. Style them the way a sharp stylist dresses a chic woman of that age today, and avoid the formulas they call frumpy or "grandma": a cardigan over a shell or a twinset, a knit shell with ankle trousers, penny loafers and a structured tote, pleated or tapered ankle trousers, ponte A-line midi skirts, low block-heel pumps, mock-neck or crew-neck knits as the default top, drapey cowl blouses, pearl studs, walking shoes, joggers away from the gym, and head-to-toe muted neutrals. Reach instead for current shapes: full-length straight, wide-leg or barrel trousers and jeans, a blazer worn open over a silk tee or a fine knit, column dressing in one color, a slip or pleated skirt with a sweater, a shirt dress or knit dress with boots, open necklines (V, scoop, square, open collar), modern shoes (pointed or square-toe flats, slingbacks, kitten heels, sleek boots, clean sneakers with polished pieces), and one confident point of interest per look (a clear color, a print, a statement earring, a great bag). That is a range to choose from, not a new uniform: vary the silhouette, shoes and bag from look to look. Trousers and jeans are full length unless they ask for cropped.',
  'Know venue rules: golf courses usually require collared shirts and tailored shorts or trousers, no denim; country clubs lean preppy; many tennis clubs require whites; houses of worship and funerals call for modest, dark colors; wedding guests never wear white, ivory, cream or champagne as a main color.',
  'Colors: use the client palette closest to the face and their neutrals elsewhere; keep avoid-colors away from the face. A named style\'s signature colors come first (black for rock or metal, navy and white for nautical): keep them, and when one is hard on the client, place it away from the face (trousers, boots, a jacket worn open) or use its most flattering shade near the face. Never add a color just to show off the palette.',
  'Give every look at least one clear color from their best colors, in the richest shade of it that still suits them, near the face or as the hero piece; never build a whole look from muted neutrals and dusty shades (sage, mushroom, taupe, oatmeal, dusty blue) unless they ask for a quiet look. Do not soften their palette further: name each color plainly for the shade it is (no "soft", "muted" or "dusty" unless they ask for softer colors) and make colorHex that exact shade, because the picture is drawn from it. When they say colors are too soft, muted, dull or washed out, go clearly richer and more saturated.',
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

// An earlier look in a remix chain (looks/history.ts) and what the person
// said about it.
export type RemixHistoryEntry = {
  plan: Pick<LookPlan, 'title' | 'items'>
  feedback: Pick<LookFeedback, 'rating' | 'aspects' | 'pieces' | 'note'> | null
  // What they asked for when they had this look remixed ("custom").
  asked?: string | null
}

const FIX_RULES = [
  'Their words are hard rules, and they add up: everything they said in the brief, in their notes, in their feedback on this look and on every earlier look for this occasion still applies unless a newer word changes it. They beat the dress code\'s usual norms, the color analysis, the taste profile and your defaults. Write each one in hardRules before designing, and check the look against all of them.',
  'Change what they criticized and keep what they did not. When they name a piece, a color, a length, a fabric, a fit or a detail, change exactly that and keep the rest of the look (its other pieces, colors and silhouette) unless it breaks one of their rules. When they ask for something specific (a dress, an off-shoulder velvet dress), deliver exactly that as the hero of the look.',
  'A piece they marked as disliked without saying why becomes a clearly different piece (another cut, color and fabric; for shoes and cover-ups, another kind), never against what they said they love: a disliked sage peasant blouse from someone who loves peasant blouses becomes a peasant blouse in a color they wear well. Pieces they liked stay.',
  'If they disliked the whole look without words or marked pieces, change its formula (silhouette, hero piece, fabric and accessories), not just its colors, but keep the kind of outfit the occasion and their words call for (a dress stays a dress unless they said otherwise).',
  'Outer layers follow the general rule: drop any jacket, coat, blazer, cardigan or wrap they did not ask for unless the weather needs it or it is the hero of the look, even if they did not mention it, and never add one.',
  'The new look must still deliver the original occasion and any style they named there.',
].join(' ')

function describeHistory(history: RemixHistoryEntry[]) {
  const lines = history
    .map((entry, index) => {
      const said = [
        entry.asked ? `They asked for it: "${entry.asked}".` : null,
        entry.feedback ? describeFeedback(entry.plan, entry.feedback) : null,
      ].filter((line): line is string => line !== null)

      return said.length > 0
        ? `${index + 1}. "${entry.plan.title}" (${entry.plan.items.map(describeItem).join('; ')}): ${said.join(' ')}`
        : null
    })
    .filter((line): line is string => line !== null)

  return lines.length > 0
    ? [
        'Earlier looks for this occasion and what they said about each, oldest first. Every point still applies unless a newer one changes it:',
        ...lines,
      ].join('\n')
    : null
}

// A variant of a look the person liked (same style, one clear change), or a
// fix of one they disliked.
export function buildRemixRequest(input: {
  avatar: AvatarDocument
  base: Pick<LookDocument, 'plan' | 'occasion'> & Partial<Pick<LookDocument, 'remix'>>
  change: RemixChange
  detail: string | null
  taste?: StylistTaste | null
  // Earlier looks this one came from, oldest first (looks/history.ts).
  history?: RemixHistoryEntry[]
}) {
  const { plan, occasion } = input.base
  const fixing = input.change === 'fix'
  const newOccasion = input.change === 'occasion'
  const asks = occasion.asks ?? []
  const askedForBase = input.base.remix?.change === 'custom' ? input.base.remix.detail : null

  return [
    fixing
      ? 'Design exactly 1 new look for the same occasion, replacing a look this client disliked.'
      : 'Design exactly 1 look: a variant of a look this client liked.',
    newOccasion
      ? null
      : [
          `Their brief: "${occasion.text}".`,
          occasion.notes ? `Their notes: "${occasion.notes}".` : null,
          asks.length > 0 ? `What they asked for: ${asks.join('; ')}.` : null,
        ]
          .filter((line): line is string => line !== null)
          .join(' '),
    newOccasion ? null : describeHistory(input.history ?? []),
    `${fixing ? 'The look they disliked' : 'Original look'}: "${plan.title}" (${plan.vibe}), styled for "${occasion.text}". ${plan.summary}`,
    `Its pieces: ${plan.items.map(describeItem).join('; ')}.`,
    askedForBase && !newOccasion ? `They asked for this look: "${askedForBase}".` : null,
    fixing
      ? FIX_RULES
      : 'Keep its style DNA (the same aesthetic, attitude and silhouette language) so it reads as a sibling of the original, not a copy. Change at least three pieces unless the change below keeps them. Everything they asked for in their own words above still applies.',
    `${fixing ? 'Feedback' : 'Change'}: ${REMIX_CHANGES[input.change](input.detail)}`,
    newOccasion || fixing ? null : `Occasion: the same as the original, "${occasion.text}", unless the change says otherwise.`,
    '',
    describeClient(input.avatar, input.taste),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

// For the image model: the exact color of each garment, so the picture
// matches the swatches on the card instead of softening them.
function describeItemForRender(item: LookItem) {
  return `${describeItem(item)} in exactly ${item.colorHex}`
}

export function buildLookRenderPrompt(plan: LookPlan, occasion: string) {
  const garments = plan.items.map(describeItemForRender).join('; ')

  return [
    'Image 1 is this person in full body. Image 2 is a close-up of the same face.',
    'Create a new full-body photo of this SAME person: identical face, facial hair, skin tone, body shape and height proportions, and the same hair (color, highlights, length and texture), neatly styled with natural body.',
    `They are dressed for: ${occasion}.`,
    `Outfit, head to toe: ${garments}.`,
    'Show every garment clearly with realistic fabric, drape and fit on their body, at exactly the length, neckline and cut described, and nothing that is not listed (no extra jacket, layer or wrap).',
    'Colors are exact: render each garment in its listed hex color at its true saturation and brightness, as in a color-accurate product photo. Never mute, soften, fade, desaturate or warm a color, and never let the light or backdrop tint it.',
    'Keep the face fully visible: sunglasses, if part of the outfit, are hooked on the shirt or held in hand, never worn over the eyes.',
    'Pose: standing, facing the camera, relaxed and natural, the whole body visible from head to shoes.',
    'Seamless light neutral-grey studio backdrop, bright even daylight-balanced lighting, crisp realistic fashion lookbook photo, no text, no logos.',
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
