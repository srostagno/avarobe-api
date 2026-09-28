import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { parseBody } from '../../utils/http.js'
import { recordArrival } from './service.js'

const text = (max: number) => z.string().trim().max(max).optional().nullable()

const arrivalSchema = z.object({
  stage: z.enum(['arrived', 'loaded']),
  // Already hashed by the web (never the raw fbclid).
  click: z.string().regex(/^[a-f0-9]{32}$/).optional().nullable(),
  path: z.string().max(200).regex(/^\//),
  campaign: text(120),
  content: text(120),
  inApp: z.boolean().default(false),
  mobile: z.boolean().default(false),
})

// Visits from ads, reported by the web (its middleware when the request
// arrives, the page once it runs). Public and anonymous: no cookies, no
// account, nothing that names a person.
const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/arrival',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(arrivalSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const data = parsed.data
      await recordArrival(app, {
        stage: data.stage,
        click: data.click ?? null,
        path: data.path,
        campaign: data.campaign ?? null,
        content: data.content ?? null,
        inApp: data.inApp,
        mobile: data.mobile,
      })

      return reply.code(204).send()
    },
  )
}

export default eventRoutes
