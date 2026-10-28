import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { parseBody } from '../../utils/http.js'
import { extractBearerToken } from '../../utils/tokens.js'
import { runGrowthQuery } from './queries.js'

// POST /internal/growth/query {name, params} → {rows}: the growth agent's
// reads (queries.ts) for when it runs in Anthropic's cloud, which reaches us
// by HTTPS only. Not registered at all (404) without GROWTH_API_TOKEN; with
// it, `Authorization: Bearer <GROWTH_API_TOKEN>`. The token is never logged.

const digest = (value: string) => createHash('sha256').update(value).digest()

// After the rate limit (onRequest), so wrong tokens count toward it.
async function growthToken(request: FastifyRequest, reply: FastifyReply) {
  const expected = env.GROWTH_API_TOKEN
  const token = extractBearerToken(request.headers.authorization)

  // Hashed first, so the comparison takes as long whatever the length.
  if (!expected || !token || !timingSafeEqual(digest(token), digest(expected))) {
    return reply.code(401).send({ message: 'Unauthorized' })
  }
}

const bodySchema = z
  .object({
    name: z.string().min(1).max(64),
    params: z.record(z.unknown()).default({}),
  })
  .strict()

const growthRoutes: FastifyPluginAsync = async (app) => {
  if (!env.GROWTH_API_TOKEN) {
    return
  }

  app.post(
    '/query',
    { preHandler: growthToken, bodyLimit: 512 * 1024, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseBody(bodySchema, request.body)

      if (!body.ok) {
        return reply.code(400).send({ message: body.message })
      }

      const result = await runGrowthQuery(app.collections, body.data.name, body.data.params)

      if (!result.ok) {
        return reply.code(400).send({ message: result.message })
      }

      request.log.info({ growthQuery: body.data.name }, 'Growth query')

      return { rows: result.rows }
    },
  )
}

export default growthRoutes
