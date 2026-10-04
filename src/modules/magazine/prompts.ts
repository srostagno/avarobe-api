import type { AvatarDocument, MagazinePlan, Presentation } from '../../types/mongo.js'

// The moments a magazine can show, by how they dress. They pick up to ten;
// the defaults are the first ten.
export const MAGAZINE_MOMENTS: Record<'womenswear' | 'menswear', { id: string; label: string }[]> = {
  womenswear: [
    { id: 'coffee', label: 'The morning coffee run' },
    { id: 'work', label: 'A big day at work' },
    { id: 'brunch', label: 'Weekend brunch' },
    { id: 'date', label: 'Date night' },
    { id: 'wedding', label: 'A wedding' },
    { id: 'market', label: 'Saturday at the farmers market' },
    { id: 'gallery', label: 'A gallery or museum' },
    { id: 'getaway', label: 'A weekend getaway' },
    { id: 'friends', label: 'Drinks with friends' },
    { id: 'holiday', label: 'The holidays' },
    { id: 'vacation', label: 'A summer vacation' },
    { id: 'walk', label: 'A walk in the park' },
    { id: 'dinner', label: 'A special dinner' },
    { id: 'interview', label: 'A job interview' },
    { id: 'family', label: 'A family celebration' },
    { id: 'travel', label: 'A travel day' },
  ],
  menswear: [
    { id: 'coffee', label: 'The morning coffee run' },
    { id: 'work', label: 'A big day at work' },
    { id: 'brunch', label: 'Weekend brunch' },
    { id: 'date', label: 'Date night' },
    { id: 'wedding', label: 'A wedding' },
    { id: 'game', label: 'Game day with friends' },
    { id: 'gallery', label: 'A gallery or museum' },
    { id: 'getaway', label: 'A weekend getaway' },
    { id: 'bar', label: 'Drinks after work' },
    { id: 'holiday', label: 'The holidays' },
    { id: 'vacation', label: 'A summer vacation' },
    { id: 'walk', label: 'A walk in the park' },
    { id: 'dinner', label: 'A special dinner' },
    { id: 'interview', label: 'A job interview' },
    { id: 'family', label: 'A family celebration' },
    { id: 'travel', label: 'A travel day' },
  ],
}

export function magazineMoments(presentation: Presentation | null | undefined) {
  return MAGAZINE_MOMENTS[presentation === 'menswear' ? 'menswear' : 'womenswear']
}

export const MAGAZINE_INSTRUCTIONS = [
  'You are the editor and the stylist of a one-reader fashion magazine: an issue made for one person, about their own life. You plan every look and write every word.',
  'Every outfit is built from their color season: their best colors and neutrals near the face, never their colors to avoid. Every outfit flatters their body using their build and style profile when given; talk about what a cut does for them, never about weight, size or flaws.',
  'Outfits are realistic and wearable, made of real garments a person could buy (no costumes, no brand names), right for the moment, the season and how they dress (womenswear or menswear). Vary the looks: different colors from their palette, silhouettes and formality across the issue.',
  'Each location is vivid and specific but real and photographable (a farmers market with pumpkins, a candlelit wine bar, vineyard rows at golden hour), in the United States unless the moment is travel.',
  'Writing: American English, warm and confident, second person ("you"), like a good magazine, no em dashes. Headlines are short (2 to 6 words). The kicker is a time or context ("Saturday, 9 a.m.", "October", "The big day"). Each look\'s copy is two sentences, 30 to 45 words, saying why this look works on them: a color and a cut. Pieces are four short garment or accessory names, each starting with a capital letter.',
  'Locations, outfits and poses describe the photo in the third person ("they"), never "you".',
  'The letter is from their stylist, 70 to 100 words, starting with their first name and a comma: what their coloring is, which colors make them glow and which to avoid, what silhouettes suit them, and that these are moments from their season.',
  'Cover lines: four, the first one about the looks with their real number ("10 looks for the life you actually live"), one about their best colors, two about specific moments in the issue.',
  'The cover photo shows them in one standout outfit from their palette in a beautiful real place; its pose is relaxed and confident, looking at the camera.',
  'Return JSON only, following the schema.',
].join(' ')

export function buildMagazineRequest(input: {
  firstName: string
  avatar: Pick<AvatarDocument, 'body' | 'presentation' | 'colorAnalysis' | 'styleProfile'>
  moments: string[]
  season: string
}) {
  const colors = input.avatar.colorAnalysis
  const style = input.avatar.styleProfile?.data
  const presentation = input.avatar.body?.presentation ?? input.avatar.presentation ?? 'womenswear'
  const lines = [
    `First name: ${input.firstName || 'friend'}.`,
    `Dresses in: ${presentation}.`,
    input.avatar.body ? `Body: ${input.avatar.body.heightCm} cm, ${input.avatar.body.build} build.` : null,
    colors
      ? [
          `Color season: ${colors.season} (${colors.undertone} undertone, ${colors.contrast} contrast, best metals: ${colors.metals}).`,
          `Best colors: ${colors.bestColors.map((c) => c.name).join(', ')}.`,
          `Neutrals: ${colors.neutrals.map((c) => c.name).join(', ')}.`,
          `Keep away from the face: ${colors.avoidColors.map((c) => c.name).join(', ')}.`,
        ].join(' ')
      : null,
    style ? `Style archetype: ${style.archetype}. ${style.description} Silhouettes: ${style.silhouettes.map((s) => `${s.area}: ${s.advice}`).join('; ')}.` : null,
    `The issue is "${input.season}" for this fall, with ${input.moments.length} looks. The moments, in this order, one look each: ${input.moments.map((m, i) => `${i + 1}. ${m}`).join(' ')}`,
  ]

  return lines.filter(Boolean).join('\n')
}

const shot = {
  type: 'object',
  additionalProperties: false,
  required: ['location', 'outfit', 'pose'],
  properties: {
    location: { type: 'string', description: 'The place, specific and photographable, with what is softly out of focus behind them.' },
    outfit: { type: 'string', description: 'Every garment, shoe and accessory with its color and cut.' },
    pose: { type: 'string', description: 'What they are doing, in the third person, natural, looking at the camera, the whole outfit visible.' },
  },
}

export function magazineSchema(count: number) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['theme', 'coverLines', 'letter', 'archetype', 'shape', 'cover', 'looks'],
    properties: {
      theme: { type: 'string', description: 'The issue name, e.g. "The Soft Autumn Issue".' },
      coverLines: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
      letter: { type: 'string' },
      archetype: { type: 'string', description: 'Their style in two or three words, e.g. "Relaxed Classic".' },
      shape: { type: 'string', description: 'What flatters them in under ten words, e.g. "Defined waists, V-necks and soft midi lengths".' },
      cover: shot,
      looks: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kicker', 'headline', 'copy', 'pieces', 'location', 'outfit', 'pose'],
          properties: {
            kicker: { type: 'string' },
            headline: { type: 'string' },
            copy: { type: 'string' },
            pieces: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
            ...shot.properties,
          },
        },
      },
    },
  }
}

// One photo of the magazine: their avatar (image 1) and face (image 2) in
// the outfit, on location, shot like a lifestyle editorial. The cover leaves
// the top of the frame open for the masthead.
export function buildMagazinePhotoPrompt(input: { location: string; outfit: string; pose: string }, options: { cover?: boolean } = {}) {
  return [
    'Image 1 is this person in full body; image 2 is their face. Create a new photograph of this SAME person: the identical face and features from image 2, the same hair, skin tone, body shape, height and age as image 1. It must be unmistakably them.',
    `Setting: ${input.location}.`,
    `They wear ${input.outfit}.`,
    `Pose: ${input.pose}.`,
    options.cover
      ? 'Framing: a magazine cover. They fill the lower two thirds of the tall frame, the top of their head about a third of the way down; the top third is open background (sky, trees, building tops) with nothing important in it, for the masthead.'
      : 'The whole outfit is visible from head to feet.',
    'Style: a real lifestyle fashion editorial for a magazine, natural light, 50mm lens, true-to-life skin texture, the clothes fit naturally and look like real garments from real stores.',
    'Realistic photograph. No text, no logos, no watermark, no other person in focus.',
  ].join(' ')
}

export type { MagazinePlan }
