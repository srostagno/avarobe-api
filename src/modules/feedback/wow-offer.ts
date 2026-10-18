import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { trackServerEvent } from '../analytics/service.js'
import { isAdmin } from '../billing/entitlements.js'

// Her first read of a studio (Oct 18, 2026, Pro plan phase 1, "half price
// at the wow moment"): Pro's first month at half price (feedback/rules
// PRO_HALF, applied at checkout), for 48 hours, once, to whoever never had
// Pro, a trial or the offer. Never to an admin's free access.
export const WOW_OFFER_HOURS = 48

export async function grantWowOffer(app: FastifyInstance, userId: ObjectId, from: 'face_age' | 'look_score' | 'hair_score') {
  const user = await app.collections.users.findOne({ _id: userId }, { projection: { email: 1, compPaused: 1, pro: 1, proTrialAt: 1, proHalfOffer: 1 } })

  if (!user || user.pro || user.proTrialAt || user.proHalfOffer || (isAdmin(user) && !user.compPaused)) {
    return false
  }

  const now = new Date()
  const given = { from, at: now, until: new Date(now.getTime() + WOW_OFFER_HOURS * 60 * 60 * 1000), usedAt: null }
  const set = await app.collections.users.updateOne({ _id: userId, proHalfOffer: { $in: [null] } }, { $set: { proHalfOffer: given } })

  if (set.modifiedCount) {
    void trackServerEvent(app, { name: 'pro_half_offer_given', userId, props: { from } })
  }

  return set.modifiedCount > 0
}
