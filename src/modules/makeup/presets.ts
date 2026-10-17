// Makeup presets (Oct 17, 2026; Silvio: "Face should let you try different
// makeups, like the Try On, with several ready-made presets: the Edits but
// for makeup"). Collections like the Edits; a new one is a new drop. No
// runtime imports, so the thumbnail script (design/products/2026-10-presets)
// reads it as is.
//
// `render` is for the image model only (English, never shown). `steps` is
// how to do it at home, shown with Pro. Swatches are what the card shows
// (lips, cheeks, eyes).

export type Localized = { en: string; es: string; 'pt-BR': string }

export type MakeupCollectionId = 'essentials' | 'evening' | 'fall-2026'

export type MakeupCollection = {
  id: MakeupCollectionId
  emoji: string
  name: Localized
  // 'YYYY-MM-DD': a seasonal drop, "New" for 7 days after it.
  droppedAt: string | null
}

export type MakeupPreset = {
  id: string
  collection: MakeupCollectionId
  name: Localized
  note: Localized
  intensity: 'light' | 'medium' | 'bold'
  swatches: { lips: string; cheeks: string; eyes: string }
  render: string
  steps: Localized[]
}

export const MAKEUP_COLLECTIONS: MakeupCollection[] = [
  { id: 'fall-2026', emoji: '🍂', name: { en: 'Fall 2026', es: 'Otoño 2026', 'pt-BR': 'Outono 2026' }, droppedAt: '2026-10-17' },
  { id: 'essentials', emoji: '🌿', name: { en: 'Everyday essentials', es: 'Básicos del día', 'pt-BR': 'Básicos do dia a dia' }, droppedAt: null },
  { id: 'evening', emoji: '✨', name: { en: 'Evening', es: 'Noche', 'pt-BR': 'Noite' }, droppedAt: null },
]

export const MAKEUP_PRESETS: MakeupPreset[] = [
  {
    id: 'fresh-everyday',
    collection: 'essentials',
    name: { en: 'Fresh everyday', es: 'Fresco de todos los días', 'pt-BR': 'Fresco do dia a dia' },
    note: {
      en: 'Even skin, a touch of blush and a rosy balm: rested and like yourself, in five minutes.',
      es: 'Piel pareja, un toque de rubor y un bálsamo rosado: descansada y tú misma, en cinco minutos.',
      'pt-BR': 'Pele uniforme, um toque de blush e um bálsamo rosado: descansada e você mesma, em cinco minutos.',
    },
    intensity: 'light',
    swatches: { lips: '#C97B7B', cheeks: '#E3A08F', eyes: '#B49A86' },
    render:
      'Fresh everyday makeup: a sheer, skin-like tint that evens the tone while every freckle and line still shows, a soft peach-rose cream blush high on the cheeks, groomed natural brows, one coat of brown mascara, a sheer rosy lip balm.',
    steps: [
      {
        en: 'A sheer tint or skin tint only where you need it, blended with fingers.',
        es: 'Un tinte ligero solo donde lo necesites, difuminado con los dedos.',
        'pt-BR': 'Uma base leve só onde precisar, espalhada com os dedos.',
      },
      {
        en: 'Cream blush on the top of the cheeks, swept up toward the temples.',
        es: 'Rubor en crema en la parte alta de las mejillas, hacia las sienes.',
        'pt-BR': 'Blush em creme no alto das maçãs, puxando para as têmporas.',
      },
      {
        en: 'Brush brows up with a clear gel, one coat of brown mascara.',
        es: 'Peina las cejas hacia arriba con gel transparente y una capa de máscara marrón.',
        'pt-BR': 'Penteie as sobrancelhas para cima com gel incolor e uma camada de rímel marrom.',
      },
      { en: 'Finish with a rosy tinted balm.', es: 'Termina con un bálsamo con color rosado.', 'pt-BR': 'Finalize com um bálsamo rosado com cor.' },
    ],
  },
  {
    id: 'no-makeup',
    collection: 'essentials',
    name: { en: 'No-makeup makeup', es: 'Maquillaje sin maquillaje', 'pt-BR': 'Maquiagem sem maquiagem' },
    note: {
      en: 'You, on a very good day: concealer where it counts, defined brows and lashes, a lip like your own.',
      es: 'Tú en un muy buen día: corrector donde importa, cejas y pestañas definidas y labios como los tuyos.',
      'pt-BR': 'Você num dia ótimo: corretivo onde importa, sobrancelhas e cílios definidos e boca como a sua.',
    },
    intensity: 'light',
    swatches: { lips: '#B98577', cheeks: '#D9A28E', eyes: '#9C8574' },
    render:
      'No-makeup makeup: only a little concealer under the eyes and around the nose, softly filled natural brows, curled lashes with a thin coat of mascara, a my-lips-but-better nude-rose lip, natural satin skin with real texture.',
    steps: [
      {
        en: 'A dot of concealer in the inner corners of the eyes and around the nose, pressed in.',
        es: 'Un punto de corrector en el lagrimal y alrededor de la nariz, presionado con el dedo.',
        'pt-BR': 'Um ponto de corretivo no canto interno dos olhos e ao redor do nariz, batido com o dedo.',
      },
      {
        en: 'Fill sparse spots in the brows with light strokes the color of your hair.',
        es: 'Rellena las zonas ralas de las cejas con trazos finos del color de tu cabello.',
        'pt-BR': 'Preencha as falhas das sobrancelhas com traços finos da cor do seu cabelo.',
      },
      { en: 'Curl lashes, one thin coat of mascara.', es: 'Riza las pestañas y aplica una capa fina de máscara.', 'pt-BR': 'Curve os cílios e passe uma camada fina de rímel.' },
      {
        en: 'A lipstick one shade deeper than your lips, dabbed on.',
        es: 'Un labial un tono más profundo que tus labios, aplicado a toques.',
        'pt-BR': 'Um batom um tom mais profundo que sua boca, aplicado em batidinhas.',
      },
    ],
  },
  {
    id: 'soft-glow',
    collection: 'essentials',
    name: { en: 'Soft glow', es: 'Brillo suave', 'pt-BR': 'Glow suave' },
    note: {
      en: 'Luminous skin, cream blush and a glossy lip: light reflects where the face needs lift.',
      es: 'Piel luminosa, rubor en crema y labios brillantes: la luz se refleja donde el rostro necesita levantarse.',
      'pt-BR': 'Pele luminosa, blush em creme e boca brilhante: a luz reflete onde o rosto precisa de lifting.',
    },
    intensity: 'light',
    swatches: { lips: '#D08A86', cheeks: '#E79A8C', eyes: '#C9A88E' },
    render:
      'Soft glow makeup: luminous satin skin with a subtle liquid highlighter on the tops of the cheekbones and the brow bone, a dewy coral-rose cream blush, a wash of champagne shimmer on the lids, brown mascara, a glossy rose-pink lip.',
    steps: [
      {
        en: 'A drop of liquid highlighter on the top of the cheekbones, never under the eyes.',
        es: 'Una gota de iluminador líquido en lo alto de los pómulos, nunca debajo de los ojos.',
        'pt-BR': 'Uma gota de iluminador líquido no alto das maçãs, nunca embaixo dos olhos.',
      },
      {
        en: 'Cream blush tapped over it so they melt together.',
        es: 'Rubor en crema encima, a toques, para que se fundan.',
        'pt-BR': 'Blush em creme por cima, em batidinhas, para se fundirem.',
      },
      {
        en: 'Champagne shimmer on the center of the lid with a finger.',
        es: 'Sombra champaña brillante en el centro del párpado con el dedo.',
        'pt-BR': 'Sombra champanhe cintilante no centro da pálpebra com o dedo.',
      },
      { en: 'A rosy gloss on the center of the lips.', es: 'Un gloss rosado en el centro de los labios.', 'pt-BR': 'Um gloss rosado no centro dos lábios.' },
    ],
  },
  {
    id: 'polished-day',
    collection: 'essentials',
    name: { en: 'Polished day', es: 'Día impecable', 'pt-BR': 'Dia impecável' },
    note: {
      en: 'Defined eyes, sculpted cheeks and a rose lip: put-together for work and meetings.',
      es: 'Ojos definidos, mejillas esculpidas y labios rosa: arreglada para el trabajo y reuniones.',
      'pt-BR': 'Olhos definidos, maçãs esculpidas e boca rosada: arrumada para trabalho e reuniões.',
    },
    intensity: 'medium',
    swatches: { lips: '#B5646E', cheeks: '#C98B84', eyes: '#7E6656' },
    render:
      'Polished day makeup: even, natural satin skin, a soft taupe-brown shadow in the crease, a thin smudged brown liner along the upper lashes, defined lashes, filled and shaped brows, a soft rose blush with a hint of contour under the cheekbones, a satin rose lipstick.',
    steps: [
      {
        en: 'Taupe shadow in the crease, blended up so it lifts the eye.',
        es: 'Sombra topo en el pliegue, difuminada hacia arriba para levantar el ojo.',
        'pt-BR': 'Sombra taupe no côncavo, esfumada para cima para levantar o olhar.',
      },
      {
        en: 'A brown pencil pressed into the upper lash line and smudged.',
        es: 'Un lápiz marrón pegado a las pestañas de arriba, difuminado.',
        'pt-BR': 'Um lápis marrom rente aos cílios de cima, esfumado.',
      },
      {
        en: 'Rose blush on the cheekbones, a soft contour just below.',
        es: 'Rubor rosa en los pómulos y un contorno suave justo debajo.',
        'pt-BR': 'Blush rosa nas maçãs e um contorno suave logo abaixo.',
      },
      { en: 'A satin rose lipstick, blotted once.', es: 'Un labial rosa satinado, secado una vez con papel.', 'pt-BR': 'Um batom rosa acetinado, retirando o excesso uma vez.' },
    ],
  },
  {
    id: 'soft-glam',
    collection: 'evening',
    name: { en: 'Soft glam', es: 'Glam suave', 'pt-BR': 'Glam suave' },
    note: {
      en: 'Warm bronze eyes, fluttery lashes and a nude-rose lip: glamorous, still soft.',
      es: 'Ojos bronce cálidos, pestañas con volumen y labios nude rosado: glamorosa, pero suave.',
      'pt-BR': 'Olhos bronze quentes, cílios volumosos e boca nude rosada: glamourosa, mas suave.',
    },
    intensity: 'medium',
    swatches: { lips: '#B07A72', cheeks: '#C98E7E', eyes: '#8A5E45' },
    render:
      'Soft glam evening makeup: warm bronze and soft brown shadow blended across the lid and crease with a satin champagne highlight on the center of the lid, a soft brown liner wing, full fluttery lashes, sculpted cheeks with a warm rose blush, a nude-rose satin lip, radiant but natural skin.',
    steps: [
      {
        en: 'Soft brown in the crease, bronze over the lid, blended with no edges.',
        es: 'Marrón suave en el pliegue y bronce en el párpado, difuminado sin bordes.',
        'pt-BR': 'Marrom suave no côncavo e bronze na pálpebra, esfumado sem bordas.',
      },
      {
        en: 'Champagne in the center of the lid to open the eye.',
        es: 'Champaña en el centro del párpado para abrir la mirada.',
        'pt-BR': 'Champanhe no centro da pálpebra para abrir o olhar.',
      },
      {
        en: 'Two coats of volumizing mascara, or individual lashes at the outer corners.',
        es: 'Dos capas de máscara de volumen, o pestañas individuales en las esquinas.',
        'pt-BR': 'Duas camadas de rímel de volume, ou cílios individuais nos cantos externos.',
      },
      {
        en: 'Line and fill the lips in a nude-rose, a touch of gloss in the center.',
        es: 'Delinea y rellena los labios en nude rosado, con un toque de gloss al centro.',
        'pt-BR': 'Contorne e preencha a boca com nude rosado, um toque de gloss no centro.',
      },
    ],
  },
  {
    id: 'classic-red',
    collection: 'evening',
    name: { en: 'Classic red lip', es: 'Labios rojos clásicos', 'pt-BR': 'Batom vermelho clássico' },
    note: {
      en: 'Clean skin, groomed brows and the perfect red: timeless, and it brightens the whole face.',
      es: 'Piel limpia, cejas peinadas y el rojo perfecto: atemporal, e ilumina todo el rostro.',
      'pt-BR': 'Pele limpa, sobrancelhas penteadas e o vermelho perfeito: atemporal, e ilumina o rosto todo.',
    },
    intensity: 'bold',
    swatches: { lips: '#A8232E', cheeks: '#D9988A', eyes: '#A08A7A' },
    render:
      'Classic red lip makeup: a precisely lined true red satin lipstick, clean even skin with real texture, groomed brows, softly defined lashes with black mascara, a very light neutral lid and a hint of soft blush, everything else minimal so the red stands out.',
    steps: [
      {
        en: 'Keep the eyes simple: a neutral lid and mascara.',
        es: 'Ojos simples: párpado neutro y máscara.',
        'pt-BR': 'Olhos simples: pálpebra neutra e rímel.',
      },
      {
        en: 'Line the lips with a red pencil, slightly softening the corners.',
        es: 'Delinea los labios con un lápiz rojo, suavizando un poco las comisuras.',
        'pt-BR': 'Contorne a boca com lápis vermelho, suavizando um pouco os cantos.',
      },
      {
        en: 'Fill with red lipstick, blot, apply a second coat.',
        es: 'Rellena con labial rojo, seca con papel y aplica una segunda capa.',
        'pt-BR': 'Preencha com batom vermelho, retire o excesso e passe uma segunda camada.',
      },
      {
        en: 'Clean the edge with a little concealer on a flat brush.',
        es: 'Limpia el borde con un poco de corrector en un pincel plano.',
        'pt-BR': 'Limpe a borda com um pouco de corretivo num pincel chato.',
      },
    ],
  },
  {
    id: 'soft-smoky',
    collection: 'evening',
    name: { en: 'Soft smoky eye', es: 'Ojos ahumados suaves', 'pt-BR': 'Olho esfumado suave' },
    note: {
      en: 'Smoky in taupe and charcoal, never heavy: deep eyes with a soft lip.',
      es: 'Ahumado en topo y carbón, nunca pesado: mirada profunda con labios suaves.',
      'pt-BR': 'Esfumado em taupe e grafite, nunca pesado: olhar profundo com boca suave.',
    },
    intensity: 'bold',
    swatches: { lips: '#B88A80', cheeks: '#C99A8E', eyes: '#4E4A4F' },
    render:
      'Soft smoky eye makeup: a diffused charcoal-taupe smoky shadow around the upper lid, smudged softly under the lower lash line, smoked-out dark liner, full black lashes, a soft pink-beige lip and a soft neutral blush, even skin with real texture.',
    steps: [
      {
        en: 'A charcoal pencil along the upper lash line, smudged up with a brush.',
        es: 'Un lápiz carbón pegado a las pestañas de arriba, difuminado hacia arriba con un pincel.',
        'pt-BR': 'Um lápis grafite rente aos cílios de cima, esfumado para cima com pincel.',
      },
      {
        en: 'Taupe over it into the crease; keep the edges soft.',
        es: 'Topo encima y hacia el pliegue; los bordes siempre suaves.',
        'pt-BR': 'Taupe por cima até o côncavo; as bordas sempre suaves.',
      },
      {
        en: 'A little of the same shadow under the outer lower lashes.',
        es: 'Un poco de la misma sombra bajo las pestañas inferiores, en la esquina.',
        'pt-BR': 'Um pouco da mesma sombra sob os cílios inferiores, no canto externo.',
      },
      { en: 'A soft pink-beige lip to balance.', es: 'Labios rosa beige suaves para equilibrar.', 'pt-BR': 'Boca rosa bege suave para equilibrar.' },
    ],
  },
  {
    id: 'winged-liner',
    collection: 'evening',
    name: { en: 'Soft winged liner', es: 'Delineado de ojo de gato suave', 'pt-BR': 'Delineado gatinho suave' },
    note: {
      en: 'A short, lifted wing and a nude lip: lifts the outer corner of the eye.',
      es: 'Un delineado corto y elevado con labios nude: levanta la esquina del ojo.',
      'pt-BR': 'Um delineado curto e levantado com boca nude: levanta o canto externo do olho.',
    },
    intensity: 'medium',
    swatches: { lips: '#B98478', cheeks: '#D3A08F', eyes: '#2E2A2C' },
    render:
      'Soft winged liner makeup: a fine, short, lifted black-brown liner wing that follows the lower lash line upward, a neutral matte lid, defined lashes, groomed brows, soft peach blush, a nude satin lip, even skin with real texture.',
    steps: [
      {
        en: 'Find the wing: follow the line of the lower lashes toward the end of the brow.',
        es: 'Encuentra el ángulo: sigue la línea de las pestañas inferiores hacia el final de la ceja.',
        'pt-BR': 'Ache o ângulo: siga a linha dos cílios inferiores em direção ao fim da sobrancelha.',
      },
      {
        en: 'Draw a short flick, then connect it to the lash line, thin at the inner corner.',
        es: 'Traza una línea corta y únela a las pestañas, fina en el lagrimal.',
        'pt-BR': 'Faça um traço curto e ligue aos cílios, fino no canto interno.',
      },
      {
        en: 'Keep it short: on hooded lids, draw it with the eye open.',
        es: 'Mantenlo corto: en párpados caídos, trázalo con el ojo abierto.',
        'pt-BR': 'Mantenha curto: em pálpebras caídas, faça com o olho aberto.',
      },
      { en: 'A nude satin lip.', es: 'Labios nude satinados.', 'pt-BR': 'Boca nude acetinada.' },
    ],
  },
  {
    id: 'berry-stain',
    collection: 'fall-2026',
    name: { en: 'Berry stain', es: 'Tinte de frutos rojos', 'pt-BR': 'Tinta de frutas vermelhas' },
    note: {
      en: "Fall's easiest update: a blurred berry lip and a matching flush on the cheeks.",
      es: 'El cambio más fácil del otoño: labios bayas difuminados y un rubor a juego en las mejillas.',
      'pt-BR': 'A mudança mais fácil do outono: boca frutas vermelhas esfumada e blush combinando nas maçãs.',
    },
    intensity: 'medium',
    swatches: { lips: '#8E2F4E', cheeks: '#B85C6E', eyes: '#8C6F64' },
    render:
      'Berry stain makeup: a soft-focus blurred berry lip stain, deeper in the center and diffused at the edges, a matching sheer berry flush on the cheeks, a wash of soft mauve-brown on the lids, mascara, groomed brows, natural skin with real texture.',
    steps: [
      {
        en: 'Tap a berry lipstick or stain on the center of the lips and blur it out with a finger.',
        es: 'Aplica un labial o tinte bayas al centro de los labios y difumínalo hacia afuera con el dedo.',
        'pt-BR': 'Bata um batom ou tinta frutas vermelhas no centro da boca e esfume para fora com o dedo.',
      },
      {
        en: 'Use the same color on the cheeks, sheer.',
        es: 'Usa el mismo color en las mejillas, muy ligero.',
        'pt-BR': 'Use a mesma cor nas maçãs, bem leve.',
      },
      { en: 'A wash of mauve-brown on the lids.', es: 'Un velo de malva amarronado en los párpados.', 'pt-BR': 'Um véu de malva amarronado nas pálpebras.' },
    ],
  },
  {
    id: 'bronze-glow',
    collection: 'fall-2026',
    name: { en: 'Copper & bronze', es: 'Cobre y bronce', 'pt-BR': 'Cobre e bronze' },
    note: {
      en: 'Copper eyes and bronzed warmth: it makes green, hazel and brown eyes glow.',
      es: 'Ojos cobre y calidez bronceada: hace brillar los ojos verdes, avellana y marrones.',
      'pt-BR': 'Olhos cobre e calor bronzeado: faz brilhar olhos verdes, mel e castanhos.',
    },
    intensity: 'medium',
    swatches: { lips: '#A8664F', cheeks: '#C47E5E', eyes: '#A65D34' },
    render:
      'Copper and bronze makeup: a metallic copper shadow across the lids blended into a warm brown crease, a soft bronze under the lower lashes, brown mascara, a warm bronzer and terracotta blush on the cheeks, a warm terracotta-nude lip, glowing natural skin.',
    steps: [
      {
        en: 'Warm brown in the crease, then copper on the lid with a damp brush for shine.',
        es: 'Marrón cálido en el pliegue y luego cobre en el párpado con un pincel húmedo para que brille.',
        'pt-BR': 'Marrom quente no côncavo e depois cobre na pálpebra com pincel úmido para brilhar.',
      },
      {
        en: 'A touch of the copper under the outer lower lashes.',
        es: 'Un toque del cobre bajo las pestañas inferiores, en la esquina.',
        'pt-BR': 'Um toque do cobre sob os cílios inferiores, no canto externo.',
      },
      {
        en: 'Bronzer where the sun hits, terracotta blush on top.',
        es: 'Bronceador donde da el sol y rubor terracota encima.',
        'pt-BR': 'Bronzer onde o sol bate e blush terracota por cima.',
      },
      { en: 'A terracotta-nude lip.', es: 'Labios nude terracota.', 'pt-BR': 'Boca nude terracota.' },
    ],
  },
  {
    id: 'plum-evening',
    collection: 'fall-2026',
    name: { en: 'Plum evening', es: 'Noche ciruela', 'pt-BR': 'Noite ameixa' },
    note: {
      en: 'A rich plum lip with soft smoky lids: elegant for fall dinners and parties.',
      es: 'Labios ciruela intensos con párpados ahumados suaves: elegante para cenas y fiestas de otoño.',
      'pt-BR': 'Boca ameixa intensa com pálpebras esfumadas suaves: elegante para jantares e festas de outono.',
    },
    intensity: 'bold',
    swatches: { lips: '#6E2A47', cheeks: '#A8606E', eyes: '#5E4A5A' },
    render:
      'Plum evening makeup: a rich satin plum lipstick, precisely lined, soft smoky plum-brown shadow on the lids diffused into the crease, defined black lashes, a soft mauve blush, groomed brows, even skin with real texture.',
    steps: [
      {
        en: 'Plum-brown shadow on the lid, blended up and out.',
        es: 'Sombra ciruela amarronada en el párpado, difuminada hacia arriba y afuera.',
        'pt-BR': 'Sombra ameixa amarronada na pálpebra, esfumada para cima e para fora.',
      },
      { en: 'Black mascara, two coats.', es: 'Máscara negra, dos capas.', 'pt-BR': 'Rímel preto, duas camadas.' },
      {
        en: 'Line and fill the lips in plum; blot and reapply so it lasts.',
        es: 'Delinea y rellena los labios en ciruela; seca y vuelve a aplicar para que dure.',
        'pt-BR': 'Contorne e preencha a boca em ameixa; retire o excesso e reaplique para durar.',
      },
    ],
  },
  {
    id: 'wedding-guest',
    collection: 'fall-2026',
    name: { en: 'Fall wedding guest', es: 'Invitada de boda en otoño', 'pt-BR': 'Convidada de casamento no outono' },
    note: {
      en: 'Luminous skin, champagne lids and a rose-mauve lip that lasts through the photos.',
      es: 'Piel luminosa, párpados champaña y labios rosa malva que duran todas las fotos.',
      'pt-BR': 'Pele luminosa, pálpebras champanhe e boca rosa malva que dura em todas as fotos.',
    },
    intensity: 'medium',
    swatches: { lips: '#A0616B', cheeks: '#CF8F8A', eyes: '#C7A27E' },
    render:
      'Fall wedding guest makeup: luminous long-wear skin with real texture, a champagne-gold shimmer on the lids with a soft taupe crease, a fine brown liner, full lashes, a rosy blush with a subtle highlight on the cheekbones, a satin rose-mauve lipstick.',
    steps: [
      {
        en: 'Prime the lids, then champagne shimmer over a taupe crease.',
        es: 'Prepara los párpados y aplica champaña brillante sobre un pliegue topo.',
        'pt-BR': 'Prepare as pálpebras e aplique champanhe cintilante sobre um côncavo taupe.',
      },
      {
        en: 'Fine brown liner and full lashes for the photos.',
        es: 'Delineado marrón fino y pestañas con volumen para las fotos.',
        'pt-BR': 'Delineado marrom fino e cílios volumosos para as fotos.',
      },
      {
        en: 'Rose blush, a touch of highlighter on top of the cheekbones.',
        es: 'Rubor rosa y un toque de iluminador en lo alto de los pómulos.',
        'pt-BR': 'Blush rosa e um toque de iluminador no alto das maçãs.',
      },
      {
        en: 'A long-wear rose-mauve lipstick; carry it for touch-ups.',
        es: 'Un labial rosa malva de larga duración; llévalo para retocar.',
        'pt-BR': 'Um batom rosa malva de longa duração; leve para retocar.',
      },
    ],
  },
]

export function findMakeupPreset(id: string) {
  return MAKEUP_PRESETS.find((preset) => preset.id === id) ?? null
}
