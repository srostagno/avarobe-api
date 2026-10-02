import type { FastifyPluginAsync } from 'fastify'
import type { Filter } from 'mongodb'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { LookDocument, LookFeedback, LookPiece } from '../../types/mongo.js'
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
  billingState,
  loadBillingUser,
  refundCredits,
  requirePro,
  sendPaywall,
  spendCredits,
} from '../billing/entitlements.js'
import { trackServerEvent } from '../analytics/service.js'
import { generateLookAnalysis } from '../report/service.js'
import { MARKET_IDS, MARKETS } from '../shop/markets.js'
import { ShopSearchError, shopSearchConfigured } from '../shop/serpapi.js'
import { ShopQuotaError, findPieceMatches } from '../shop/service.js'
import { FEEDBACK_ASPECTS, describeFeedback } from '../taste/prompts.js'
import { readTaste, scheduleTasteLearning, toStylistTaste } from '../taste/service.js'
import { fixIsFree } from './fixes.js'
import { remixHistory } from './history.js'
import { reserveLookQuota } from './quota.js'
import {
  lookStorageKeys,
  planLooks,
  planRemix,
  startLookRender,
  startLookTeaser,
  startPieceRenders,
} from './service.js'
import { startTryOn } from './try-on.js'

// How far back an older locked look still gets drawn when it's seen.
const TEASER_BACKFILL_DAYS = 14

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

// A batch that spends the last credit is filled with locked looks up to this.
const LOCKED_BATCH = 3

const createSchema = z.object({
  occasion: z.string().trim().min(3).max(280),
  notes: z.string().trim().max(280).optional(),
  count: z.number().int().min(1).max(3).default(3),
})

const listQuerySchema = z.object({
  batchId: z.string().optional(),
  remixOf: z.string().optional(),
  collectionId: z.string().optional(),
  favorite: z.enum(['true']).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
})

const updateSchema = z.object({
  favorite: z.boolean().optional(),
})

const feedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
  aspects: z.array(z.enum(FEEDBACK_ASPECTS)).max(8).default([]),
  pieces: z
    .array(z.object({ index: z.number().int().min(0).max(7), vote: z.enum(['up', 'down']) }))
    .max(8)
    .default([]),
  note: z.string().trim().max(280).optional(),
})

const remixSchema = z.object({
  change: z.enum(['colors', 'season', 'dressier', 'casual', 'occasion', 'surprise', 'custom', 'fix']),
  detail: z.string().trim().max(200).optional(),
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
    const remixOf = toObjectId(parsed.data.remixOf)

    if (batchId) {
      filter.batchId = batchId
    }

    if (remixOf) {
      filter.remixOf = remixOf
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

    // Locked looks from before they were drawn ahead of time get drawn the
    // first time they're seen again, if recent; the page checks back.
    const backfillSince = Date.now() - TEASER_BACKFILL_DAYS * 24 * 60 * 60 * 1000

    for (const look of looks) {
      if (look.status === 'locked' && !look.teaser && look.createdAt.getTime() > backfillSince) {
        startLookTeaser(app, look._id)
        look.teaser = { status: 'processing', key: null, lockedKey: null }
      }
    }

    return {
      looks: await Promise.all(looks.map(serializeLook)),
      remaining: await remainingGenerations(app, userId, 'look'),
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

      // These were their last looks: the stylist designs more, shown with
      // their pieces but not drawn, so the offer comes with looks made for
      // this occasion rather than a generic "go Pro". Planning them is just
      // text. A batch fills up to three looks (a new account's one drawn
      // look comes with two locked ones), and always gets at least one.
      const billingUser = creditSpent ? await loadBillingUser(app, userId) : null
      const bonus = billingUser && billingState(billingUser).credits === 0 ? Math.max(1, LOCKED_BATCH - count) : 0
      let plan: Awaited<ReturnType<typeof planLooks>>

      try {
        plan = await planLooks({
          avatar,
          occasion,
          notes,
          count: count + bonus,
          taste: toStylistTaste(await readTaste(app, userId)),
        })
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Look planning failed')
        await releaseGenerations(app, userId, 'look', count)
        await refundCredits(app, userId, creditSpent ? count : 0)
        return reply
          .code(502)
          .send({ message: 'Our stylist could not plan this one. Please try again.' })
      }

      const rendered = Math.min(plan.looks.length, count)

      if (rendered < count) {
        await releaseGenerations(app, userId, 'look', count - rendered)
        await refundCredits(app, userId, creditSpent ? count - rendered : 0)
      }

      const now = new Date()
      const batchId = new ObjectId()
      const looks: LookDocument[] = plan.looks.map((lookPlan, index) => ({
        _id: new ObjectId(),
        userId,
        avatarId: avatar._id,
        batchId,
        occasion: {
          text: occasion,
          notes,
          dressCode: plan.dressCode,
          summary: plan.occasionSummary,
          asks: plan.asks,
        },
        plan: lookPlan,
        status: index < rendered ? 'processing' : 'locked',
        error: null,
        imageKey: null,
        creditSpent: index < rendered && creditSpent,
        collectionIds: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        readyAt: null,
      }))

      await app.collections.looks.insertMany(looks)

      for (const look of looks) {
        if (look.status === 'processing') {
          startLookRender(app, look._id)
        } else {
          // Drawn now and shown blurred: the look they'd unlock is already there.
          startLookTeaser(app, look._id)
        }
      }

      void trackServerEvent(app, {
        name: 'looks_styled',
        userId,
        props: {
          count: rendered,
          locked: looks.length - rendered,
          dress_code: looks[0]?.occasion.dressCode ?? 'unknown',
        },
      })

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

      return startTryOn(app, request, reply, { userId, avatar, photo, notes: parsed.data.notes || null })
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
        await requirePro(app, userId, 'Shopping the pieces')
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

  // The stylist's full read of one look (Pro). Kept on the look.
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
        await requirePro(app, userId, 'The full look analysis')
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
        await requirePro(app, userId, 'Store search')

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
        // A free fix stays free when it has to be drawn again.
        creditSpent = look.freeFix ? false : await spendCredits(app, userId, 1)
      } catch (error) {
        await releaseGenerations(app, userId, 'look', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      await app.collections.looks.updateOne(
        { _id: look._id },
        { $set: { status: 'processing', error: null, creditSpent, renderStartedAt: new Date(), updatedAt: new Date() } },
      )
      startLookRender(app, look._id)

      const updated = await app.collections.looks.findOne({ _id: look._id })

      return reply.code(202).send({ look: updated ? await serializeLook(updated) : null })
    },
  )

  // Draws a locked look (see POST /): one credit, like any other look. Out
  // of credits, the 402 opens the offer with this look waiting behind it.
  app.post(
    '/:id/unlock',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const lookId = toObjectId((request.params as { id?: string }).id)
      const look = lookId ? await app.collections.looks.findOne({ _id: lookId, userId }) : null

      if (!look) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      if (look.status !== 'locked') {
        return reply.code(409).send({ message: 'This look is already styled.' })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply.code(409).send({ message: 'Your avatar needs to be ready before styling looks.' })
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

      // Drawn ahead of time: it shows right away instead of rendering now.
      const teaser = look.teaser?.status === 'ready' && look.teaser.key ? look.teaser : null
      const now = new Date()

      // Claimed atomically, so a double tap draws (and charges) it once.
      const claimed = await app.collections.looks.updateOne(
        { _id: look._id, status: 'locked' },
        {
          $set: teaser
            ? { status: 'ready', error: null, imageKey: teaser.key, teaser: null, creditSpent, readyAt: now, updatedAt: now }
            : { status: 'processing', error: null, creditSpent, renderStartedAt: now, updatedAt: now },
        },
      )

      if (claimed.modifiedCount === 0) {
        await releaseGenerations(app, userId, 'look', 1)
        await refundCredits(app, userId, creditSpent ? 1 : 0)
        return reply.code(409).send({ message: 'This look is already styled.' })
      }

      if (teaser) {
        await (teaser.lockedKey ? storage.remove(teaser.lockedKey).catch(() => undefined) : undefined)
      } else {
        startLookRender(app, look._id)
      }

      void trackServerEvent(app, {
        name: 'look_unlocked',
        userId,
        props: { dress_code: look.occasion.dressCode, instant: Boolean(teaser) },
      })

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

    // Favorites teach taste too.
    if (parsed.data.favorite !== undefined) {
      await scheduleTasteLearning(app, userId)
    }

    return { look: await serializeLook(look) }
  })

  // What the person thought of a look. It teaches their taste profile, which
  // the stylist reads before every new look.
  app.post('/:id/feedback', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const parsed = parseBody(feedbackSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const look = lookId ? await app.collections.looks.findOne({ _id: lookId, userId }) : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    if (look.status === 'locked') {
      return reply.code(409).send({ message: 'Style this look first.' })
    }

    const { rating, aspects, pieces, note } = parsed.data
    const feedback: LookFeedback = {
      rating,
      aspects: [...new Set(aspects)],
      // One vote per piece, the last one wins.
      pieces: [
        ...new Map(
          pieces.filter((piece) => piece.index < look.plan.items.length).map((piece) => [piece.index, piece]),
        ).values(),
      ],
      note: note || null,
      at: new Date(),
    }
    const updated = await app.collections.looks.findOneAndUpdate(
      { _id: look._id },
      { $set: { feedback, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    await scheduleTasteLearning(app, userId)

    return { look: updated ? await serializeLook(updated) : null }
  })

  app.delete('/:id/feedback', async (request, reply) => {
    const userId = requireUserId(request)
    const lookId = toObjectId((request.params as { id?: string }).id)
    const look = lookId
      ? await app.collections.looks.findOneAndUpdate(
          { _id: lookId, userId },
          { $unset: { feedback: '' }, $set: { updatedAt: new Date() } },
          { returnDocument: 'after' },
        )
      : null

    if (!look) {
      return reply.code(404).send({ message: 'Look not found.' })
    }

    await scheduleTasteLearning(app, userId)

    return { look: await serializeLook(look) }
  })

  // A variant of a look: the same style with one change (new colors, another
  // season, dressier…), or 'fix', which restyles a look they disliked from
  // their feedback. One look, one credit, rendered in the background.
  app.post(
    '/:id/remix',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const lookId = toObjectId((request.params as { id?: string }).id)
      const parsed = parseBody(remixSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const base = lookId ? await app.collections.looks.findOne({ _id: lookId, userId }) : null

      if (!base) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      if (base.status === 'locked') {
        return reply.code(409).send({ message: 'Style this look first.' })
      }

      const { change } = parsed.data
      let detail = parsed.data.detail || null

      if ((change === 'occasion' || change === 'custom') && !detail) {
        return reply
          .code(400)
          .send({ message: change === 'occasion' ? 'Tell us the new occasion.' : 'Tell us what to change.' })
      }

      if (change === 'fix') {
        if (!base.feedback) {
          return reply.code(409).send({ message: 'Tell us what missed first.' })
        }

        detail = describeFeedback(base.plan, base.feedback)
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply.code(409).send({ message: 'Your avatar needs to be ready before styling looks.' })
      }

      const quota = await reserveLookQuota(app, userId, 1)

      if (!quota.ok) {
        return reply.code(quota.status).send(quota.body)
      }

      // A fix of a look that missed is on us (fixes.ts): claimed on that
      // look, so two taps can't take it twice.
      const freeFix =
        change === 'fix' &&
        fixIsFree(base) &&
        (await app.collections.looks.updateOne({ _id: base._id, freeFixAt: null }, { $set: { freeFixAt: new Date() } }))
          .modifiedCount === 1

      let creditSpent: boolean

      try {
        creditSpent = freeFix ? false : await spendCredits(app, userId, 1)
      } catch (error) {
        await releaseGenerations(app, userId, 'look', 1)

        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      let plan: Awaited<ReturnType<typeof planRemix>>

      try {
        // What they said about the looks this one came from still holds:
        // a chain of fixes adds their words up instead of forgetting them.
        const history = await remixHistory(base, (id) =>
          app.collections.looks.findOne(
            { _id: id, userId },
            { projection: { plan: 1, occasion: 1, feedback: 1, remix: 1, remixOf: 1 } },
          ),
        )

        plan = await planRemix({
          avatar,
          base,
          change,
          detail,
          taste: toStylistTaste(await readTaste(app, userId)),
          history,
        })
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Look remix failed')
        await releaseGenerations(app, userId, 'look', 1)
        await refundCredits(app, userId, creditSpent ? 1 : 0)

        if (freeFix) {
          await app.collections.looks.updateOne({ _id: base._id }, { $set: { freeFixAt: null } })
        }

        return reply.code(502).send({ message: 'Our stylist could not restyle this one. Please try again.' })
      }

      const [lookPlan] = plan.looks

      if (!lookPlan) {
        throw new Error('The stylist returned no looks.')
      }

      const now = new Date()
      const look: LookDocument = {
        _id: new ObjectId(),
        userId,
        avatarId: avatar._id,
        batchId: new ObjectId(),
        occasion: {
          text: change === 'occasion' && detail ? detail : base.occasion.text,
          notes: change === 'occasion' ? null : (base.occasion.notes ?? null),
          dressCode: plan.dressCode,
          summary: plan.occasionSummary,
          // What they asked for is still the original brief (or the new
          // occasion); the remix request itself is our wording, not theirs.
          asks: change === 'occasion' && detail ? [detail] : (base.occasion.asks ?? []),
        },
        plan: lookPlan,
        remixOf: base._id,
        remix: { change, detail: change === 'fix' ? null : detail },
        status: 'processing',
        error: null,
        imageKey: null,
        creditSpent,
        freeFix,
        freeFixes: (base.freeFixes ?? 0) + (freeFix ? 1 : 0),
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
