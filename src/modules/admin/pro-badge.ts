import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { UserDocument } from '../../types/mongo.js'
import { PRO_LIVE_STATUSES, proIsLive } from '../billing/entitlements.js'

// Who has Pro, on the admin's avatars and reports (Silvio, Oct 16, 2026):
// the plan, and whether it's running, in its trial, a failed renewal still
// in its grace days, set to cancel at the period's end, or over. Null:
// never subscribed.
export type ProBadge = {
  plan: 'monthly' | 'annual'
  state: 'active' | 'trial' | 'past_due' | 'canceling' | 'ended'
  until: Date | null
}

export function proBadge(pro: UserDocument['pro'], now = Date.now()): ProBadge | null {
  if (!pro) {
    return null
  }

  const plan = pro.interval === 'year' ? 'annual' : 'monthly'

  if (!proIsLive(pro, now)) {
    return { plan, state: 'ended', until: pro.periodEnd }
  }

  const state = pro.status === 'trialing' ? 'trial' : pro.status === 'past_due' ? 'past_due' : pro.cancelAtPeriodEnd ? 'canceling' : 'active'

  return { plan, state, until: pro.periodEnd }
}

// The accounts with Pro running now (a short list).
export async function liveProIds(app: FastifyInstance): Promise<ObjectId[]> {
  const users = await app.collections.users
    .find({ 'pro.status': { $in: [...PRO_LIVE_STATUSES] } }, { projection: { pro: 1 } })
    .toArray()

  return users.filter((user) => proIsLive(user.pro ?? null)).map((user) => user._id)
}
