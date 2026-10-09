import type { Locale } from '../utils/locale.js'
import { enEmails, type EmailCopy } from './emails.en.js'
import { esEmails } from './emails.es.js'
import { ptBrEmails } from './emails.pt-BR.js'

// The emails in the reader's language (users.locale): their words, and how
// money and dates read there.
export type { EmailCopy }

const COPY: Record<Locale, EmailCopy> = { en: enEmails, 'pt-BR': ptBrEmails, es: esEmails }

export function emailCopy(locale: Locale | null | undefined): EmailCopy {
  return COPY[locale ?? 'en']
}

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', 'pt-BR': 'pt-BR', es: 'es-MX' }

// "$4.99", "R$ 14,90", "US$ 4,99", "$79.00" (pesos, in Spanish), "USD 2.99",
// "$ 11.900" (Colombian pesos, in Spanish: whole pesos, written as there).
// Minor units of the currency, as Stripe and billing/pricing.ts keep them.
export function formatMoney(cents: number, currency: string, locale: Locale | null | undefined) {
  const lang = locale ?? 'en'

  // Exactly as the English emails always wrote dollars.
  if (lang === 'en' && currency.toLowerCase() === 'usd') {
    return `$${(cents / 100).toFixed(2)}`
  }

  if (currency.toLowerCase() === 'cop') {
    return new Intl.NumberFormat(lang === 'es' ? 'es-CO' : INTL_LOCALE[lang], {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100)
  }

  return new Intl.NumberFormat(INTL_LOCALE[lang], { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

// What a color analysis costs with an analyst in person (US analysts, in
// dollars, as on the site's lib/color-advisor.ts): "$150–$400", "US$ 150–400",
// "USD 150–400".
export function inPersonPrice(locale: Locale | null | undefined) {
  const lang = locale ?? 'en'

  if (lang === 'en') {
    return '$150–$400'
  }

  const dollars = new Intl.NumberFormat(INTL_LOCALE[lang], {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  return `${dollars.format(150)}–${new Intl.NumberFormat(INTL_LOCALE[lang]).format(400)}`
}

// "Wednesday, October 7", "quarta-feira, 7 de outubro", "miércoles 7 de octubre".
export function longDate(date: Date, locale: Locale | null | undefined, timeZone = 'UTC') {
  const lang = locale ?? 'en'

  if (lang === 'es') {
    const weekday = date.toLocaleDateString(INTL_LOCALE.es, { weekday: 'long', timeZone })
    return `${weekday} ${date.toLocaleDateString(INTL_LOCALE.es, { day: 'numeric', month: 'long', timeZone })}`
  }

  return date.toLocaleDateString(INTL_LOCALE[lang], { weekday: 'long', month: 'long', day: 'numeric', timeZone })
}

// "October 2026", "outubro de 2026", "octubre de 2026".
export function monthYear(date: Date, locale: Locale | null | undefined, timeZone = 'UTC') {
  return date.toLocaleDateString(INTL_LOCALE[locale ?? 'en'], { month: 'long', year: 'numeric', timeZone })
}

// "Monday", "segunda-feira", "lunes".
export function weekdayName(date: Date, locale: Locale | null | undefined, timeZone = 'UTC') {
  return date.toLocaleDateString(INTL_LOCALE[locale ?? 'en'], { weekday: 'long', timeZone })
}
