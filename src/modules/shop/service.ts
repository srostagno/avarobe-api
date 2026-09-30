import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { LookDocument, LookPiece, ShopMatch } from '../../types/mongo.js'
import { storage } from '../../utils/storage.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import { isLocalStore, isStore, marketById } from './markets.js'
import { SEARCH_PASSES, searchPiece } from './serpapi.js'

const CACHE_DAYS = 3

export class ShopQuotaError extends Error {}

function matchKey(match: ShopMatch) {
  try {
    const url = new URL(match.link)
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`.toLowerCase()
  } catch {
    return match.link
  }
}

// Returns one page of store matches for a piece. Results are cached per
// piece and market; a new (paid) search only runs when the page reaches past
// what's cached, trying the next search pass until they run out.
export async function findPieceMatches(
  app: FastifyInstance,
  input: {
    userId: ObjectId
    look: LookDocument
    piece: LookPiece
    marketId: string
    localOnly: boolean
    offset: number
    limit: number
  },
) {
  const market = marketById(input.marketId)
  const filter = { userId: input.userId, lookId: input.look._id, pieceId: input.piece.id, market: market.id }
  let search = await app.collections.shopSearches.findOne(filter)
  let presentation: string | null | undefined
  const visible = (results: ShopMatch[]) =>
    results.filter((match) => isStore(match) && (!input.localOnly || isLocalStore(match, market)))

  while (
    visible(search?.results ?? []).length < input.offset + input.limit &&
    !(search?.exhausted ?? false)
  ) {
    const pass = search?.passes ?? 0

    if (pass >= SEARCH_PASSES.length) {
      break
    }

    if (!(await reserveGenerations(app, input.userId, 'shop', 1))) {
      // Serve what we have; only fail when there's nothing to show.
      if (visible(search?.results ?? []).length > input.offset) {
        break
      }

      throw new ShopQuotaError("You've reached today's store searches. Come back tomorrow.")
    }

    let found: ShopMatch[]

    try {
      if (presentation === undefined) {
        const avatar = await app.collections.avatars.findOne(
          { _id: input.look.avatarId },
          { projection: { 'body.presentation': 1 } },
        )
        presentation = avatar?.body?.presentation ?? null
      }

      found = await searchPiece({
        piece: input.piece,
        image: await storage.read(input.piece.imageKey ?? ''),
        market,
        presentation,
        pass,
      })
    } catch (error) {
      await releaseGenerations(app, input.userId, 'shop', 1)
      throw error
    }

    const seen = new Set((search?.results ?? []).map(matchKey))
    const fresh = found.filter((match) => {
      const key = matchKey(match)

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    const now = new Date()

    search = await app.collections.shopSearches.findOneAndUpdate(
      filter,
      {
        $push: { results: { $each: fresh } },
        $set: {
          passes: pass + 1,
          exhausted: pass + 1 >= SEARCH_PASSES.length,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + CACHE_DAYS * 24 * 60 * 60 * 1000),
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    )
  }

  const results = visible(search?.results ?? [])

  return {
    market: market.id,
    localOnly: input.localOnly,
    matches: results.slice(input.offset, input.offset + input.limit),
    // More exist if cached results remain or another search pass can run.
    hasMore: results.length > input.offset + input.limit || !(search?.exhausted ?? false),
  }
}
