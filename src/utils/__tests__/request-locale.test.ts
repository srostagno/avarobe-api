import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import Fastify from 'fastify'

import { localizeInstructions } from '../locale.js'
import { currentLocale, registerRequestLocale } from '../request-locale.js'

describe('the language of the request', () => {
  it('reaches the handler and the work it starts in the background', async () => {
    const app = Fastify()
    registerRequestLocale(app)
    let background: string | undefined

    app.get('/', async () => {
      const inHandler = currentLocale()
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          background = currentLocale()
          resolve()
        }, 5)
      })
      return { inHandler }
    })

    const pt = await app.inject({ url: '/', headers: { 'x-avarobe-locale': 'pt-BR' } })
    assert.equal(pt.json<{ inHandler: string }>().inHandler, 'pt-BR')
    assert.equal(background, 'pt-BR')

    const none = await app.inject({ url: '/' })
    assert.equal(none.json<{ inHandler: string }>().inHandler, 'en')
    await app.close()
  })

  it('asks the model for the language and keeps English instructions as they are', () => {
    const prompt = 'Write in plain, warm American English.'

    assert.equal(localizeInstructions(prompt, 'en'), prompt)
    assert.match(localizeInstructions(prompt, 'pt-BR'), /Brazilian Portuguese/)
    assert.doesNotMatch(localizeInstructions(prompt, 'es'), /American English/)
    assert.match(localizeInstructions(prompt, 'es'), /enum values \(season names included\)/)
  })
})
