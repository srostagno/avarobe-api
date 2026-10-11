import type { Locale } from '../utils/locale.js'
import { currentLocale } from '../utils/request-locale.js'
import { DEFAULT_TIME_ZONE } from '../utils/timezones.js'

// What the usage caps say when they stop something (Oct 2026): the day's
// new pictures, a Pro month's avatar changes, and annual Pro's first-week
// looks. Built in the language of the request (messages with a date can't go
// through utils/translate-message.ts), and always sent with a `code` and the
// numbers, so the web can say it its own way. Dates and times are on the
// person's clock (`timeZone`, from where they signed up).

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', 'pt-BR': 'pt-BR', es: 'es-MX' }

// "October 31", "31 de outubro", "31 de octubre".
function day(date: Date, locale: Locale, timeZone: string) {
  return date.toLocaleDateString(INTL_LOCALE[locale], { month: 'long', day: 'numeric', timeZone })
}

// The day's counters start over at midnight UTC: in the Americas that's
// still today (5 PM in California, 9 PM in São Paulo). The time it happens
// when it's still today where they are; null when it's tomorrow there.
export function dayResetToday(locale: Locale, timeZone: string, now = new Date()) {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const date = (value: Date) => value.toLocaleDateString('en-CA', { timeZone })

  return date(reset) === date(now)
    ? reset.toLocaleTimeString(INTL_LOCALE[locale], { hour: 'numeric', minute: '2-digit', timeZone })
    : null
}

const one = (count: number, locale: Locale) => new Intl.PluralRules(INTL_LOCALE[locale]).select(count) === 'one'

// `at`: the time more come back today, or null for tomorrow.
const MESSAGES = {
  en: {
    images: (limit: number, at: string | null) =>
      `You’ve made ${limit} new pictures today, the most for one day. ${at ? `More from ${at} today` : 'More tomorrow'}; your looks stay in your account.`,
    imagesLeft: (left: number, at: string | null) =>
      `You can make ${left} more new ${one(left, 'en') ? 'picture' : 'pictures'} today. Ask for fewer, or come back ${at ? `after ${at}` : 'tomorrow'}.`,
    imagesFixed: (left: number, needed: number, at: string | null) =>
      `You can make ${left} more new ${one(left, 'en') ? 'picture' : 'pictures'} today, and this needs ${needed}. Come back ${at ? `after ${at}` : 'tomorrow'}; nothing was used.`,
    avatarMonth: (limit: number, date: string | null) =>
      date ? `You’ve used this month’s ${limit} avatar changes. More on ${date}.` : `You’ve used this month’s ${limit} avatar changes.`,
    held: (first: number, held: number, date: string) =>
      `You’ve used your first ${first} looks. The other ${held} arrive on ${date}, or add a look pack now.`,
    heldLeft: (left: number, held: number, date: string) =>
      `You have ${left} ${one(left, 'en') ? 'look' : 'looks'} left, and the other ${held} arrive on ${date}. Ask for fewer, or add a look pack now.`,
  },
  'pt-BR': {
    images: (limit: number, at: string | null) =>
      `Você já criou ${limit} imagens novas hoje, o máximo por dia. ${at ? `Hoje, a partir das ${at}, tem mais` : 'Amanhã tem mais'}; seus looks continuam na sua conta.`,
    imagesLeft: (left: number, at: string | null) =>
      `Você ainda pode criar ${left} ${one(left, 'pt-BR') ? 'imagem nova' : 'imagens novas'} hoje. Peça menos ou volte ${at ? `depois das ${at}` : 'amanhã'}.`,
    imagesFixed: (left: number, needed: number, at: string | null) =>
      `Você ainda pode criar ${left} ${one(left, 'pt-BR') ? 'imagem nova' : 'imagens novas'} hoje, e isto precisa de ${needed}. Volte ${at ? `depois das ${at}` : 'amanhã'}; nada foi usado.`,
    avatarMonth: (limit: number, date: string | null) =>
      date ? `Você já usou as ${limit} mudanças de avatar deste mês. Mais em ${date}.` : `Você já usou as ${limit} mudanças de avatar deste mês.`,
    held: (first: number, held: number, date: string) =>
      `Você já usou seus primeiros ${first} looks. Os outros ${held} chegam em ${date}, ou adicione um pacote de looks agora.`,
    heldLeft: (left: number, held: number, date: string) =>
      `${one(left, 'pt-BR') ? `Resta ${left} look` : `Restam ${left} looks`}, e os outros ${held} chegam em ${date}. Peça menos ou adicione um pacote de looks agora.`,
  },
  es: {
    images: (limit: number, at: string | null) =>
      `Ya creaste ${limit} imágenes nuevas hoy, el máximo por día. ${at ? `Hoy, desde las ${at}, hay más` : 'Mañana hay más'}; tus looks se quedan en tu cuenta.`,
    imagesLeft: (left: number, at: string | null) =>
      `Hoy puedes crear ${left} ${one(left, 'es') ? 'imagen nueva' : 'imágenes nuevas'} más. Pide menos o vuelve ${at ? `después de las ${at}` : 'mañana'}.`,
    imagesFixed: (left: number, needed: number, at: string | null) =>
      `Hoy puedes crear ${left} ${one(left, 'es') ? 'imagen nueva' : 'imágenes nuevas'} más, y esto necesita ${needed}. Vuelve ${at ? `después de las ${at}` : 'mañana'}; no se usó nada.`,
    avatarMonth: (limit: number, date: string | null) =>
      date ? `Ya usaste los ${limit} cambios de avatar de este mes. Tendrás más el ${date}.` : `Ya usaste los ${limit} cambios de avatar de este mes.`,
    held: (first: number, held: number, date: string) =>
      `Ya usaste tus primeros ${first} looks. Los otros ${held} llegan el ${date}, o agrega un paquete de looks ahora.`,
    heldLeft: (left: number, held: number, date: string) =>
      `${one(left, 'es') ? `Te queda ${left} look` : `Te quedan ${left} looks`} y los otros ${held} llegan el ${date}. Pide menos o agrega un paquete de looks ahora.`,
  },
}

// The caps' messages in `locale` (the request's by default), on the clock of
// `timeZone`.
export function limitMessages(locale: Locale = currentLocale() ?? 'en', timeZone: string = DEFAULT_TIME_ZONE, now = new Date()) {
  const words = MESSAGES[locale]

  return {
    // The day's pictures: all used, or fewer left than a batch asks for
    // (`needed`: a batch that can't be smaller, like an event's looks).
    images: (limit: number, left: number, needed?: number | null) => {
      const at = dayResetToday(locale, timeZone, now)

      return left > 0 ? (needed ? words.imagesFixed(left, needed, at) : words.imagesLeft(left, at)) : words.images(limit, at)
    },
    avatarMonth: (limit: number, resetsAt: Date | null) => words.avatarMonth(limit, resetsAt ? day(resetsAt, locale, timeZone) : null),
    // Annual's first week: none left, or fewer than asked for.
    held: (first: number, held: number, at: Date, left = 0) =>
      left > 0 ? words.heldLeft(left, held, day(at, locale, timeZone)) : words.held(first, held, day(at, locale, timeZone)),
  }
}
