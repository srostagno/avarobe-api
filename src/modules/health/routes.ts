import { execFileSync } from 'node:child_process'
import type { FastifyPluginAsync } from 'fastify'

// The commit this process runs, read once at boot, so a deploy (and the
// growth agent) can tell which code is live. GIT_SHA wins when the host sets
// it; null when neither is there.
const commit = (() => {
  if (process.env.GIT_SHA) {
    return process.env.GIT_SHA.slice(0, 7)
  }

  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
})()

const startedAt = new Date().toISOString()

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    await app.mongoDb.command({ ping: 1 })

    return { ok: true, service: 'avarobe-api', commit, startedAt }
  })
}

export default healthRoutes
