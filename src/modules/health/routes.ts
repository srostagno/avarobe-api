import type { FastifyPluginAsync } from 'fastify'

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    await app.mongoDb.command({ ping: 1 })

    return { ok: true, service: 'avarobe-api' }
  })
}

export default healthRoutes
