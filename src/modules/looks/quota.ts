import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { imageLimitBody, reserveUsage, trackCapHit } from '../../utils/usage.js'

type QuotaResult = { ok: true } | { ok: false; status: 429; body: { message: string; code?: string; left?: number } }

// The daily fair-use cap. It's the same for every plan: credits are the real
// limit, and running out of them is what shows the upgrade. (A per-plan cap
// once blocked free accounts that still had credits.) Each look is also one
// of the day's new pictures (AI_DAILY_IMAGE_LIMIT), except a locked look
// whose picture was drawn ahead of time ({ image: false }).
export async function reserveLookQuota(
  app: FastifyInstance,
  userId: ObjectId,
  amount: number,
  options: { image?: boolean; route?: string } = {},
): Promise<QuotaResult> {
  const reserved = await reserveUsage(app, userId, 'look', amount, { image: options.image })

  if (reserved.ok) {
    return { ok: true }
  }

  if (reserved.reason === 'images') {
    trackCapHit(app, userId, 'images', options.route ?? 'looks')
    return { ok: false, status: 429, body: imageLimitBody(reserved.left) }
  }

  const remaining = reserved.left

  return {
    ok: false,
    status: 429,
    body: {
      message:
        remaining > 0
          ? `You can style ${remaining} more look${remaining === 1 ? '' : 's'} today. Ask for fewer, or come back tomorrow.`
          : `You’ve styled ${env.DAILY_LOOK_LIMIT} looks today. Come back tomorrow; your credits will be waiting.`,
    },
  }
}
