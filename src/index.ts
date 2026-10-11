import { buildApp } from './app.js'
import { env } from './config/env.js'
import { startGuestCleanup } from './modules/auth/guests.js'
import { startColorRetries } from './modules/avatar/retry.js'
import { startCreditRefills } from './modules/billing/stripe.js'
import { startLifecycleEmails } from './modules/lifecycle/service.js'
import { watchOpenAi } from './modules/ops/alerts.js'
import { resumeTasteLearning } from './modules/taste/service.js'
import { failStaleJobs } from './utils/stale-jobs.js'

async function main() {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null

  try {
    app = await buildApp()
    // OpenAI out of credits (or refusing the key) alerts the founder, from
    // any feature.
    watchOpenAi(app)

    if (process.env.AI_FAULT && env.NODE_ENV === 'production') {
      app.log.warn('AI_FAULT is set but ignored in production')
    } else if (env.AI_FAULT) {
      app.log.warn({ fault: env.AI_FAULT }, 'AI_FAULT: every OpenAI call fails on purpose (development)')
    }

    await failStaleJobs(app)
    await resumeTasteLearning(app)
    await app.listen({ host: env.HOST, port: env.PORT })
    app.log.info(`avarobe-api listening on http://${env.HOST}:${env.PORT}`)
    startLifecycleEmails(app)
    startCreditRefills(app)
    startGuestCleanup(app)
    startColorRetries(app)
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
