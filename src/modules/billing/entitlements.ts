import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { UserDocument } from '../../types/mongo.js'

// What a person can do. Free: the avatar (FREE_AVATAR_RUNS renders), their
// season and a few colors, and FREE_CREDITS looks. The Color Report unlocks
// the full palette and color report for good. The Style Kit (or an active
// Plus subscription) unlocks everything: reports, try-ons, pieces, stores.
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

type BillingFields = Pick<
  UserDocument,
  'email' | 'credits' | 'styleKitUntil' | 'colorReportAt' | 'plus' | 'freeAvatarRuns' | 'compPaused'
>

export function isAdmin(user: Pick<UserDocument, 'email'>) {
  return compEmails().has(user.email.toLowerCase())
}

// Admin accounts, to leave them out of numbers and reviews.
export async function adminUserIds(app: FastifyInstance): Promise<ObjectId[]> {
  const users = await app.collections.users
    .find({ email: { $in: [...compEmails()] } }, { projection: { _id: 1 } })
    .toArray()

  return users.map((user) => user._id)
}

const DAY_MS = 24 * 60 * 60 * 1000
// A failed renewal gets a few days while Stripe retries the card.
const PLUS_GRACE_MS = 3 * DAY_MS
const PLUS_LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function billingState(user: BillingFields) {
  const now = Date.now()
  const admin = isAdmin(user)
  // An admin can switch the free Kit off to see the app as a customer does.
  const comp = admin && !user.compPaused
  const kitUntil = user.styleKitUntil ?? null
  const plus = user.plus ?? null
  const plusActive = Boolean(
    plus && PLUS_LIVE_STATUSES.has(plus.status) && plus.periodEnd && plus.periodEnd.getTime() + PLUS_GRACE_MS > now,
  )
  const kitActive = comp || plusActive || Boolean(kitUntil && kitUntil.getTime() > now)
  const colorReportAt = user.colorReportAt ?? null
  const everHadKit = comp || Boolean(kitUntil) || Boolean(plus)
  // The Color Report counts toward the Kit for a while after buying it.
  const kitUpgradeUntil =
    colorReportAt && !everHadKit ? new Date(colorReportAt.getTime() + env.KIT_UPGRADE_WINDOW_DAYS * DAY_MS) : null

  return {
    admin,
    comp,
    kitActive,
    kitUntil,
    everHadKit,
    plus,
    plusActive,
    colorAccess: kitActive || Boolean(colorReportAt),
    colorReport: Boolean(colorReportAt),
    kitUpgradeUntil: kitUpgradeUntil && kitUpgradeUntil.getTime() > now ? kitUpgradeUntil : null,
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
    colorReport: state.colorReport,
    colorAccess: state.colorAccess,
    kitUpgradeUntil: state.kitUpgradeUntil?.toISOString() ?? null,
    plus: state.plus
      ? {
          active: state.plusActive,
          status: state.plus.status,
          periodEnd: state.plus.periodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: state.plus.cancelAtPeriodEnd,
        }
      : null,
    credits: state.credits,
    unlimited: state.comp,
    freeAvatarRunsLeft: state.freeAvatarRunsLeft,
    admin: state.admin,
    testingAsCustomer: state.admin && !state.comp,
  }
}

const BILLING_PROJECTION = {
  email: 1,
  credits: 1,
  styleKitUntil: 1,
  colorReportAt: 1,
  plus: 1,
  freeAvatarRuns: 1,
  compPaused: 1,
}

export async function loadBillingUser(app: FastifyInstance, userId: ObjectId) {
  return app.collections.users.findOne({ _id: userId }, { projection: BILLING_PROJECTION })
}

async function loadUser(app: FastifyInstance, userId: ObjectId) {
  const user = await loadBillingUser(app, userId)

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

// The full palette and color report: Style Kit or Color Report.
export async function hasColorAccess(app: FastifyInstance, userId: ObjectId) {
  return billingState(await loadUser(app, userId)).colorAccess
}

export async function requireColorAccess(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasColorAccess(app, userId))) {
    throw new PaywallError('needs_kit', `${feature} comes with the Style Kit or the Color Report.`)
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
          : 'You’ve used your free looks. Get the Style Kit to keep styling.',
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
