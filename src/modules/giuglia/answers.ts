import type { Locale } from '../../utils/locale.js'

// Giuglia in the app (Nov 2026, growth E-1102-giuglia1): the doubts that stop
// a purchase between seeing the colors and paying (the study's held_back:
// price 44 %, "later" 23 %, accuracy 8 %), answered from the person's own
// result. Part 1 answers from fixed, honest copy; only the topic is kept.
export const GIUGLIA_TOPICS = ['price', 'includes', 'accuracy', 'later', 'other'] as const
export type GiugliaTopic = (typeof GIUGLIA_TOPICS)[number]

export const GIUGLIA_PLACEMENTS = ['results', 'checkout'] as const
export type GiugliaPlacement = (typeof GIUGLIA_PLACEMENTS)[number]

export type GiugliaContext = {
  // In the reader's language ("Outono Suave").
  season: string
  confidence: 'low' | 'medium' | 'high'
  // Formatted in the region's currency ("R$ 27,90").
  colorPrice: string
  proMonthlyPrice: string
  // Days of Pro that come with the Color Advisor today, if offered to her.
  colorProDays: number | null
  ownsColorAdvisor: boolean
  refundDays: number
}

export type GiugliaAnswer = { topic: GiugliaTopic; text: string; action: 'checkout' | 'studio' | 'email' | null }

type Copy = {
  disclosure: string
  price: (c: GiugliaContext) => string
  includes: (c: GiugliaContext) => string
  owned: (c: GiugliaContext) => string
  accuracy: (c: GiugliaContext) => string
  later: (c: GiugliaContext) => string
  other: string
}

const CONFIDENCE: Record<Locale, Record<GiugliaContext['confidence'], string>> = {
  en: { high: 'clear', medium: 'good', low: 'uncertain' },
  es: { high: 'clara', medium: 'buena', low: 'dudosa' },
  'pt-BR': { high: 'clara', medium: 'boa', low: 'incerta' },
}

const COPY: Record<Locale, Copy> = {
  en: {
    disclosure: "I'm Giuglia, Avarobe's style adviser. I'm an AI assistant; for a person, write to hello@avarobe.com.",
    price: (c) =>
      `The Color Advisor is ${c.colorPrice}, once, and it stays yours. ` +
      (c.colorProDays ? `Today it also brings ${c.colorProDays} days of Pro; Pro renews at ${c.proMonthlyPrice} a month unless you cancel before. ` : '') +
      `An in-person color analysis usually costs many times that. If it doesn't help you, you can ask for a refund within ${c.refundDays} days.`,
    includes: (c) =>
      `For ${c.season}: your full palette (not just the 3 colors you see now), the drape test on your own face, boards and guides. ` +
      `It's ${c.colorPrice}, once.`,
    owned: (c) => `You already have your full ${c.season} palette: open it from your studio any time.`,
    accuracy: (c) =>
      `Your season comes from your selfie's measured warmth, depth and clarity, and your read was ${CONFIDENCE.en[c.confidence]}. ` +
      `Daylight facing a window, no filter and little makeup give the best read; if your photo was dim or tinted, take a new selfie in your studio before you decide.`,
    later: (c) =>
      `Of course. Your ${c.season} result stays in your account, so you can come back to it whenever you like. ` +
      `If you want, I can send it to your email so it doesn't get lost.`,
    other: 'Write to hello@avarobe.com and we will answer you there.',
  },
  es: {
    disclosure: 'Soy Giuglia, la asesora de estilo de Avarobe. Soy una asistente con IA; si prefieres una persona, escribe a hello@avarobe.com.',
    price: (c) =>
      `El Asesor de Color cuesta ${c.colorPrice}, una sola vez, y queda para siempre. ` +
      (c.colorProDays ? `Hoy además trae ${c.colorProDays} días de Pro; Pro se renueva a ${c.proMonthlyPrice} al mes salvo que lo canceles antes. ` : '') +
      `Un análisis de color presencial suele costar varias veces eso. Si no te sirve, puedes pedir el reembolso dentro de ${c.refundDays} días.`,
    includes: (c) =>
      `Para ${c.season}: tu paleta completa (no solo los 3 colores que ves ahora), la prueba de telas en tu propia cara, tableros y guías. ` +
      `Cuesta ${c.colorPrice}, una sola vez.`,
    owned: (c) => `Ya tienes tu paleta completa de ${c.season}: ábrela desde tu estudio cuando quieras.`,
    accuracy: (c) =>
      `Tu estación sale de la calidez, la profundidad y la claridad medidas en tu selfie, y tu lectura fue ${CONFIDENCE.es[c.confidence]}. ` +
      `Luz de día frente a una ventana, sin filtro y con poco maquillaje dan la mejor lectura; si tu foto quedó oscura o con tinte, toma una selfie nueva en tu estudio antes de decidir.`,
    later: (c) =>
      `Claro. Tu resultado ${c.season} queda en tu cuenta, así que puedes volver cuando quieras. ` +
      `Si quieres, te lo mando a tu correo para que no se pierda.`,
    other: 'Escríbenos a hello@avarobe.com y te respondemos ahí.',
  },
  'pt-BR': {
    disclosure: 'Sou a Giuglia, consultora de estilo da Avarobe. Sou uma assistente com IA; se preferir uma pessoa, escreva para hello@avarobe.com.',
    price: (c) =>
      `O Consultor de Cores custa ${c.colorPrice}, uma vez só, e fica seu para sempre. ` +
      (c.colorProDays ? `Hoje ele também traz ${c.colorProDays} dias de Pro; o Pro renova por ${c.proMonthlyPrice} por mês, a menos que você cancele antes. ` : '') +
      `Uma análise de cores presencial costuma custar várias vezes isso. Se não te ajudar, você pode pedir o reembolso em até ${c.refundDays} dias.`,
    includes: (c) =>
      `Para ${c.season}: sua cartela completa (não só as 3 cores que você vê agora), o teste de tecidos no seu próprio rosto, painéis e guias. ` +
      `Custa ${c.colorPrice}, uma vez só.`,
    owned: (c) => `Você já tem sua cartela completa de ${c.season}: abra no seu estúdio quando quiser.`,
    accuracy: (c) =>
      `Sua estação vem do calor, da profundidade e da clareza medidos na sua selfie, e a sua leitura foi ${CONFIDENCE['pt-BR'][c.confidence]}. ` +
      `Luz do dia de frente para uma janela, sem filtro e com pouca maquiagem dão a melhor leitura; se sua foto ficou escura ou com tom, tire uma selfie nova no seu estúdio antes de decidir.`,
    later: (c) =>
      `Claro. Seu resultado ${c.season} fica na sua conta, então você pode voltar quando quiser. ` +
      `Se quiser, eu mando para o seu e-mail para não se perder.`,
    other: 'Escreva para hello@avarobe.com e respondemos por lá.',
  },
}

export function giugliaDisclosure(locale: Locale) {
  return COPY[locale].disclosure
}

// One answer for one doubt, from her result. Who already has the Color
// Advisor is never sold it again.
export function giugliaAnswer(topic: GiugliaTopic, context: GiugliaContext, locale: Locale): GiugliaAnswer {
  const copy = COPY[locale]

  if (context.ownsColorAdvisor && (topic === 'price' || topic === 'includes')) {
    return { topic, text: copy.owned(context), action: 'studio' }
  }

  switch (topic) {
    case 'price':
      return { topic, text: copy.price(context), action: 'checkout' }
    case 'includes':
      return { topic, text: copy.includes(context), action: 'checkout' }
    case 'accuracy':
      return { topic, text: copy.accuracy(context), action: 'studio' }
    case 'later':
      return { topic, text: copy.later(context), action: 'email' }
    case 'other':
      return { topic, text: copy.other, action: null }
  }
}
