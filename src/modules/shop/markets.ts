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

// Second-hand sites: one used item each, usually gone.
const USED_GOODS = ['enjoei.', 'poshmark.', 'depop.', 'vinted.', 'thredup.', 'grailed.', 'tradesy.', 'vestiairecollective.']

// Whole words in a title, in the languages of the markets (lookarounds, as
// \b doesn't see accented letters).
const words = (list: string) => new RegExp(`(?<!\\p{L})(?:${list})(?!\\p{L})`, 'iu')

const KIDS = words('infantil|infantis|kids?|menin[oa]s?|niñ[oa]s?|boys?|girls?|bebês?|bebés?|baby|babies|toddlers?')
const MENS = words('masculin[oa]s?|hombres?|caballeros?|men[\'’]?s|for men|homme|herren')
const WOMENS = words('feminin[oa]s?|mujer(?:es)?|damas?|women[\'’]?s|for women|femme|damen|senhoras?')
const KIDS_PATH = /\/(?:kids|infantil|menin[oa]s?|nin[oa]s?|boys|girls|baby|bebe)(?:[/-]|$)/i
const MENS_PATH = /\/(?:men|mens|masculino|hombre|homme|herren)(?:[/-]|$)/i
const WOMENS_PATH = /\/(?:women|womens|feminino|mujer|femme|damen)(?:[/-]|$)/i

// A listing, category or sale page rather than one product: Mercado Livre's
// and Mercado Libre's search lists, a sale banner ("Up To 60% Off", "30% OFF
// de todos os estilos"), a title that is a web address ("Compra tshirt en
// www.tienda.com.co"), a sale or category section in the address.
function isListing(match: ShopMatch, url: URL | null) {
  const host = url?.hostname.toLowerCase() ?? match.domain

  return (
    /^(?:lista|listado)\./.test(host) ||
    /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i.test(match.title) ||
    /\bup to \d{1,3}\s?%/i.test(match.title) ||
    /\d{1,3}\s?% off (?:de|on) (?:todos|todas|all|everything)\b/i.test(match.title) ||
    /^(?:sale|ofertas?|promo(?:ção|ción)?)\s*:/i.test(match.title) ||
    /\/(?:browse\/sale|sale-[a-z-]+|category|categoria|categorias)(?:[/?]|$)/i.test(url?.pathname ?? '')
  )
}

// What the store search shows (beyond isStore): no second-hand sites, no
// listing or sale pages, and nothing from the wrong department for the
// avatar's clothes (children's always; men's for womenswear, women's for
// menswear, when we know which).
export function isShoppable(match: ShopMatch, presentation: string | null | undefined) {
  if (USED_GOODS.some((pattern) => match.domain.includes(pattern))) {
    return false
  }

  let url: URL | null = null

  try {
    url = new URL(match.link)
  } catch {
    url = null
  }

  if (isListing(match, url)) {
    return false
  }

  const path = url?.pathname ?? ''

  if (KIDS.test(match.title) || KIDS_PATH.test(path)) {
    return false
  }

  if (presentation === 'womenswear') {
    return !MENS.test(match.title) && !MENS_PATH.test(path)
  }

  if (presentation === 'menswear') {
    return !WOMENS.test(match.title) && !WOMENS_PATH.test(path)
  }

  return true
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
