import { buildApp } from './app.js'
import { env } from './config/env.js'
import { failStaleJobs } from './utils/stale-jobs.js'

async function main() {
  const app = await buildApp()

  try {
    await failStaleJobs(app)
    await app.listen({ host: env.HOST, port: env.PORT })
    app.log.info(`avarobe-api listening on http://${env.HOST}:${env.PORT}`)
  } catch (error) {
    app.log.error(error, 'Failed to start avarobe-api')
    process.exit(1)
  }
}

void main()
