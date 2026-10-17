// Hair presets (Oct 17, 2026; Silvio: "the same in Hair", ready-made styles
// to try on, like the Edits): cuts and colors anyone can try on her, apart
// from her own recommended cuts. No runtime imports, so the thumbnail script
// (design/products/2026-10-presets) reads it as is.
//
// `render` is for the image model only (English, never shown); `brief` is
// what to ask the stylist. A color keeps her cut (`kind: 'color'`); a cut
// keeps her color (hair/prompts.ts).

export type Localized = { en: string; es: string; 'pt-BR': string }

export type HairPresetCollectionId = 'bobs' | 'short' | 'layers' | 'silver' | 'color'

export type HairPresetCollection = { id: HairPresetCollectionId; emoji: string; name: Localized }

export type HairPreset = {
  id: string
  collection: HairPresetCollectionId
  kind: 'cut' | 'color'
  name: Localized
  note: Localized
  brief: Localized
  length: 'short' | 'medium' | 'long' | null
  upkeep: 'low' | 'medium' | 'high'
  render: string
}

export const HAIR_PRESET_COLLECTIONS: HairPresetCollection[] = [
  { id: 'bobs', emoji: '✂️', name: { en: 'Bobs & lobs', es: 'Bobs y lobs', 'pt-BR': 'Bobs e long bobs' } },
  { id: 'layers', emoji: '🌊', name: { en: 'Layers', es: 'Capas', 'pt-BR': 'Camadas' } },
  { id: 'short', emoji: '💫', name: { en: 'Short & chic', es: 'Corto y chic', 'pt-BR': 'Curto e chique' } },
  { id: 'silver', emoji: '🤍', name: { en: 'Silver & gray blending', es: 'Canas y plata', 'pt-BR': 'Grisalhos e prata' } },
  { id: 'color', emoji: '🎨', name: { en: 'Color refresh', es: 'Color nuevo', 'pt-BR': 'Cor nova' } },
]

export const HAIR_PRESETS: HairPreset[] = [
  {
    id: 'collarbone-lob',
    collection: 'bobs',
    kind: 'cut',
    name: { en: 'Collarbone lob', es: 'Lob a la clavícula', 'pt-BR': 'Long bob na clavícula' },
    note: {
      en: 'Grazes the collarbone with soft movement: polished, easy and flattering on almost everyone.',
      es: 'Roza la clavícula con movimiento suave: pulido, fácil y favorecedor para casi todas.',
      'pt-BR': 'Bate na clavícula com movimento suave: elegante, fácil e favorece quase todo mundo.',
    },
    brief: {
      en: 'A long bob that grazes the collarbone, slightly longer in front, with invisible internal layers for movement and softly bevelled ends.',
      es: 'Un bob largo que roce la clavícula, un poco más largo adelante, con capas internas invisibles para dar movimiento y puntas suaves hacia adentro.',
      'pt-BR': 'Um long bob que bata na clavícula, um pouco mais longo na frente, com camadas internas invisíveis para dar movimento e pontas suaves para dentro.',
    },
    length: 'medium',
    upkeep: 'low',
    render:
      'A collarbone-length long bob: the hair ends right at the collarbone, slightly longer at the front than the back, with soft invisible internal layers, gentle movement and softly bevelled ends, a natural side part, smooth and glossy.',
  },
  {
    id: 'french-bob',
    collection: 'bobs',
    kind: 'cut',
    name: { en: 'French bob with soft bangs', es: 'Bob francés con flequillo suave', 'pt-BR': 'Bob francês com franja suave' },
    note: {
      en: 'Chin length with airy bangs: effortless and fresh, and the bangs soften the forehead.',
      es: 'A la altura del mentón con flequillo ligero: sin esfuerzo y fresco, y el flequillo suaviza la frente.',
      'pt-BR': 'Na altura do queixo com franja leve: despojado e fresco, e a franja suaviza a testa.',
    },
    brief: {
      en: 'A chin-length French bob with a little texture at the ends and soft, airy bangs that brush the brows; keep the line soft, not blunt.',
      es: 'Un bob francés a la altura del mentón, con algo de textura en las puntas y un flequillo ligero que roce las cejas; la línea suave, no recta.',
      'pt-BR': 'Um bob francês na altura do queixo, com um pouco de textura nas pontas e franja leve que encoste nas sobrancelhas; a linha suave, não reta.',
    },
    length: 'short',
    upkeep: 'medium',
    render:
      'A chin-length French bob with lightly textured, slightly undone ends and soft, airy, wispy bangs that brush the eyebrows, effortless Parisian volume at the crown.',
  },
  {
    id: 'soft-a-line-bob',
    collection: 'bobs',
    kind: 'cut',
    name: { en: 'Soft A-line bob', es: 'Bob en A suave', 'pt-BR': 'Bob em A suave' },
    note: {
      en: 'Shorter at the back, longer at the front: lifts the jawline and frames the face.',
      es: 'Más corto atrás y más largo adelante: levanta la línea de la mandíbula y enmarca el rostro.',
      'pt-BR': 'Mais curto atrás e mais longo na frente: valoriza o maxilar e emoldura o rosto.',
    },
    brief: {
      en: 'A soft A-line bob, a little shorter at the nape and angled longer toward the front to just below the chin, with light graduation at the back for lift.',
      es: 'Un bob en A suave, un poco más corto en la nuca y más largo hacia adelante hasta justo debajo del mentón, con graduación ligera atrás para dar volumen.',
      'pt-BR': 'Um bob em A suave, um pouco mais curto na nuca e mais longo na frente até logo abaixo do queixo, com leve degradê atrás para dar volume.',
    },
    length: 'short',
    upkeep: 'medium',
    render:
      'A soft A-line bob: slightly shorter at the nape with light stacked graduation for lift at the back, angled longer toward the front where it falls just below the chin, smooth and polished with a soft side part.',
  },
  {
    id: 'face-framing-layers',
    collection: 'layers',
    kind: 'cut',
    name: { en: 'Long face-framing layers', es: 'Capas largas que enmarcan', 'pt-BR': 'Camadas longas emoldurando o rosto' },
    note: {
      en: 'Keeps the length and opens the face with layers that start at the cheekbones.',
      es: 'Mantiene el largo y abre el rostro con capas que empiezan en los pómulos.',
      'pt-BR': 'Mantém o comprimento e abre o rosto com camadas que começam nas maçãs.',
    },
    brief: {
      en: 'Keep the length past the shoulders; add long layers throughout and face-framing pieces starting at the cheekbones, blended so there are no harsh steps.',
      es: 'Mantener el largo bajo los hombros; capas largas en todo el cabello y mechones que enmarquen el rostro desde los pómulos, bien difuminados, sin escalones.',
      'pt-BR': 'Manter o comprimento abaixo dos ombros; camadas longas no cabelo todo e mechas emoldurando o rosto a partir das maçãs, bem esfumadas, sem degraus.',
    },
    length: 'long',
    upkeep: 'low',
    render:
      'Long hair past the shoulders with long blended layers throughout and soft face-framing pieces that start at the cheekbones and sweep away from the face, smooth bouncy ends.',
  },
  {
    id: 'soft-shag-curtain-bangs',
    collection: 'layers',
    kind: 'cut',
    name: { en: 'Soft shag with curtain bangs', es: 'Shag suave con flequillo cortina', 'pt-BR': 'Shag suave com franja cortininha' },
    note: {
      en: 'Shoulder length, airy and textured: lots of movement with little styling.',
      es: 'A los hombros, ligero y con textura: mucho movimiento con poco peinado.',
      'pt-BR': 'Na altura dos ombros, leve e com textura: muito movimento com pouca escova.',
    },
    brief: {
      en: 'A soft, modern shag at the shoulders with choppy layers around the crown and face, and curtain bangs parted in the middle that blend into the layers.',
      es: 'Un shag moderno y suave a los hombros, con capas desfiladas en la coronilla y alrededor del rostro, y flequillo cortina abierto al medio que se funda con las capas.',
      'pt-BR': 'Um shag moderno e suave nos ombros, com camadas desfiadas no topo e ao redor do rosto, e franja cortininha aberta no meio que se mistura às camadas.',
    },
    length: 'medium',
    upkeep: 'medium',
    render:
      'A soft modern shag at shoulder length with airy, choppy layers around the crown and face, lots of texture and movement, and curtain bangs parted in the middle that sweep to both sides and blend into the layers.',
  },
  {
    id: 'bouncy-blowout',
    collection: 'layers',
    kind: 'cut',
    name: { en: 'Bouncy blowout layers', es: 'Capas con brushing de volumen', 'pt-BR': 'Camadas com escova volumosa' },
    note: {
      en: 'Rounded layers styled with a big, glossy blowout: instant polish for events.',
      es: 'Capas redondeadas con un brushing grande y brillante: elegancia inmediata para eventos.',
      'pt-BR': 'Camadas arredondadas com escova grande e brilhante: elegância imediata para eventos.',
    },
    brief: {
      en: 'Rounded "butterfly" layers from the chin down, finished with a round-brush blowout: volume at the roots and ends turned out and under.',
      es: 'Capas redondeadas tipo "mariposa" desde el mentón hacia abajo, terminadas con brushing de cepillo redondo: volumen en la raíz y puntas hacia afuera y adentro.',
      'pt-BR': 'Camadas arredondadas tipo "borboleta" do queixo para baixo, finalizadas com escova redonda: volume na raiz e pontas viradas para fora e para dentro.',
    },
    length: 'long',
    upkeep: 'high',
    render:
      'Rounded butterfly layers starting at the chin, styled with a big glossy round-brush blowout: lifted volume at the roots, bouncy curled-under and flipped-out ends, very polished.',
  },
  {
    id: 'textured-pixie',
    collection: 'short',
    kind: 'cut',
    name: { en: 'Soft textured pixie', es: 'Pixie suave con textura', 'pt-BR': 'Pixie suave com textura' },
    note: {
      en: 'Short and confident, with soft length on top so it never looks severe.',
      es: 'Corto y seguro, con largo suave arriba para que nunca se vea severo.',
      'pt-BR': 'Curto e confiante, com comprimento suave em cima para nunca ficar severo.',
    },
    brief: {
      en: 'A soft pixie: short and tapered at the nape and around the ears, with longer, textured pieces on top and a side-swept fringe.',
      es: 'Un pixie suave: corto y degradado en la nuca y alrededor de las orejas, con mechones más largos y con textura arriba y un flequillo de lado.',
      'pt-BR': 'Um pixie suave: curto e degradê na nuca e ao redor das orelhas, com mechas mais longas e texturizadas em cima e franja de lado.',
    },
    length: 'short',
    upkeep: 'medium',
    render:
      'A soft feminine pixie cut: short and tapered at the nape and around the ears, longer piecey textured layers on top, a soft side-swept fringe, light and airy, never severe.',
  },
  {
    id: 'bixie',
    collection: 'short',
    kind: 'cut',
    name: { en: 'Bixie', es: 'Bixie', 'pt-BR': 'Bixie' },
    note: {
      en: 'Between a bob and a pixie: short, full and very easy to wear.',
      es: 'Entre un bob y un pixie: corto, con cuerpo y muy fácil de llevar.',
      'pt-BR': 'Entre o bob e o pixie: curto, encorpado e muito fácil de usar.',
    },
    brief: {
      en: 'A bixie: ear-to-jaw length, shorter at the back, with soft layers for fullness and a long side fringe.',
      es: 'Un bixie: del largo de la oreja a la mandíbula, más corto atrás, con capas suaves para dar cuerpo y un flequillo largo de lado.',
      'pt-BR': 'Um bixie: do comprimento da orelha ao maxilar, mais curto atrás, com camadas suaves para dar volume e franja longa de lado.',
    },
    length: 'short',
    upkeep: 'medium',
    render:
      'A bixie haircut, between a bob and a pixie: ear-to-jaw length, shorter and tapered at the back, soft full layers on top with volume, and a long side-swept fringe.',
  },
  {
    id: 'gray-blending',
    collection: 'silver',
    kind: 'color',
    name: { en: 'Gray blending', es: 'Canas difuminadas', 'pt-BR': 'Grisalhos esfumados' },
    note: {
      en: 'Fine lowlights and highlights melt the grays in: no regrowth line, fewer salon visits.',
      es: 'Mechas finas claras y oscuras funden las canas: sin raíz marcada y menos visitas a la peluquería.',
      'pt-BR': 'Mechas finas claras e escuras disfarçam os brancos: sem marca de raiz e menos idas ao salão.',
    },
    brief: {
      en: 'Gray blending: fine babylights and soft lowlights woven through so my natural gray melts into a dimensional blend, with a gloss to remove any yellow.',
      es: 'Difuminado de canas: babylights finas y mechas oscuras suaves entretejidas para que mis canas naturales se fundan en un color con dimensión, con un baño de brillo que quite el tono amarillo.',
      'pt-BR': 'Esfumado de grisalhos: babylights finas e mechas escuras suaves para que meus brancos naturais se misturem num tom com dimensão, com um banho de brilho que tire o amarelado.',
    },
    length: null,
    upkeep: 'low',
    render:
      'Gray blending: her natural grays softly melted into a dimensional blend with fine babylights and soft beige-ash lowlights woven through, no visible regrowth line, glossy, natural, salt-and-pepper softened.',
  },
  {
    id: 'silver-embrace',
    collection: 'silver',
    kind: 'color',
    name: { en: 'Luminous silver', es: 'Plata luminosa', 'pt-BR': 'Prata luminosa' },
    note: {
      en: 'Full silver, toned and glossy: striking with the right colors near the face.',
      es: 'Plata completa, matizada y brillante: impactante con los colores adecuados cerca del rostro.',
      'pt-BR': 'Prata total, matizado e brilhante: marcante com as cores certas perto do rosto.',
    },
    brief: {
      en: 'Take me to an even, luminous silver: lift what is still pigmented to blend, then tone with a cool silver gloss (no yellow, no purple cast).',
      es: 'Llevarme a un plata parejo y luminoso: aclarar lo que aún tiene pigmento para igualar y matizar con un baño plata frío (sin amarillo ni tono violeta).',
      'pt-BR': 'Me levar a um prata uniforme e luminoso: clarear o que ainda tem pigmento para igualar e matizar com banho prata frio (sem amarelado nem tom roxo).',
    },
    length: null,
    upkeep: 'medium',
    render: 'Luminous, even silver-white hair, toned cool and glossy, no yellow and no purple cast, bright and healthy-looking.',
  },
  {
    id: 'warm-caramel-balayage',
    collection: 'color',
    kind: 'color',
    name: { en: 'Warm caramel balayage', es: 'Balayage caramelo cálido', 'pt-BR': 'Balayage caramelo quente' },
    note: {
      en: 'Hand-painted caramel ribbons that catch the light and warm up the complexion.',
      es: 'Reflejos caramelo pintados a mano que atrapan la luz y dan calidez al rostro.',
      'pt-BR': 'Reflexos caramelo pintados à mão que pegam a luz e aquecem o rosto.',
    },
    brief: {
      en: 'Soft caramel balayage, hand-painted from mid-lengths to ends with a brighter money piece around the face, keeping my roots natural and blended.',
      es: 'Balayage caramelo suave, pintado a mano de medios a puntas con mechones más claros alrededor del rostro, manteniendo mi raíz natural y difuminada.',
      'pt-BR': 'Balayage caramelo suave, pintado à mão do meio às pontas com mechas mais claras ao redor do rosto, mantendo minha raiz natural e esfumada.',
    },
    length: null,
    upkeep: 'low',
    render:
      'Warm caramel balayage: her base color kept at the roots, soft hand-painted caramel and honey ribbons from mid-lengths to ends, a slightly brighter face-framing money piece, seamless blend, glossy.',
  },
  {
    id: 'rich-chocolate',
    collection: 'color',
    kind: 'color',
    name: { en: 'Rich chocolate brown', es: 'Castaño chocolate intenso', 'pt-BR': 'Castanho chocolate intenso' },
    note: {
      en: 'Deep and glossy, softer than black: covers grays with a warm, expensive shine.',
      es: 'Profundo y brillante, más suave que el negro: cubre las canas con un brillo cálido y caro.',
      'pt-BR': 'Profundo e brilhante, mais suave que o preto: cobre os brancos com brilho quente e sofisticado.',
    },
    brief: {
      en: 'A rich, glossy chocolate brown with subtle warm dimension, softer than black, with full gray coverage.',
      es: 'Un castaño chocolate intenso y brillante, con dimensión cálida sutil, más suave que el negro, que cubra las canas por completo.',
      'pt-BR': 'Um castanho chocolate intenso e brilhante, com dimensão quente sutil, mais suave que o preto, cobrindo os brancos totalmente.',
    },
    length: null,
    upkeep: 'medium',
    render: 'Rich, glossy chocolate-brown hair with subtle warm dimension, softer than black, even and fully colored with a high shine.',
  },
  {
    id: 'copper-glow',
    collection: 'color',
    kind: 'color',
    name: { en: 'Soft copper', es: 'Cobrizo suave', 'pt-BR': 'Acobreado suave' },
    note: {
      en: 'A soft, natural copper that brightens warm skin tones instantly.',
      es: 'Un cobrizo suave y natural que ilumina al instante las pieles cálidas.',
      'pt-BR': 'Um acobreado suave e natural que ilumina na hora as peles quentes.',
    },
    brief: {
      en: 'A soft strawberry-copper, natural rather than bright red, with a little dimension and a copper gloss.',
      es: 'Un cobrizo fresa suave, natural y no rojo intenso, con algo de dimensión y un baño de brillo cobrizo.',
      'pt-BR': 'Um acobreado morango suave, natural e não vermelho forte, com um pouco de dimensão e banho de brilho acobreado.',
    },
    length: null,
    upkeep: 'high',
    render: 'Soft natural strawberry-copper hair, warm and glowing rather than bright red, with gentle dimension and a glossy copper shine.',
  },
  {
    id: 'soft-ash-blonde',
    collection: 'color',
    kind: 'color',
    name: { en: 'Soft beige blonde', es: 'Rubio beige suave', 'pt-BR': 'Loiro bege suave' },
    note: {
      en: 'A creamy beige blonde with soft depth at the roots: bright without looking brassy.',
      es: 'Un rubio beige cremoso con raíz suavemente más oscura: luminoso sin verse anaranjado.',
      'pt-BR': 'Um loiro bege cremoso com raiz suavemente mais escura: iluminado sem ficar alaranjado.',
    },
    brief: {
      en: 'A creamy beige blonde with fine highlights and a soft shadow root so regrowth blends; tone neutral-beige, not ashy-gray and not golden.',
      es: 'Un rubio beige cremoso con mechas finas y raíz difuminada para que el crecimiento no se note; tono beige neutro, ni cenizo grisáceo ni dorado.',
      'pt-BR': 'Um loiro bege cremoso com luzes finas e raiz esfumada para o crescimento não marcar; tom bege neutro, nem acinzentado nem dourado.',
    },
    length: null,
    upkeep: 'medium',
    render: 'Creamy neutral-beige blonde hair with fine highlights and a soft, slightly deeper shadow root, bright and dimensional, never brassy or gray.',
  },
]

export function findHairPreset(id: string) {
  return HAIR_PRESETS.find((preset) => preset.id === id) ?? null
}

// Her best hair colors from the Color Report (hairTest, the shades to
// wear): personal color presets, "my-color-1".."my-color-3".
export const PERSONAL_COLOR_PREFIX = 'my-color-'

export function isColorPreset(id: string | null | undefined) {
  if (!id) {
    return false
  }

  return id.startsWith(PERSONAL_COLOR_PREFIX) || findHairPreset(id)?.kind === 'color'
}
