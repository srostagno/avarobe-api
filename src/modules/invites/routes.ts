import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { parseBody } from '../../utils/http.js'
import { INVITE_CODE, INVITE_REWARD_CAP, claimInvite, inviteOf } from './service.js'

const claimSchema = z.object({ code: z.string().regex(INVITE_CODE) })

// Her invite link, and the claim of a new account that came through one
// (modules/invites/service.ts).
const inviteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.post('/', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const invite = await inviteOf(app, requireUserId(request))

    if (!invite) {
      return reply.code(503).send({ message: 'Try again in a moment.' })
    }

    return { code: invite.code, rewards: invite.rewards, cap: INVITE_REWARD_CAP }
  })

  app.post('/claim', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = parseBody(claimSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    return { claimed: await claimInvite(app, requireUserId(request), parsed.data.code) }
  })
}

export default inviteRoutes
