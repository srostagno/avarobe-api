import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Filter } from 'mongodb'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { LookDocument, LookPiece } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { InvalidImageError, normalizeOutfitPhoto } from '../../utils/images.js'
import { toObjectId } from '../../utils/object-id.js'
import { serializeLook } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import {
  releaseGenerations,
  remainingGenerations,
  reserveGenerations,
} from '../../utils/usage.js'
import {
  PaywallError,
  hasKit,
  refundCredits,
  requireKit,
  sendPaywall,
  spendCredits,
} from '../billing/entitlements.js'
import { generateLookAnalysis } from '../report/service.js'
import { MARKET_IDS, MARKETS } from '../shop/markets.js'
import { ShopSearchError, shopSearchConfigured } from '../shop/serpapi.js'
import { ShopQuotaError, findPieceMatches } from '../shop/service.js'
import {
  NoOutfitError,
  analyzeOutfit,
  lookStorageKeys,
  planLooks,
  startLookRender,
  startPieceRenders,
} from './service.js'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

type QuotaResult =
  | { ok: true }
  | { ok: false; status: 402 | 429; body: { message: string; code?: string } }

// The daily fair-use cap depends on the plan. Free accounts that hit it get
// the upgrade instead of a dead end; paying ones hear that credits keep.
async function reserveLookQuota(app: FastifyInstance, userId: ObjectId, amount: number): Promise<QuotaResult> {
  const kit = await hasKit(app, userId)
  const limit = kit ? env.DAILY_LOOK_LIMIT : env.DAILY_FREE_LOOK_LIMIT

  if (await reserveGenerations(app, userId, 'look', amount, limit)) {
    return { ok: true }
  }

  if (!kit) {
    return {
      ok: false,
      status: 402,
      body: { code: 'no_credits', message: 'You’ve used your free looks. Get the Style Kit to keep styling.' },
    }
  }

  const remaining = await remainingGenerations(app, userId, 'look', limit)

  return {
    ok: false,
    status: 429,
    body: {
      message:
        remaining > 0
          ? `You can style ${remaining} more look${remaining === 1 ? '' : 's'} today. Ask for fewer, or come back tomorrow.`
          : `You’ve styled ${limit} looks today. Come back tomorrow; your credits will be waiting.`,
    },
  }
}

const createSchema = z.object({
  occasion: z.string().trim().min(3).max(280),
  notes: z.string().trim().max(280).optional(),
  count: z.number().int().min(1).max(3).default(3),
})

const listQuerySchema = z.object({
  batchId: z.string().optional(),
  collectionId: z.string().optional(),
  favorite: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
})

const updateSchema = z.object({
  favorite: z.boolean().optional(),
})

const tryOnFieldsSchema = z.object({
  notes: z.string().trim().max(280).optional(),
})

const shopQuerySchema = z.object({
  market: z.enum(MARKET_IDS).default('world'),
  localOnly: z.enum(['true', 'false']).default('true'),
  offset: z.coerce.number().int().min(0).max(200).default(0),
  limit: z.coerce.number().int().min(1).max(24).default(8),
})

const lookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(listQuerySchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const filter: Filter<LookDocument> = { userId }
    const batchId = toObjectId(parsed.data.batchId)
    const collectionId = toObjectId(parsed.data.collectionId)

    if (batchId) {
      filter.batchId = batchId
    }

    if (collectionId) {
      filter.collectionIds = collectionId
    }

    if (parsed.data.favorite) {
      filter.favorite = true
    }

    const looks = await app.collections.looks
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(parsed.data.limit)
      .toArray()

    return {
      looks: await Promise.all(looks.map(serializeLook)),
      remaining: await remainingGenerations(
        app,
        userId,
        'look',
        (await hasKit(app, userId)) ? env.DAILY_LOOK_LIMIT : env.DAILY_FREE_LOOK_LIMIT,
      ),
    }
  })

  app.get('/markets', async () => ({
    markets: MARKETS.map((market) => ({ id: market.id, label: market.label })),
    storeSearch: shopSearchConfigured(),
  }))

  app.get('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const look = lookId
      ? await app.collections.looks.findOne({ _id: lookId, userId })
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    return { look: await serializeLook(look) }
  })

  // Plans the looks synchronously (the stylist call), then renders each one
  // in the background. The client polls GET /looks?batchId=.
  app.post(
    '/',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(createSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply
          .code(409)
          .send({ message: 'Your avatar needs to be ready before styling looks.' })
      }

      const { occasion, count } = parsed.data
      const notes = parsed.data.notes || null

      const quota = await reserveLookQuota(app, userId, count)

      if (!quota.ok) {
        return reply.code(quota.status).send(quota.body)
      }

      let creditSpent: boolean

      try {
        creditSpent = await spendCredits(app, userId, count)
      } catch (error) {
        await releaseGenerations(app, userId, 'look', count)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      let plan: Awaited<ReturnType<typeof planLooks>>

      try {
        plan = await planLooks({ avatar, occasion, notes, count })
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Look planning failed')
        await releaseGenerations(app, userId, 'look', count)
        await refundCredits(app, userId, creditSpent ? count : 0)
        return reply
          .code(502)
          .send({ message: 'Our stylist could not plan this one. Please try again.' })
      }

      if (plan.looks.length < count) {
        await releaseGenerations(app, userId, 'look', count - plan.looks.length)
        await refundCredits(app, userId, creditSpent ? count - plan.looks.length : 0)
      }

      const now = new Date()
      const batchId = new ObjectId()
      const looks: LookDocument[] = plan.looks.map((lookPlan) => ({
        _id: new ObjectId(),
        userId,
        avatarId: avatar._id,
        batchId,
        occasion: {
          text: occasion,
          dressCode: plan.dressCode,
          summary: plan.occasionSummary,
        },
        plan: lookPlan,
        status: 'processing',
        error: null,
        imageKey: null,
        creditSpent,
        collectionIds: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        readyAt: null,
      }))

      await app.collections.looks.insertMany(looks)

      for (const look of looks) {
        startLookRender(app, look._id)
      }

      return reply.code(202).send({
        batchId: batchId.toString(),
        looks: await Promise.all(looks.map(serializeLook)),
      })
    },
  )

  // Try-on: an outfit photo in, a look on the person's avatar out. The photo
  // is read into a plan synchronously; the render runs in the background.
  app.post(
    '/try-on',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const fields: Record<string, string> = {}
      let upload: Buffer | null = null

      try {
        for await (const part of request.parts({
          limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
        })) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer()

            if (part.fieldname === 'photo') {
              upload = buffer
            }
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value
          }
        }
      } catch (error) {
        request.log.warn({ err: error }, 'Try-on upload rejected')
        return reply.code(413).send({ message: 'The photo must be an image under 12 MB.' })
      }

      if (!upload) {
        return reply.code(400).send({ message: 'Add a photo of the outfit.' })
      }

      const parsed = parseBody(tryOnFieldsSchema, fields)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply.code(409).send({ message: 'Your avatar needs to be ready before trying on outfits.' })
      }

      let photo: Buffer

      try {
        photo = await normalizeOutfitPhoto(upload)
      } catch (error) {
        const message = error instanceof InvalidImageError ? error.message : 'That photo could not be read.'
        return reply.code(400).send({ message })
      }

      const quota = await reserveLookQuota(app, userId, 1)

      if (!quota.ok) {
        return reply.code(quota.status).send(quota.body)
      }

      let creditSpent: boolean

      try {
        await requireKit(app, userId, 'Trying on outfits')
        creditSpent = await spendCredits(app, userId, 1)
      } catch (error) {
        await releaseGenerations(app, userId, 'look', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const notes = parsed.data.notes || null
      let analysis: Awaited<ReturnType<typeof analyzeOutfit>>

      try {
        analysis = await analyzeOutfit({ avatar, photo, notes })
      } catch (error) {
        await releaseGenerations(app, userId, 'look', 1)
        await refundCredits(app, userId, creditSpent ? 1 : 0)

        if (error instanceof NoOutfitError) {
          return reply
            .code(422)
            .send({ message: "We couldn't find an outfit in that photo. Try one that shows the clothes clearly." })
        }

        request.log.error({ err: errorMessage(error) }, 'Try-on analysis failed')
        return reply.code(502).send({ message: 'Our stylist could not read that photo. Please try again.' })
      }

      const now = new Date()
      const lookId = new ObjectId()
      const referenceKey = `users/${userId.toString()}/look-${lookId.toString()}-reference.jpg`

      await storage.put(referenceKey, photo, 'image/jpeg')

      const look: LookDocument = {
        _id: lookId,
        userId,
        avatarId: avatar._id,
        batchId: new ObjectId(),
        occasion: {
          text: notes ?? 'Try-on',
          dressCode: analysis.dressCode,
          summary: analysis.plan.summary,
        },
        plan: analysis.plan,
        source: 'tryon',
        referenceKey,
        status: 'processing',
        error: null,
        imageKey: null,
        creditSpent,
        collectionIds: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        readyAt: null,
      }

      await app.collections.looks.insertOne(look)
      startLookRender(app, look._id)

      return reply.code(202).send({ look: await serializeLook(look) })
    },
  )

  // Breaks a finished look into one product photo per garment. The first
  // time counts against the daily pieces limit; retrying failed pieces is free.
  app.post(
    '/:id/pieces',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const lookId = toObjectId((request.params as { id?: string }).id)
      const look = lookId ? await app.collections.looks.findOne({ _id: lookId, userId }) : null

      if (!look) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      if (look.status !== 'ready' || !look.imageKey) {
        return reply.code(409).send({ message: 'The look needs to finish first.' })
      }

      try {
        await requireKit(app, userId, 'Shopping the pieces')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      let pieceIds: string[]

      if (look.pieces?.length) {
        pieceIds = look.pieces.filter((piece) => piece.status === 'failed').map((piece) => piece.id)

        if (pieceIds.length === 0) {
          return { look: await serializeLook(look) }
        }

        await app.collections.looks.updateOne(
          { _id: look._id },
          { $set: { 'pieces.$[piece].status': 'processing', updatedAt: new Date() } },
          { arrayFilters: [{ 'piece.id': { $in: pieceIds } }] },
        )
      } else {
        if (!(await reserveGenerations(app, userId, 'pieces', 1))) {
          return reply.code(429).send({
            message: `You've broken down today's ${env.DAILY_PIECES_LIMIT} looks. Come back tomorrow.`,
          })
        }

        const pieces: LookPiece[] = look.plan.items.map((item) => ({
          id: new ObjectId().toString(),
          slot: item.slot,
          name: item.name,
          color: item.color,
          colorHex: item.colorHex,
          material: item.material,
          fit: item.fit,
          status: 'processing',
          imageKey: null,
        }))

        pieceIds = pieces.map((piece) => piece.id)
        await app.collections.looks.updateOne(
          { _id: look._id, pieces: { $exists: false } },
          { $set: { pieces, updatedAt: new Date() } },
        )
      }

      startPieceRenders(app, look._id, pieceIds)

      const updated = await app.collections.looks.findOne({ _id: look._id })

      return reply.code(202).send({ look: updated ? await serializeLook(updated) : null })
    },
  )

  // The stylist's full read of one look (Style Kit). Kept on the look.
  app.post(
    '/:id/analysis',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const lookId = toObjectId((request.params as { id?: string }).id)
      const look = lookId ? await app.collections.looks.findOne({ _id: lookId, userId }) : null

      if (!look) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      try {
        await requireKit(app, userId, 'The full look analysis')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      if (look.analysis) {
        return { look: await serializeLook(look) }
      }

      if (look.status !== 'ready') {
        return reply.code(409).send({ message: 'The look needs to finish first.' })
      }

      const avatar = await app.collections.avatars.findOne({ _id: look.avatarId })

      if (!avatar) {
        return reply.code(409).send({ message: 'This look’s avatar was deleted.' })
      }

      try {
        const data = await generateLookAnalysis(avatar, look)
        const updated = await app.collections.looks.findOneAndUpdate(
          { _id: look._id },
          { $set: { analysis: { data, createdAt: new Date() } } },
          { returnDocument: 'after' },
        )

        return { look: updated ? await serializeLook(updated) : null }
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Look analysis failed')
        return reply.code(502).send({ message: 'We could not analyze this look. Try again.' })
      }
    },
  )

  // Store matches for one piece: ?market=cl&localOnly=true&offset=8
  app.get(
    '/:id/pieces/:pieceId/shop',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const params = request.params as { id?: string; pieceId?: string }
      const parsed = parseBody(shopQuerySchema, request.query)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      if (!shopSearchConfigured()) {
        return reply.code(503).send({ message: 'Store search is coming soon.' })
      }

      const lookId = toObjectId(params.id)
      const look = lookId ? await app.collections.looks.findOne({ _id: lookId, userId }) : null
      const piece = look?.pieces?.find((candidate) => candidate.id === params.pieceId)

      if (!look || !piece) {
        return reply.code(404).send({ message: 'Piece not found.' })
      }

      if (piece.status !== 'ready' || !piece.imageKey) {
        return reply.code(409).send({ message: 'This piece is still being prepared.' })
      }

      try {
        await requireKit(app, userId, 'Store search')

        return await findPieceMatches(app, {
          userId,
          look,
          piece,
          marketId: parsed.data.market,
          localOnly: parsed.data.localOnly === 'true',
          offset: parsed.data.offset,
          limit: parsed.data.limit,
        })
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        if (error instanceof ShopQuotaError) {
          return reply.code(429).send({ message: error.message })
        }

        request.log.error({ err: errorMessage(error) }, 'Store search failed')
        const status = error instanceof ShopSearchError && error.statusCode === 503 ? 503 : 502
        return reply.code(status).send({ message: 'Store search is not responding. Try again in a moment.' })
      }
    },
  )

  app.post(
    '/:id/retry',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const lookId = toObjectId((request.params as { id?: string }).id)
      const look = lookId
        ? await app.collections.looks.findOne({ _id: lookId, userId })
        : null

      if (!look) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      if (look.status !== 'failed') {
        return reply.code(409).send({ message: 'This look does not need a retry.' })
      }

      const quota = await reserveLookQuota(app, userId, 1)

      if (!quota.ok) {
        return reply.code(quota.status).send(quota.body)
      }

      let creditSpent: boolean

      try {
        creditSpent = await spendCredits(app, userId, 1)
      } catch (error) {
        await releaseGenerations(app, userId, 'look', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      await app.collections.looks.updateOne(
        { _id: look._id },
        { $set: { status: 'processing', error: null, creditSpent, updatedAt: new Date() } },
      )
      startLookRender(app, look._id)

      const updated = await app.collections.looks.findOne({ _id: look._id })

      return reply.code(202).send({ look: updated ? await serializeLook(updated) : null })
    },
  )

  app.patch('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const parsed = parseBody(updateSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const look = lookId
      ? await app.collections.looks.findOneAndUpdate(
          { _id: lookId, userId },
          { $set: { ...parsed.data, updatedAt: new Date() } },
          { returnDocument: 'after' },
        )
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    return { look: await serializeLook(look) }
  })

  app.delete('/:id', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const look = lookId
      ? await app.collections.looks.findOneAndDelete({ _id: lookId, userId })
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    await Promise.all([
      ...lookStorageKeys(look).map((key) => storage.remove(key).catch(() => undefined)),
      app.collections.shopSearches.deleteMany({ userId, lookId: look._id }),
    ])

    return { ok: true }
  })
}

export default lookRoutes
