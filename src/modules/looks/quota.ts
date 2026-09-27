import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { remainingGenerations, reserveGenerations } from '../../utils/usage.js'

type QuotaResult = { ok: true } | { ok: false; status: 429; body: { message: string } }

// The daily fair-use cap. It's the same for every plan: credits are the real
// limit, and running out of them is what shows the upgrade. (A per-plan cap
// once blocked free accounts that still had credits.)
export async function reserveLookQuota(app: FastifyInstance, userId: ObjectId, amount: number): Promise<QuotaResult> {
  if (await reserveGenerations(app, userId, 'look', amount)) {
    return { ok: true }
  }

  const remaining = await remainingGenerations(app, userId, 'look')

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
