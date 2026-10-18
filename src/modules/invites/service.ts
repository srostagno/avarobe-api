import { randomInt } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { trackServerEvent } from '../analytics/service.js'
import { isAdmin } from '../billing/entitlements.js'
import { unlockTeaser } from '../teasers/service.js'

// "Invite a friend and your perfect haircut is yours" (Oct 18, 2026, growth):
// her invite link, a friend who signs up through it, and that friend's first
// read (a Hair Score, Look Score or Face Age), which unlocks one of her
// teasers without Pro: the oldest one still locked, or the next one drawn.
// Only the picture; everything else stays Pro's. Up to INVITE_REWARD_CAP
// friends count; never her own account.

export const INVITE_REWARD_CAP = 3
const CLAIM_WITHIN_MS = 3 * 24 * 60 * 60 * 1000
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const INVITE_CODE = /^[a-hjkmnp-z2-9]{8}$/

const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

// Her code, made the first time she asks for it.
export async function inviteOf(app: FastifyInstance, userId: ObjectId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const user = await app.collections.users.findOne({ _id: userId }, { projection: { invite: 1 } })

    if (!user) {
      return null
    }

    if (user.invite?.code) {
      return user.invite
    }

    const invite = { code: newCode(), createdAt: new Date(), rewards: 0, pending: 0 }

    try {
      const set = await app.collections.users.updateOne({ _id: userId, 'invite.code': { $exists: false } }, { $set: { invite } })

      if (set.modifiedCount) {
        void trackServerEvent(app, { name: 'referral_link_created', userId })
        return invite
      }
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error
      }
    }
  }

  return null
}

// A new account that came through a friend's link: who invited her. Only
// once, only within a few days of signing up, never her own code.
export async function claimInvite(app: FastifyInstance, userId: ObjectId, code: string, now = new Date()) {
  if (!INVITE_CODE.test(code)) {
    return false
  }

  const [user, inviter] = await Promise.all([
    app.collections.users.findOne({ _id: userId }, { projection: { createdAt: 1, invitedBy: 1, email: 1, compPaused: 1 } }),
    app.collections.users.findOne({ 'invite.code': code }, { projection: { _id: 1 } }),
  ])

  if (!user || !inviter || inviter._id.equals(userId) || user.invitedBy || isAdmin(user) || now.getTime() - user.createdAt.getTime() > CLAIM_WITHIN_MS) {
    return false
  }

  const set = await app.collections.users.updateOne(
    { _id: userId, invitedBy: { $exists: false } },
    { $set: { invitedBy: { userId: inviter._id, code, at: now, rewardedAt: null } } },
  )

  if (set.modifiedCount) {
    void trackServerEvent(app, { name: 'referral_signup', userId, props: { inviter: inviter._id.toString() } })
  }

  return set.modifiedCount > 0
}

// Her first read is done: the friend who invited her gets one teaser, once.
export async function rewardInviter(app: FastifyInstance, userId: ObjectId, now = new Date()) {
  try {
    const claimed = await app.collections.users.findOneAndUpdate(
      { _id: userId, 'invitedBy.rewardedAt': null, 'invitedBy.userId': { $exists: true } },
      { $set: { 'invitedBy.rewardedAt': now } },
    )
    const inviterId = claimed?.invitedBy?.userId

    if (!inviterId) {
      return false
    }

    const counted = await app.collections.users.updateOne(
      { _id: inviterId, 'invite.rewards': { $lt: INVITE_REWARD_CAP } },
      { $inc: { 'invite.rewards': 1 } },
    )

    if (!counted.modifiedCount) {
      return false
    }

    const teaser = await app.collections.teasers.findOne({ userId: inviterId, status: 'ready', unlockedAt: null }, { sort: { createdAt: 1 } })

    if (teaser) {
      await unlockTeaser(app, teaser)
    } else {
      // None drawn yet: the next one is hers (teasers/service takePendingInvite).
      await app.collections.users.updateOne({ _id: inviterId }, { $inc: { 'invite.pending': 1 } })
    }

    void trackServerEvent(app, { name: 'referral_reward', userId: inviterId, props: { friend: userId.toString(), unlocked: Boolean(teaser) } })
    return true
  } catch (error) {
    app.log.error({ err: error, userId: userId.toString() }, 'Invite reward failed')
    return false
  }
}
