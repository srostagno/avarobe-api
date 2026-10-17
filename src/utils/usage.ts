import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../config/env.js'
import { limitMessages } from '../i18n/limits.js'
import { trackServerEvent } from '../modules/analytics/service.js'
import { isAdmin } from '../modules/billing/entitlements.js'
import type { UsageKind } from '../types/mongo.js'
import { isDuplicateKeyError } from './mongo-errors.js'
import { toObjectId } from './object-id.js'
import { timeZoneFor } from './timezones.js'

const LIMITS: Record<UsageKind, () => number> = {
  avatar: () => env.DAILY_AVATAR_LIMIT,
  look: () => env.DAILY_LOOK_LIMIT,
  pieces: () => env.DAILY_PIECES_LIMIT,
  shop: () => env.DAILY_SHOP_SEARCH_LIMIT,
  report: () => env.DAILY_REPORT_LIMIT,
  hair: () => env.DAILY_HAIR_LIMIT,
  image: () => env.AI_DAILY_IMAGE_LIMIT,
  score: () => env.DAILY_SCORE_LIMIT,
  makeup: () => env.DAILY_MAKEUP_LIMIT,
}

// The kinds whose generations are new pictures: each one also counts toward
// the day's images (AI_DAILY_IMAGE_LIMIT) unless the call says it's text (a
// hair read, a color read: { image: false }). Color checks reserve 'image'
// on their own. Reserving and releasing take the same option, so every path
// that gives a generation back gives its picture back too.
export const IMAGE_KINDS: ReadonlySet<UsageKind> = new Set<UsageKind>(['look', 'hair', 'avatar', 'makeup'])

type ImageOption = { image?: boolean }

// `timeZone` (the day's pictures only): where they are, for when more come back.
export type UsageReservation = { ok: true } | { ok: false; reason: 'kind' | 'images'; left: number; timeZone?: string }

function limitFor(kind: UsageKind) {
  return LIMITS[kind]()
}

function counterId(userId: ObjectId, kind: UsageKind, day: string) {
  return `${userId.toString()}:${kind}:${day}`
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

const counts = (kind: UsageKind, options: ImageOption = {}) => kind !== 'image' && (options.image ?? IMAGE_KINDS.has(kind))

function newCounter(userId: ObjectId, kind: UsageKind, day: string) {
  return { userId, kind, day, expireAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }
}

// Atomically reserves `amount` of one counter for today. Returns false when
// the daily limit would be exceeded. The conditional upsert fails with a
// duplicate-key error when the counter exists but has no room left.
async function reserveCounter(app: FastifyInstance, userId: ObjectId, kind: UsageKind, amount: number) {
  const limit = limitFor(kind)

  if (amount > limit) {
    return false
  }

  const day = utcDay()

  try {
    await app.collections.usageCounters.updateOne(
      { _id: counterId(userId, kind, day), count: { $lte: limit - amount } },
      { $inc: { count: amount }, $setOnInsert: newCounter(userId, kind, day) },
      { upsert: true },
    )

    return true
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false
    }

    throw error
  }
}

async function releaseCounter(app: FastifyInstance, userId: ObjectId, kind: UsageKind, amount: number) {
  await app.collections.usageCounters.updateOne(
    { _id: counterId(userId, kind, utcDay()), count: { $gte: amount } },
    { $inc: { count: -amount } },
  )
}

// Comp accounts (the founder, testers) aren't held to the day's pictures:
// counted past it, so releasing stays even. Read only when the cap is hit.
async function reserveImages(app: FastifyInstance, userId: ObjectId, amount: number): Promise<UsageReservation> {
  if (await reserveCounter(app, userId, 'image', amount)) {
    return { ok: true }
  }

  const user = await app.collections.users.findOne({ _id: userId }, { projection: { email: 1, compPaused: 1, location: 1 } })

  if (user && isAdmin(user) && !user.compPaused) {
    const day = utcDay()

    await app.collections.usageCounters.updateOne(
      { _id: counterId(userId, 'image', day) },
      { $inc: { count: amount }, $setOnInsert: newCounter(userId, 'image', day) },
      { upsert: true },
    )

    return { ok: true }
  }

  return { ok: false, reason: 'images', left: await remainingGenerations(app, userId, 'image'), timeZone: timeZoneFor(user?.location) }
}

// Reserves `amount` generations of a kind for today, and as many of the
// day's pictures for the kinds that draw (IMAGE_KINDS), pictures first. Says
// which limit stopped it and how many are left of that one.
export async function reserveUsage(
  app: FastifyInstance,
  userId: ObjectId,
  kind: UsageKind,
  amount: number,
  options: ImageOption = {},
): Promise<UsageReservation> {
  if (kind === 'image') {
    return reserveImages(app, userId, amount)
  }

  const image = counts(kind, options)

  if (image) {
    const images = await reserveImages(app, userId, amount)

    if (!images.ok) {
      return images
    }
  }

  if (await reserveCounter(app, userId, kind, amount)) {
    return { ok: true }
  }

  if (image) {
    await releaseCounter(app, userId, 'image', amount)
  }

  return { ok: false, reason: 'kind', left: await remainingGenerations(app, userId, kind) }
}

// reserveUsage, as whether it went.
export async function reserveGenerations(app: FastifyInstance, userId: ObjectId, kind: UsageKind, amount: number, options: ImageOption = {}) {
  return (await reserveUsage(app, userId, kind, amount, options)).ok
}

// Gives generations back when a render fails, so errors on our side don't
// eat into the person's daily allowance, with their pictures (same option
// as the reservation).
export async function releaseGenerations(app: FastifyInstance, userId: ObjectId, kind: UsageKind, amount: number, options: ImageOption = {}) {
  await releaseCounter(app, userId, kind, amount)

  if (counts(kind, options)) {
    await releaseCounter(app, userId, 'image', amount)
  }
}

export async function remainingGenerations(app: FastifyInstance, userId: ObjectId, kind: UsageKind) {
  const counter = await app.collections.usageCounters.findOne({
    _id: counterId(userId, kind, utcDay()),
  })

  return Math.max(0, limitFor(kind) - (counter?.count ?? 0))
}

// Counted for the admin: a cap that stopped someone, and where.
export function trackCapHit(app: FastifyInstance, userId: ObjectId | null, cap: 'images' | 'avatar_month' | 'held_credits', route: string) {
  void trackServerEvent(app, { name: 'usage_cap_hit', userId, props: { cap, route } })
}

// The 429 for the day's pictures: when more come back on their clock, or
// how many still fit (`needed`: a batch that can't be smaller, an event).
export function imageLimitBody(left: number, options: { timeZone?: string; needed?: number } = {}) {
  return {
    code: 'daily_image_limit',
    message: limitMessages(undefined, options.timeZone).images(env.AI_DAILY_IMAGE_LIMIT, left, options.needed),
    left,
  }
}

// A reservation that didn't go: the day's pictures in their words, or the
// kind's own limit (`otherwise`, as each route has always said it).
export function dailyLimitReply(reply: FastifyReply, result: Extract<UsageReservation, { ok: false }>, otherwise: Record<string, unknown>) {
  if (result.reason === 'images') {
    trackCapHit(reply.server, toObjectId(reply.request.authUserId), 'images', reply.request.routeOptions.url ?? '')
    return reply.code(429).send(imageLimitBody(result.left, { timeZone: result.timeZone }))
  }

  return reply.code(429).send(otherwise)
}
