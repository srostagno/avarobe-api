import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { dailyLimitReply, releaseGenerations, reserveUsage } from '../../utils/usage.js'
import { AvatarCapError, PaywallError, type AvatarRun, releaseAvatarRun, sendAvatarCap, sendPaywall, useAvatarRun } from '../billing/entitlements.js'

// `code` tells the day's limit from the per-minute rate limit (also a 429),
// so the web stops trying again by itself only for this one.
export const avatarLimitBody = () => ({
  code: 'daily_limit',
  message: `You can create or adjust your avatar ${env.DAILY_AVATAR_LIMIT} times a day. Try again tomorrow.`,
})

// What one avatar render takes before it starts (create, redo, adjust, a
// haircut on the avatar): one of the day's avatar renders and new pictures,
// then a free render or one of the Pro month's (billing useAvatarRun).
// Anything it can't take is answered here: the day's limit or the Pro
// month's (429), the offer (402, `offer` in place of the generic one).
export async function takeAvatarRender(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: ObjectId,
  offer?: PaywallError,
): Promise<{ ok: true; run: AvatarRun } | { ok: false; sent: FastifyReply }> {
  const reserved = await reserveUsage(app, userId, 'avatar', 1)

  if (!reserved.ok) {
    return { ok: false, sent: dailyLimitReply(reply, reserved, avatarLimitBody()) }
  }

  try {
    return { ok: true, run: await useAvatarRun(app, userId) }
  } catch (error) {
    await releaseGenerations(app, userId, 'avatar', 1)

    if (error instanceof AvatarCapError) {
      return { ok: false, sent: sendAvatarCap(reply, error) }
    }

    if (error instanceof PaywallError) {
      return { ok: false, sent: sendPaywall(reply, offer ?? error) }
    }

    throw error
  }
}

// A render taken but never started (an upload or the database failed before
// its job did): the day's avatar render and picture, and the Pro month's
// render, given back. Once the job runs, it gives them back itself.
export async function giveBackAvatarRender(app: FastifyInstance, userId: ObjectId, run: AvatarRun) {
  await releaseGenerations(app, userId, 'avatar', 1)
  await releaseAvatarRun(app, userId, run)
}

// Runs what comes between taking a render and starting its job, giving the
// render back if it throws.
export async function beforeAvatarJob<T>(app: FastifyInstance, userId: ObjectId, run: AvatarRun, step: () => Promise<T>) {
  try {
    return await step()
  } catch (error) {
    await giveBackAvatarRender(app, userId, run).catch(() => undefined)
    throw error
  }
}
