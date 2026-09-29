import type { AvatarBody, HairProfile, HairRecommendation, TasteDocument } from '../../types/mongo.js'

// The Hair studio: a stylist's read of the selfie (face shape, hair type and
// the cuts that suit them), each cut shown on the person as a chest-up
// portrait, and the one they choose put on their avatar.

export const RECOMMENDATION_COUNT = 6

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'length', 'why', 'maintenance', 'stylingMinutes', 'stylistBrief', 'render'],
  properties: {
    name: {
      type: 'string',
      description: 'The cut as a salon would name it, 2 to 5 words, e.g. "Soft shag with curtain bangs". Never a person’s name.',
    },
    length: { type: 'string', enum: ['short', 'medium', 'long'] },
    why: {
      type: 'string',
      description: 'One or two sentences, second person, tying the cut to their face shape, features and hair type.',
    },
    maintenance: { type: 'string', enum: ['low', 'medium', 'high'] },
    stylingMinutes: { type: 'integer', description: 'Daily styling time in minutes, 0 to 45.' },
    stylistBrief: {
      type: 'string',
      description:
        'What to tell their hairstylist, 2 or 3 sentences: where the length falls (in inches), layers, fringe, parting, texture and finish.',
    },
    render: {
      type: 'string',
      description:
        'A precise visual description of the finished cut for an image model, 25 to 60 words: where the length falls, layers, fringe, parting, volume, texture and finish, worked with their own hair texture. Their natural hair color; no color change.',
    },
  },
}

export const hairProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hasFace', 'faceShape', 'faceShapeNote', 'hairType', 'summary', 'flatters', 'avoid', 'recommendations'],
  properties: {
    hasFace: {
      type: 'boolean',
      description: 'False when the photo shows no clear face and hair to read (a hat, heavy blur, no person).',
    },
    faceShape: { type: 'string', enum: ['oval', 'round', 'square', 'heart', 'oblong', 'diamond', 'triangle'] },
    faceShapeNote: {
      type: 'string',
      description:
        'One sentence, second person, on the proportions that make it read that way (forehead, cheekbones, jaw, length), as a fact, never a judgment.',
    },
    hairType: {
      type: 'object',
      additionalProperties: false,
      required: ['texture', 'density', 'currentLength', 'currentCut'],
      properties: {
        texture: { type: 'string', enum: ['straight', 'wavy', 'curly', 'coily'] },
        density: { type: 'string', enum: ['fine', 'medium', 'thick'] },
        currentLength: { type: 'string', enum: ['short', 'medium', 'long'] },
        currentCut: {
          type: 'string',
          description: 'Their haircut as it is now, 3 to 6 words, e.g. "Long layers, middle part".',
        },
      },
    },
    summary: {
      type: 'string',
      description: 'Two short sentences, second person: what their face shape and hair type ask of a haircut.',
    },
    flatters: {
      type: 'array',
      description: 'Exactly 3 principles that flatter them, 4 to 10 words each, e.g. "Volume at the crown for height".',
      items: { type: 'string' },
    },
    avoid: {
      type: 'array',
      description: 'Exactly 2 things to skip, 4 to 10 words each.',
      items: { type: 'string' },
    },
    recommendations: {
      type: 'array',
      description: `Exactly ${RECOMMENDATION_COUNT} haircuts, best first.`,
      items: recommendationSchema,
    },
  },
}

export const HAIR_PROFILE_INSTRUCTIONS = [
  'You are a senior hairstylist who reads faces for a living.',
  'From the selfie, read their face shape from its proportions, their hair texture and density, and their current length and cut.',
  `Then pick ${RECOMMENDATION_COUNT} haircuts that flatter this face and work with this hair, best first. The first one is "their ideal cut": the best balance of flattering, realistic for their hair and easy to love.`,
  'Mix the list: at least two that keep a length close to theirs, two that are a clear change, and one bolder option; vary the maintenance.',
  'Work with their natural texture: a cut that needs a texture they don’t have only if styling gets it there, and say so.',
  'Follow the clothes they shop for: menswear gets men’s cuts (fades, crops, textured tops, flow), womenswear women’s cuts, both a mix.',
  'Keep their natural hair color in every cut; color belongs to their color analysis.',
  'If they told the stylist how they like to look, respect it (for example low maintenance, or never short).',
  'Never comment on attractiveness, age, weight or ethnicity, and never name a real person: describe the cut instead.',
  'Write in plain, warm American English, second person.',
].join(' ')

function describeClient(body: AvatarBody, taste: Pick<TasteDocument, 'statement' | 'summary' | 'loves' | 'avoids'> | null) {
  const wardrobe = {
    menswear: 'They shop menswear.',
    womenswear: 'They shop womenswear.',
    unisex: 'They shop both menswear and womenswear.',
  }[body.presentation]
  const lines = [wardrobe, `They are ${body.heightCm} cm tall.`]

  if (taste?.statement) {
    lines.push(`In their own words: "${taste.statement}".`)
  }

  if (taste?.summary) {
    lines.push(`Their taste: ${taste.summary}`)
  }

  const avoids = (taste?.avoids ?? []).map((note) => note.text).slice(0, 6)

  if (avoids.length > 0) {
    lines.push(`They avoid: ${avoids.join('; ')}.`)
  }

  return lines.join(' ')
}

export function buildHairProfileRequest(body: AvatarBody, taste: Parameters<typeof describeClient>[1]) {
  return `Read this selfie and recommend their haircuts. ${describeClient(body, taste)}`
}

// A haircut they asked for: typed, from a photo of someone else's hair, or both.
export const hairRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['isHaircut', 'name', 'render', 'stylistBrief', 'fit'],
  properties: {
    isHaircut: {
      type: 'boolean',
      description: 'False when the request or photo is not about a haircut or hairstyle (no visible hair, an outfit, a landscape).',
    },
    name: {
      type: 'string',
      description: 'The cut as a salon would name it, 2 to 5 words. Never a person’s name, even if they gave one.',
    },
    render: recommendationSchema.properties.render,
    stylistBrief: recommendationSchema.properties.stylistBrief,
    fit: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'note'],
      properties: {
        verdict: { type: 'string', enum: ['great', 'good', 'tricky'] },
        note: {
          type: 'string',
          description:
            'One or two honest, kind sentences, second person, on how it works with their face shape and hair type; for "tricky", the tweak that makes it work.',
        },
      },
    },
  },
}

export const HAIR_REQUEST_INSTRUCTIONS = [
  'You are a senior hairstylist. Your client wants to try a haircut: they describe it, show a photo of someone else’s hair, or both.',
  'Describe that haircut precisely so it can be shown on your client, adapted realistically to their own hair texture and density.',
  'From a photo, take only the haircut: never describe the person in it.',
  'Keep your client’s natural hair color unless they clearly ask for a color.',
  'Judge honestly how it works with their face shape and hair type, and be kind.',
  'Never name a real person, even if they named one: describe the cut instead.',
  'Write in plain, warm American English, second person.',
].join(' ')

export function buildHairRequest(input: {
  profile: HairProfile | null
  body: AvatarBody
  description: string | null
  hasPhoto: boolean
}) {
  const profile = input.profile
    ? `Their face shape: ${input.profile.faceShape} (${input.profile.faceShapeNote}). Their hair: ${input.profile.hairType.texture}, ${input.profile.hairType.density}, ${input.profile.hairType.currentLength}, now "${input.profile.hairType.currentCut}".`
    : 'Read their face shape and hair from the selfie.'

  return [
    input.hasPhoto
      ? 'The first image is your client’s selfie. The second image is a photo of the haircut they want to try.'
      : 'The image is your client’s selfie.',
    input.description ? `They ask for: "${input.description}".` : null,
    profile,
    `They shop ${input.body.presentation === 'unisex' ? 'both menswear and womenswear' : input.body.presentation}.`,
  ]
    .filter((line): line is string => line !== null)
    .join(' ')
}

const PORTRAIT_FINISH = [
  'Framing: a chest-up portrait from just above the top of the head to mid-chest, the whole length of the hair in frame, facing the camera with the head straight.',
  'They wear a plain oatmeal crew-neck top.',
  'Seamless light warm-grey studio backdrop, soft even daylight, realistic salon portrait photo, no text, no logos.',
]

// One haircut on the person. Images: the full-body avatar, the selfie as a
// close-up of the face, and (from a photo) the haircut they brought.
export function buildHairstylePrompt(input: { name: string; render: string; hasReference: boolean }) {
  return [
    `Image 1 is this person in full body. Image 2 is a close-up of the same face.${input.hasReference ? ' Image 3 is a photo of a haircut they want to try; it shows someone else.' : ''}`,
    'Create a portrait photo of this SAME person with a new haircut: identical face, facial features, skin tone, eye color, facial hair and expression, instantly recognisable.',
    `The new haircut: ${input.name}. ${input.render}`,
    input.hasReference
      ? 'Take only the haircut from image 3 (cut, length, layers, fringe, parting, texture and volume); never take the face, features, skin tone, expression or hair color from image 3.'
      : null,
    'Keep their natural hair color from image 2 unless the haircut above names a color.',
    'The hair looks freshly cut and styled by a professional: realistic strands and texture, a natural hairline, and it suits their real hair density.',
    ...PORTRAIT_FINISH,
  ]
    .filter((line): line is string => line !== null)
    .join(' ')
}

// Puts a haircut on the avatar. Image 1 is the current avatar, image 2 the
// portrait with the new haircut.
export function buildApplyHairPrompt(input: { name: string; render: string }, coherenceRules: string[]) {
  return [
    'Image 1 is this person’s current full-body avatar. Image 2 is a portrait of the same person with their new haircut.',
    `Edit image 1: change ONLY the hair so it is exactly the haircut in image 2 (${input.name}: ${input.render}), with the same cut, length, layers, fringe, parting, volume, texture and color, at the right scale for the full body.`,
    'Keep everything else exactly the same: face, expression, skin tone, facial hair, body, pose, framing, outfit, background and lighting.',
    ...coherenceRules,
    'Realistic photo, no text, no logos.',
  ].join(' ')
}

// The model sometimes returns fewer or more than asked; keep a clean list
// with stable ids ("r1".."r6") the web and the renders refer to.
export function cleanRecommendations(items: Omit<HairRecommendation, 'id'>[]): HairRecommendation[] {
  return items
    .filter((item) => item.name.trim() && item.render.trim())
    .slice(0, RECOMMENDATION_COUNT)
    .map((item, index) => ({
      ...item,
      id: `r${index + 1}`,
      name: item.name.trim(),
      stylingMinutes: Math.max(0, Math.min(45, Math.round(item.stylingMinutes))),
    }))
}
