import type { COLOR_SEASONS } from '../modules/avatar/prompts.js'
import type { Locale } from './locale.js'

// The 12 color seasons by name in each language. The color analysis stores
// the English name (an enum, avatar/prompts.ts COLOR_SEASONS); emails and
// pages show it in the reader's language. The web uses the same names.
export type ColorSeason = (typeof COLOR_SEASONS)[number]

export const SEASON_NAMES: Record<Exclude<Locale, 'en'>, Record<ColorSeason, string>> = {
  'pt-BR': {
    'Light Spring': 'Primavera Clara',
    'Warm Spring': 'Primavera Quente',
    'Bright Spring': 'Primavera Brilhante',
    'Light Summer': 'Verão Claro',
    'Cool Summer': 'Verão Frio',
    'Soft Summer': 'Verão Suave',
    'Soft Autumn': 'Outono Suave',
    'Warm Autumn': 'Outono Quente',
    'Deep Autumn': 'Outono Profundo',
    'Deep Winter': 'Inverno Profundo',
    'Cool Winter': 'Inverno Frio',
    'Bright Winter': 'Inverno Brilhante',
  },
  es: {
    'Light Spring': 'Primavera Clara',
    'Warm Spring': 'Primavera Cálida',
    'Bright Spring': 'Primavera Brillante',
    'Light Summer': 'Verano Claro',
    'Cool Summer': 'Verano Frío',
    'Soft Summer': 'Verano Suave',
    'Soft Autumn': 'Otoño Suave',
    'Warm Autumn': 'Otoño Cálido',
    'Deep Autumn': 'Otoño Profundo',
    'Deep Winter': 'Invierno Profundo',
    'Cool Winter': 'Invierno Frío',
    'Bright Winter': 'Invierno Brillante',
  },
}

// "Soft Autumn" → "Outono Suave"; a name outside the 12 stays as it is.
export function seasonName(season: string, locale: Locale | null | undefined): string {
  if (!locale || locale === 'en') {
    return season
  }

  return (SEASON_NAMES[locale] as Record<string, string>)[season] ?? season
}
