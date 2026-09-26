import type { ShopMatch } from '../../types/mongo.js'

export type Market = {
  id: string
  label: string
  // Google country (gl) and language (hl) for the search. Worldwide sends no
  // country.
  country: string | null
  hl: string
  // Country codes a local store shows in its domain (falabella.cl,
  // tienda.com.mx) or its path (zara.com/cl/, hm.com/es_cl/).
  codes: string[]
}

const WORLDWIDE: Market = { id: 'world', label: 'Worldwide', country: null, hl: 'en', codes: [] }

export const MARKETS: Market[] = [
  WORLDWIDE,
  { id: 'us', label: 'United States', country: 'us', hl: 'en', codes: ['us'] },
  { id: 'ca', label: 'Canada', country: 'ca', hl: 'en', codes: ['ca'] },
  { id: 'uk', label: 'United Kingdom', country: 'uk', hl: 'en', codes: ['uk', 'gb'] },
  { id: 'au', label: 'Australia', country: 'au', hl: 'en', codes: ['au'] },
  { id: 'mx', label: 'Mexico', country: 'mx', hl: 'es', codes: ['mx'] },
  { id: 'cl', label: 'Chile', country: 'cl', hl: 'es', codes: ['cl'] },
  { id: 'ar', label: 'Argentina', country: 'ar', hl: 'es', codes: ['ar'] },
  { id: 'co', label: 'Colombia', country: 'co', hl: 'es', codes: ['co'] },
  { id: 'pe', label: 'Peru', country: 'pe', hl: 'es', codes: ['pe'] },
  { id: 'es', label: 'Spain', country: 'es', hl: 'es', codes: ['es'] },
  { id: 'br', label: 'Brazil', country: 'br', hl: 'pt', codes: ['br'] },
  { id: 'fr', label: 'France', country: 'fr', hl: 'fr', codes: ['fr'] },
  { id: 'de', label: 'Germany', country: 'de', hl: 'de', codes: ['de'] },
  { id: 'it', label: 'Italy', country: 'it', hl: 'it', codes: ['it'] },
]

export const MARKET_IDS = MARKETS.map((market) => market.id) as [string, ...string[]]

export function marketById(id: string) {
  return MARKETS.find((market) => market.id === id) ?? WORLDWIDE
}

const COUNTRY_CODES = new Set(MARKETS.flatMap((market) => market.codes))

// Two-letter endings that are used as generic domains, not as countries.
const GENERIC_TLDS = new Set(['co', 'io', 'ai', 'me', 'tv', 'ly', 'fm', 'gg', 'to', 'us'])

// Social networks and image sites show up in visual matches but aren't stores.
const NOT_STORES = [
  'pinterest.',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'youtube.com',
  'reddit.com',
  'x.com',
  'twitter.com',
  'wikipedia.org',
  'lookastic.',
  'shutterstock.com',
  'istockphoto.com',
  'gettyimages.',
  'alamy.com',
  'freepik.com',
  'dreamstime.com',
]

export function isStore(match: ShopMatch) {
  return !NOT_STORES.some((pattern) => match.domain.includes(pattern))
}

// Country codes in the first two path segments: /cl/, /es-cl/, /es_cl/,
// /falabella-cl/.
function pathCountries(url: URL) {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment.toLowerCase().match(/^(?:[a-z]+[-_])?([a-z]{2})$/)?.[1])
    .filter((code): code is string => Boolean(code && COUNTRY_CODES.has(code)))
}

// Whether a store sells in this market. For Chile that means a .cl domain or
// a Chilean section of an international site. The US has no country domain,
// so there it means "not another country's store".
export function isLocalStore(match: ShopMatch, market: Market) {
  if (market.codes.length === 0) {
    return true
  }

  let url: URL

  try {
    url = new URL(match.link)
  } catch {
    return false
  }

  const host = url.hostname.toLowerCase()
  const tld = host.split('.').pop() ?? ''
  const inPath = pathCountries(url)

  if (market.id === 'us') {
    const foreignDomain = tld.length === 2 && !GENERIC_TLDS.has(tld)
    const foreignPath = inPath.some((code) => code !== 'us')

    return !foreignDomain && !foreignPath
  }

  return market.codes.includes(tld) || inPath.some((code) => market.codes.includes(code))
}
