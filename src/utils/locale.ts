import type { FastifyRequest } from 'fastify'

import { env } from '../config/env.js'

// The languages Avarobe speaks (Oct 2026): American English, Brazilian
// Portuguese and Latin American Spanish (neutral, Mexico first). The web
// sends the page's language on every request (LOCALE_HEADER); the account
// keeps the one they use (users.locale), for emails and AI text made later.
export const LOCALES = ['en', 'pt-BR', 'es'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_HEADER = 'x-avarobe-locale'

const PREFIX: Record<Locale, string> = { en: '', 'pt-BR': '/pt-br', es: '/es' }

export function toLocale(value: unknown): Locale {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (raw.startsWith('pt')) {
    return 'pt-BR'
  }

  if (raw.startsWith('es')) {
    return 'es'
  }

  return 'en'
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

// The language of the page that made this request.
export function requestLocale(request: FastifyRequest): Locale {
  return toLocale(request.headers[LOCALE_HEADER])
}

// A link to the web in a language: '/studio' → 'https://www.avarobe.com/pt-br/studio'.
export function appUrl(locale: Locale | null | undefined, path: string) {
  const prefix = PREFIX[locale ?? 'en']
  return `${env.APP_URL}${prefix && path === '/' ? prefix : `${prefix}${path}`}`
}

// '/pt-br/color-analysis' → '/color-analysis' (first-touch landings keep the prefix).
export function withoutLocalePrefix(path: string) {
  for (const prefix of Object.values(PREFIX)) {
    if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
      return path.slice(prefix.length) || '/'
    }
  }

  return path
}

const LANGUAGE: Record<Locale, string> = {
  en: 'American English',
  'pt-BR': 'Brazilian Portuguese (pt-BR, natural for a reader in Brazil)',
  es: 'Latin American Spanish (neutral, as written in Mexico; tú, never vos or vosotros)',
}

// The prompts are written for American English. In another language the
// model writes what people read in that language, while keys, enum values
// (season names included) and hex codes stay exactly as the schema says.
export function localizeInstructions(instructions: string, locale: Locale | null | undefined) {
  if (!locale || locale === 'en') {
    return instructions
  }

  const language = LANGUAGE[locale]

  return `${instructions.replaceAll('American English', language)}

Language: write every text the person reads (summaries, advice, names of colors, garments, looks, haircuts and places) in ${language}. Use units and conventions natural there (centimeters and kilograms). Keep JSON keys, enum values (season names included) and hex codes exactly as the schema defines them, in English.`
}
