import { buildApp } from './app.js'
import { env } from './config/env.js'
import { startCreditRefills } from './modules/billing/stripe.js'
import { startLifecycleEmails } from './modules/lifecycle/service.js'
import { resumeTasteLearning } from './modules/taste/service.js'
import { failStaleJobs } from './utils/stale-jobs.js'

async function main() {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null

  try {
    app = await buildApp()
    await failStaleJobs(app)
    await resumeTasteLearning(app)
    await app.listen({ host: env.HOST, port: env.PORT })
    app.log.info(`avarobe-api listening on http://${env.HOST}:${env.PORT}`)
    startLifecycleEmails(app)
    startCreditRefills(app)
  } catch (error) {
    if (app) {
      app.log.error(error, 'Failed to start avarobe-api')
    } else {
      console.error('Failed to start avarobe-api:', error)
    }

    process.exit(1)
  }
}

void main()
