import type { FastifyInstance } from 'fastify'

import { esMessages } from '../i18n/messages.es.js'
import { ptBrMessages } from '../i18n/messages.pt-BR.js'
import { type Locale, requestLocale } from './locale.js'

// The API's messages (errors, offers, limits) are written in English in the
// code. For a page in another language they're translated on the way out:
// exact sentences from the locale's table, and sentences with a value in them
// through TEMPLATES ("{feature} comes with Avarobe Pro."), whose values are
// translated too when the table has them. Anything missing stays English.
export type MessageTable = Record<string, string>

const TABLES: Record<Exclude<Locale, 'en'>, MessageTable> = { 'pt-BR': ptBrMessages, es: esMessages }

// English sentences with {placeholders}, as the code builds them. Each one
// needs the same key in the locale tables.
export const TEMPLATES = [
  '{feature} comes with Avarobe Pro.',
  '{feature} comes with your Color Advisor.',
  '{feature} comes with your Hair & Grooming Advisor.',
  '{feature} comes with your Style Advisor.',
  'Keep it to {count} lines; remove one first.',
  'You can create or adjust your avatar {count} times a day. Try again tomorrow.',
  'You can have up to {count} collections.',
  'You can have up to {count} passkeys. Remove one first.',
  'You can try {count} hairstyles a day. Come back tomorrow.',
  'You’ve broken down today’s {count} looks. Come back tomorrow.',
  'Your card was declined: {reason}',
  'You have {count} looks left. Ask for fewer, or add more looks.',
  'You have 1 look left. Ask for fewer, or add more looks.',
]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPILED = TEMPLATES.map((template) => {
  const names: string[] = []
  const pattern = escape(template).replace(/\\\{(\w+)\\\}/g, (_match, name: string) => {
    names.push(name)
    return '(.+?)'
  })

  return { template, names, regex: new RegExp(`^${pattern}$`) }
})

export function translateMessage(text: string, locale: Locale): string {
  if (locale === 'en') {
    return text
  }

  const table = TABLES[locale]
  // The code writes straight and curly apostrophes; the tables use curly ones.
  const exact = table[text] ?? table[text.replace(/'/g, '’')]

  if (exact) {
    return exact
  }

  for (const { template, names, regex } of COMPILED) {
    const match = regex.exec(text) ?? regex.exec(text.replace(/'/g, '’'))
    const translated = match ? table[template] : undefined

    if (match && translated) {
      return names.reduce((out, name, index) => {
        const value = match[index + 1] ?? ''
        return out.replace(`{${name}}`, table[value] ?? value)
      }, translated)
    }
  }

  return text
}

// Translates the `message` of every JSON reply for the request's language.
export function registerMessageTranslation(app: FastifyInstance) {
  app.addHook('preSerialization', async (request, _reply, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload
    }

    const message = (payload as { message?: unknown }).message
    const locale = requestLocale(request)

    return typeof message === 'string' && locale !== 'en' ? { ...payload, message: translateMessage(message, locale) } : payload
  })
}
