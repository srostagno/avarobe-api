// Fictional clients for the stylist evals: body and palette only, no photos.
import type { AvatarDocument, ColorAnalysis } from '../../src/types/mongo.js'

const sw = (list: string) =>
  list.split(', ').map((entry) => {
    const [name, hex] = entry.split(' #')
    return { name: name!, hex: `#${hex}` }
  })

function client(
  id: string,
  body: AvatarDocument['body'],
  palette: Omit<ColorAnalysis, 'summary' | 'confidence' | 'photoNote'>,
) {
  return {
    id,
    avatar: {
      body,
      colorAnalysis: { ...palette, summary: '', confidence: 'high', photoNote: null },
    } as unknown as AvatarDocument,
  }
}

export const CLIENTS = {
  coolSummerMan: client('cool-summer-man', { heightCm: 183, weightKg: 81, build: 'average', presentation: 'menswear' }, {
    season: 'Cool Summer',
    undertone: 'cool',
    contrast: 'medium',
    metals: 'silver',
    bestColors: sw('Dusty Rose #C98C9A, Soft Plum #8E6A88, Bluebell #8FA6D8, Periwinkle #A7B3E6, Cornflower #7D98D6, Soft Teal #4F8C95, Sea Glass #8FBDB8, Lavender Gray #B7B0C9, Cool Navy #2F4A6D, Raspberry #A34A6A'),
    neutrals: sw('Soft White #F2F2EE, Cool Taupe #A79C96, Slate Gray #6E7884, Charcoal #3D4248, Ink Navy #1F2E44'),
    avoidColors: sw('Orange #E67E22, Mustard #C9A227, Tomato Red #D83B2D, Olive #808000'),
  }),
  deepAutumnMan: client('deep-autumn-man', { heightCm: 178, weightKg: 82, build: 'athletic', presentation: 'menswear' }, {
    season: 'Deep Autumn',
    undertone: 'warm',
    contrast: 'high',
    metals: 'gold',
    bestColors: sw('Olive #5B5A2C, Rust #9A4A2A, Burnt Orange #B8572A, Deep Teal #1F5C5B, Forest Green #2F4F3A, Mustard #B8912F, Brick Red #8E3B2E, Aubergine #4B2E3F, Deep Turquoise #1D6F72, Tobacco #6B4A2B'),
    neutrals: sw('Espresso #3C2A21, Camel #B08A5B, Chocolate #5A3B2A, Cream #EFE3CB, Khaki #9C8E6A'),
    avoidColors: sw('Icy Pink #F3D9E3, Baby Blue #BFD7EA, Optic White #FFFFFF, Lavender #C9B6E4'),
  }),
  softAutumnWoman: client('soft-autumn-woman', { heightCm: 165, weightKg: 62, build: 'curvy', presentation: 'womenswear' }, {
    season: 'Soft Autumn',
    undertone: 'warm',
    contrast: 'low',
    metals: 'gold',
    bestColors: sw('Sage #9CAF88, Soft Teal #5E8C84, Terracotta #B8674A, Dusty Coral #D08C74, Moss #6F7A4A, Muted Mustard #C2A04E, Salmon #D9957A, Soft Olive #7C7A4E, Mushroom #A89886, Warm Rose #B7786E'),
    neutrals: sw('Oatmeal #E3D7C1, Camel #B99A6B, Chocolate #5A4033, Warm Gray #8E857A, Ivory #F1EADB'),
    avoidColors: sw('Black #101010, Optic White #FFFFFF, Fuchsia #D1307A, Cobalt #1F4FBF'),
  }),
  deepWinterWoman: client('deep-winter-woman', { heightCm: 170, weightKg: 58, build: 'slim', presentation: 'womenswear' }, {
    season: 'Deep Winter',
    undertone: 'cool',
    contrast: 'high',
    metals: 'silver',
    bestColors: sw('True Red #C8102E, Emerald #00785A, Sapphire #1F4E9C, Fuchsia #C2185B, Royal Purple #5B2C83, Icy Pink #F4D7E3, Pine #1E4D3A, Cobalt #1F4FBF, Burgundy #6D1A36, Deep Teal #0F5257'),
    neutrals: sw('Black #101010, Pure White #FFFFFF, Charcoal #36393F, Navy #1B2A4A, Cool Gray #8E949A'),
    avoidColors: sw('Camel #B99A6B, Orange #E67E22, Mustard #C9A227, Warm Beige #D8C3A5'),
  }),
  lightSpringWoman: client('light-spring-woman', { heightCm: 163, weightKg: 88, build: 'plus', presentation: 'womenswear' }, {
    season: 'Light Spring',
    undertone: 'warm',
    contrast: 'low',
    metals: 'gold',
    bestColors: sw('Peach #F4B393, Coral #F08A6B, Warm Pink #F19CA4, Aqua #7FD1C8, Light Turquoise #5BC0BE, Butter Yellow #F6E27F, Mint #A8E0C5, Periwinkle #A7B3E6, Clear Light Red #E5535B, Apricot #F6B26B'),
    neutrals: sw('Ivory #F6F0E1, Light Camel #CFAE82, Warm Gray #A39B90, Soft Navy #3B4A6B, Stone #C9C0B1'),
    avoidColors: sw('Black #101010, Charcoal #36393F, Burgundy #6D1A36, Dark Brown #3B2A20'),
  }),
}

export type ClientId = keyof typeof CLIENTS
