import sharp from 'sharp'

import { env } from '../../config/env.js'
import type { LookPiece, ShopMatch } from '../../types/mongo.js'
import type { Market } from './markets.js'

const SERPAPI_URL = 'https://serpapi.com'
const TIMEOUT_MS = 30_000
// Uploaded images expire after 10 minutes on SerpApi's side.
const IMAGE_ID_TTL_MS = 9 * 60 * 1000

export class ShopSearchError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message)
  }
}

export function shopSearchConfigured() {
  return Boolean(env.SERPAPI_API_KEY)
}

// Each "show more" runs the next pass once the cached results run out:
// shopping results for the photo, the same refined with the garment's name,
// then broader visual matches.
export const SEARCH_PASSES = [
  { type: 'products', withQuery: false },
  { type: 'products', withQuery: true },
  { type: 'visual_matches', withQuery: false },
] as const

const uploads = new Map<string, { imageId: string; at: number }>()

// Piece photos are product shots without a person, so this is the only image
// of a look that ever leaves for the search provider.
async function uploadImage(cacheKey: string, image: Buffer) {
  const cached = uploads.get(cacheKey)

  if (cached && Date.now() - cached.at < IMAGE_ID_TTL_MS) {
    return cached.imageId
  }

  // SerpApi accepts up to 500 KB.
  const jpeg = await sharp(image)
    .resize({ width: 640, height: 640, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer()
  const form = new FormData()

  form.append('api_key', env.SERPAPI_API_KEY ?? '')
  form.append('image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'piece.jpg')

  const response = await fetch(`${SERPAPI_URL}/image?api_key=${encodeURIComponent(env.SERPAPI_API_KEY ?? '')}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = (await response.json().catch(() => null)) as { image_id?: string; error?: string } | null

  if (!response.ok || !payload?.image_id) {
    throw new ShopSearchError(`SerpApi image upload failed: ${payload?.error ?? response.status}`)
  }

  uploads.set(cacheKey, { imageId: payload.image_id, at: Date.now() })

  for (const [key, value] of uploads) {
    if (Date.now() - value.at > IMAGE_ID_TTL_MS) {
      uploads.delete(key)
    }
  }

  return payload.image_id
}

type LensResult = {
  title?: string
  link?: string
  source?: string
  source_icon?: string
  thumbnail?: string
  price?: { value?: string; extracted_value?: number; currency?: string }
  in_stock?: boolean
}

type LensPayload = {
  error?: string
  visual_matches?: LensResult[]
  products?: LensResult[]
}

function toMatch(result: LensResult): ShopMatch | null {
  if (!result.link || !result.title) {
    return null
  }

  let url: URL

  try {
    url = new URL(result.link)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }

  const domain = url.hostname.replace(/^www\./, '').toLowerCase()

  return {
    title: result.title.trim(),
    link: url.toString(),
    domain,
    source: result.source?.trim() || domain,
    sourceIcon: result.source_icon ?? null,
    thumbnail: result.thumbnail ?? null,
    price: result.price?.value?.trim() || null,
    extractedPrice: typeof result.price?.extracted_value === 'number' ? result.price.extracted_value : null,
    currency: result.price?.currency ?? null,
    inStock: typeof result.in_stock === 'boolean' ? result.in_stock : null,
  }
}

export async function searchPiece(input: {
  piece: LookPiece
  image: Buffer
  market: Market
  pass: number
}): Promise<ShopMatch[]> {
  if (!env.SERPAPI_API_KEY) {
    throw new ShopSearchError('Store search is not set up yet.', 503)
  }

  const pass = SEARCH_PASSES[input.pass]

  if (!pass) {
    return []
  }

  const imageId = await uploadImage(input.piece.id, input.image)
  const params = new URLSearchParams({
    engine: 'google_lens',
    type: pass.type,
    image_id: imageId,
    hl: input.market.hl,
    api_key: env.SERPAPI_API_KEY,
  })

  if (input.market.country) {
    params.set('country', input.market.country)
  }

  if (pass.withQuery) {
    params.set('q', `${input.piece.color} ${input.piece.name}`.toLowerCase())
  }

  const response = await fetch(`${SERPAPI_URL}/search.json?${params.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const payload = (await response.json().catch(() => null)) as LensPayload | null

  if (!response.ok || !payload) {
    throw new ShopSearchError(`SerpApi search failed: ${payload?.error ?? response.status}`)
  }

  // "No results" comes back as an error message with a 200.
  if (payload.error && !payload.visual_matches && !payload.products) {
    return []
  }

  return [...(payload.products ?? []), ...(payload.visual_matches ?? [])]
    .map(toMatch)
    .filter((match): match is ShopMatch => match !== null)
}
