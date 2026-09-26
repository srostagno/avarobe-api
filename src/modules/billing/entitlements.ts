import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { UserDocument } from '../../types/mongo.js'

// What a person can do. Free: the avatar (FREE_AVATAR_RUNS renders), their
// season and a few colors, and FREE_CREDITS looks. The Style Kit unlocks the
// full palette, reports, try-ons, pieces and stores, plus its credits.
// Looks and try-ons spend one credit each.

export type PaywallCode = 'needs_kit' | 'no_credits'

export class PaywallError extends Error {
  constructor(
    readonly code: PaywallCode,
    message: string,
  ) {
    super(message)
  }
}

const compEmails = () =>
  new Set(
    env.COMP_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )

type BillingFields = Pick<UserDocument, 'email' | 'credits' | 'styleKitUntil' | 'freeAvatarRuns'>

export function billingState(user: BillingFields) {
  const comp = compEmails().has(user.email.toLowerCase())
  const kitUntil = user.styleKitUntil ?? null
  const kitActive = comp || Boolean(kitUntil && kitUntil.getTime() > Date.now())

  return {
    comp,
    kitActive,
    kitUntil,
    everHadKit: comp || Boolean(kitUntil),
    credits: user.credits ?? env.FREE_CREDITS,
    freeAvatarRunsLeft: kitActive ? null : Math.max(0, env.FREE_AVATAR_RUNS - (user.freeAvatarRuns ?? 0)),
  }
}

export function serializeBilling(user: BillingFields) {
  const state = billingState(user)

  return {
    kitActive: state.kitActive,
    kitUntil: state.comp ? null : (state.kitUntil?.toISOString() ?? null),
    everHadKit: state.everHadKit,
    credits: state.credits,
    unlimited: state.comp,
    freeAvatarRunsLeft: state.freeAvatarRunsLeft,
  }
}

async function loadUser(app: FastifyInstance, userId: ObjectId) {
  const user = await app.collections.users.findOne(
    { _id: userId },
    { projection: { email: 1, credits: 1, styleKitUntil: 1, freeAvatarRuns: 1 } },
  )

  if (!user) {
    throw new PaywallError('needs_kit', 'Sign in again to continue.')
  }

  return user
}

export async function hasKit(app: FastifyInstance, userId: ObjectId) {
  return billingState(await loadUser(app, userId)).kitActive
}

export async function requireKit(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasKit(app, userId))) {
    throw new PaywallError('needs_kit', `${feature} comes with the Style Kit.`)
  }
}

// Takes `amount` credits atomically. Returns whether credits were actually
// spent (comp accounts don't spend), so failures know whether to refund.
export async function spendCredits(app: FastifyInstance, userId: ObjectId, amount: number) {
  const user = await loadUser(app, userId)

  if (billingState(user).comp) {
    return false
  }

  await app.collections.users.updateOne(
    { _id: userId, credits: { $exists: false } },
    { $set: { credits: env.FREE_CREDITS } },
  )

  const result = await app.collections.users.updateOne(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount }, $set: { updatedAt: new Date() } },
  )

  if (result.modifiedCount === 0) {
    const { kitActive, credits } = billingState(await loadUser(app, userId))

    const left = `${credits} credit${credits === 1 ? '' : 's'} left`

    throw new PaywallError(
      'no_credits',
      kitActive
        ? `You have ${left}. Top up to keep styling.`
        : credits > 0
          ? `You have ${left}. Ask for fewer looks, or get the Style Kit for more.`
          : 'You’ve used your free look. Get the Style Kit to keep styling.',
    )
  }

  return true
}

export async function refundCredits(app: FastifyInstance, userId: ObjectId, amount: number) {
  if (amount > 0) {
    await app.collections.users.updateOne({ _id: userId }, { $inc: { credits: amount } })
  }
}

// Avatar renders are free up to FREE_AVATAR_RUNS; the Style Kit lifts it.
export async function useAvatarRun(app: FastifyInstance, userId: ObjectId) {
  const user = await loadUser(app, userId)

  if (billingState(user).kitActive) {
    return
  }

  const result = await app.collections.users.updateOne(
    {
      _id: userId,
      $or: [{ freeAvatarRuns: { $exists: false } }, { freeAvatarRuns: { $lt: env.FREE_AVATAR_RUNS } }],
    },
    { $inc: { freeAvatarRuns: 1 } },
  )

  if (result.modifiedCount === 0) {
    throw new PaywallError('needs_kit', 'More avatar changes come with the Style Kit.')
  }
}

export function sendPaywall(reply: FastifyReply, error: PaywallError) {
  return reply.code(402).send({ message: error.message, code: error.code })
}
