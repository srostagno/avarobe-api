import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { parseBody } from '../../utils/http.js'
import { userIdFromUnsubscribeToken } from './service.js'

const unsubscribeSchema = z.object({
  token: z.string().min(10).max(200),
  // false to opt back in from the same page.
  unsubscribe: z.boolean().default(true),
})

// The unsubscribe link in onboarding emails. It works without signing in:
// the token is the account id signed with the server secret. Account and
// security emails are not affected.
const lifecycleRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/unsubscribe',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(unsubscribeSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const userId = userIdFromUnsubscribeToken(parsed.data.token)

      if (!userId) {
        return reply.code(400).send({ message: 'This unsubscribe link is not valid.' })
      }

      const result = await app.collections.users.updateOne(
        { _id: userId },
        parsed.data.unsubscribe
          ? { $set: { emailTipsOptOutAt: new Date(), updatedAt: new Date() } }
          : { $set: { emailTipsOptOutAt: null, updatedAt: new Date() } },
      )

      if (result.matchedCount === 0) {
        return reply.code(404).send({ message: 'We could not find this account. It may have been deleted.' })
      }

      return { ok: true, subscribed: !parsed.data.unsubscribe }
    },
  )
}

export default lifecycleRoutes
