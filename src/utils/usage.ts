import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../config/env.js'
import type { UsageKind } from '../types/mongo.js'
import { isDuplicateKeyError } from './mongo-errors.js'

const LIMITS: Record<UsageKind, () => number> = {
  avatar: () => env.DAILY_AVATAR_LIMIT,
  look: () => env.DAILY_LOOK_LIMIT,
  pieces: () => env.DAILY_PIECES_LIMIT,
  shop: () => env.DAILY_SHOP_SEARCH_LIMIT,
  report: () => env.DAILY_REPORT_LIMIT,
}

function limitFor(kind: UsageKind) {
  return LIMITS[kind]()
}

function counterId(userId: ObjectId, kind: UsageKind, day: string) {
  return `${userId.toString()}:${kind}:${day}`
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

// Atomically reserves `amount` generations for today. Returns false when the
// daily limit would be exceeded. The conditional upsert fails with a
// duplicate-key error when the counter exists but has no room left.
export async function reserveGenerations(
  app: FastifyInstance,
  userId: ObjectId,
  kind: UsageKind,
  amount: number,
  // Overrides the kind's default limit (looks depend on the plan).
  limitOverride?: number,
) {
  const limit = limitOverride ?? limitFor(kind)

  if (amount > limit) {
    return false
  }

  const day = utcDay()

  try {
    await app.collections.usageCounters.updateOne(
      { _id: counterId(userId, kind, day), count: { $lte: limit - amount } },
      {
        $inc: { count: amount },
        $setOnInsert: {
          userId,
          kind,
          day,
          expireAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
      },
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

// Gives generations back when a render fails, so errors on our side don't
// eat into the person's daily allowance.
export async function releaseGenerations(
  app: FastifyInstance,
  userId: ObjectId,
  kind: UsageKind,
  amount: number,
) {
  await app.collections.usageCounters.updateOne(
    { _id: counterId(userId, kind, utcDay()), count: { $gte: amount } },
    { $inc: { count: -amount } },
  )
}

export async function remainingGenerations(
  app: FastifyInstance,
  userId: ObjectId,
  kind: UsageKind,
  limitOverride?: number,
) {
  const counter = await app.collections.usageCounters.findOne({
    _id: counterId(userId, kind, utcDay()),
  })

  return Math.max(0, (limitOverride ?? limitFor(kind)) - (counter?.count ?? 0))
}
