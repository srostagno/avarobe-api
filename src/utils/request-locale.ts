import { AsyncLocalStorage } from 'node:async_hooks'

import type { FastifyInstance } from 'fastify'

import { type Locale, requestLocale } from './locale.js'

// The language of the request being handled, for code deep inside it (the AI
// calls) that has no request at hand. Work a request starts in the
// background (a color read, a report) inherits it; timers and boot jobs
// have none and write in English.
const store = new AsyncLocalStorage<Locale>()

export function currentLocale(): Locale | undefined {
  return store.getStore()
}

export function registerRequestLocale(app: FastifyInstance) {
  app.addHook('onRequest', (request, _reply, done) => {
    store.run(requestLocale(request), done)
  })
}

// For tests and jobs that know whose work it is.
export function withLocale<T>(locale: Locale, run: () => T): T {
  return store.run(locale, run)
}
