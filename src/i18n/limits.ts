import type { Locale } from '../utils/locale.js'
import { currentLocale } from '../utils/request-locale.js'

// What the usage caps say when they stop something (Oct 2026): the day's
// new pictures, a Pro month's avatar changes, and annual Pro's first-week
// looks. Built in the language of the request (messages with a date can't go
// through utils/translate-message.ts), and always sent with a `code` and the
// numbers, so the web can say it its own way.

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', 'pt-BR': 'pt-BR', es: 'es-MX' }

// "October 31", "31 de outubro", "31 de octubre".
function day(date: Date, locale: Locale) {
  return date.toLocaleDateString(INTL_LOCALE[locale], { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

const one = (count: number, locale: Locale) => new Intl.PluralRules(INTL_LOCALE[locale]).select(count) === 'one'

const MESSAGES = {
  en: {
    images: (limit: number) =>
      `You’ve made ${limit} new pictures today, the most for one day. More tomorrow; your looks stay in your account.`,
    imagesLeft: (left: number) =>
      `You can make ${left} more new ${one(left, 'en') ? 'picture' : 'pictures'} today. Ask for fewer, or come back tomorrow.`,
    avatarMonth: (limit: number, date: string | null) =>
      date ? `You’ve used this month’s ${limit} avatar changes. More on ${date}.` : `You’ve used this month’s ${limit} avatar changes.`,
    held: (first: number, held: number, date: string) =>
      `You’ve used your first ${first} looks. The other ${held} arrive on ${date}, or add a look pack now.`,
  },
  'pt-BR': {
    images: (limit: number) =>
      `Você já criou ${limit} imagens novas hoje, o máximo por dia. Amanhã tem mais; seus looks continuam na sua conta.`,
    imagesLeft: (left: number) =>
      `Você ainda pode criar ${left} ${one(left, 'pt-BR') ? 'imagem nova' : 'imagens novas'} hoje. Peça menos ou volte amanhã.`,
    avatarMonth: (limit: number, date: string | null) =>
      date ? `Você já usou as ${limit} mudanças de avatar deste mês. Mais em ${date}.` : `Você já usou as ${limit} mudanças de avatar deste mês.`,
    held: (first: number, held: number, date: string) =>
      `Você já usou seus primeiros ${first} looks. Os outros ${held} chegam em ${date}, ou adicione um pacote de looks agora.`,
  },
  es: {
    images: (limit: number) =>
      `Ya creaste ${limit} imágenes nuevas hoy, el máximo por día. Mañana hay más; tus looks se quedan en tu cuenta.`,
    imagesLeft: (left: number) =>
      `Hoy puedes crear ${left} ${one(left, 'es') ? 'imagen nueva' : 'imágenes nuevas'} más. Pide menos o vuelve mañana.`,
    avatarMonth: (limit: number, date: string | null) =>
      date ? `Ya usaste los ${limit} cambios de avatar de este mes. Tendrás más el ${date}.` : `Ya usaste los ${limit} cambios de avatar de este mes.`,
    held: (first: number, held: number, date: string) =>
      `Ya usaste tus primeros ${first} looks. Los otros ${held} llegan el ${date}, o agrega un paquete de looks ahora.`,
  },
}

// The caps' messages in `locale`, the request's by default.
export function limitMessages(locale: Locale = currentLocale() ?? 'en') {
  const words = MESSAGES[locale]

  return {
    // The day's pictures: all used, or fewer left than a batch asks for.
    images: (limit: number, left: number) => (left > 0 ? words.imagesLeft(left) : words.images(limit)),
    avatarMonth: (limit: number, resetsAt: Date | null) => words.avatarMonth(limit, resetsAt ? day(resetsAt, locale) : null),
    held: (first: number, held: number, at: Date) => words.held(first, held, day(at, locale)),
  }
}
