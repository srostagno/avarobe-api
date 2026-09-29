import type { FastifyPluginAsync } from 'fastify'

import { parseBody } from '../../utils/http.js'
import { optionalUserId, recordWebEvents, trackSchema } from './service.js'

// First-party analytics from the web. The browser sends batches as
// text/plain (sendBeacon and keepalive fetch can't use JSON across origins
// without a preflight), so a string body is parsed here.
const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/track',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } }, bodyLimit: 64 * 1024 },
    async (request, reply) => {
      let body: unknown = request.body

      if (typeof body === 'string') {
        try {
          body = JSON.parse(body)
        } catch {
          return reply.code(400).send({ message: 'Invalid JSON.' })
        }
      }

      const parsed = parseBody(trackSchema, body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      await recordWebEvents(app, parsed.data, await optionalUserId(request))

      return reply.code(204).send()
    },
  )
}

export default analyticsRoutes
