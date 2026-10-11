import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { env } from '../../../config/env.js'
import { esMessages } from '../../../i18n/messages.es.js'
import { ptBrMessages } from '../../../i18n/messages.pt-BR.js'
import {
  OpenAiRequestError,
  classifyAiError,
  createStructuredResponse,
  generateImageFromReferences,
  onOpenAiError,
  redactAiMessage,
} from '../../../utils/openai.js'
import { PROVIDER_CODES, publicReason, retryDelay } from '../failures.js'

// OpenAI's reply on 11-Oct-2026, when the account ran out of credits.
const INCIDENT = {
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    param: null,
    code: 'credit_balance_exhausted',
  },
}

const saved = { fetch: globalThis.fetch, key: env.OPENAI_API_KEY, fault: env.AI_FAULT, nodeEnv: env.NODE_ENV }
let calls = 0
let heard: OpenAiRequestError[] = []

function reply(make: () => Response | Promise<Response>) {
  globalThis.fetch = async () => {
    calls += 1
    return make()
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const ask = () =>
  createStructuredResponse<{ ok: boolean }>({
    instructions: 'Answer.',
    content: [{ type: 'input_text', text: 'Hi.' }],
    schemaName: 'test',
    schema: {},
  })

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('expected the call to fail')
}

beforeEach(() => {
  calls = 0
  heard = []
  env.OPENAI_API_KEY = 'sk-test-not-a-key'
  env.AI_FAULT = undefined
  onOpenAiError((error) => heard.push(error))
})

afterEach(() => {
  globalThis.fetch = saved.fetch
  env.OPENAI_API_KEY = saved.key
  env.AI_FAULT = saved.fault
  env.NODE_ENV = saved.nodeEnv
  onOpenAiError(() => undefined)
})

describe('OpenAI errors', () => {
  it('reads the exact 11-Oct-2026 reply as no credits, and tells the listener', async () => {
    reply(() => json(429, INCIDENT))
    const error = await failure(ask())
    assert.ok(error instanceof OpenAiRequestError)
    assert.equal(error.statusCode, 429)
    assert.equal(error.code, 'credit_balance_exhausted')
    assert.equal(error.type, 'insufficient_quota')
    assert.equal(classifyAiError(error), 'no_credits')
    assert.deepEqual(heard, [error])
  })

  it('tells a plain rate limit apart, with how long OpenAI asked to wait', async () => {
    reply(() => json(429, { error: { message: 'Rate limit reached.', code: 'rate_limit_exceeded', type: 'requests' } }, { 'retry-after-ms': '1500' }))
    const limited = await failure(ask())
    assert.equal(classifyAiError(limited), 'rate_limited')
    assert.equal((limited as OpenAiRequestError).retryAfterMs, 1500)
    reply(() => json(429, { error: { message: 'Slow down.' } }, { 'retry-after': '2' }))
    assert.equal(((await failure(ask())) as OpenAiRequestError).retryAfterMs, 2000)
  })

  it('counts a network failure as the provider, and tells the listener', async () => {
    reply(() => {
      throw new TypeError('fetch failed')
    })
    const error = await failure(ask())
    assert.equal((error as OpenAiRequestError).statusCode, 502)
    assert.equal(classifyAiError(error), 'provider')
    assert.equal(heard.length, 1)
  })

  it('classifies everything else', () => {
    const status = (code: number, details: { code?: string; type?: string } = {}) =>
      classifyAiError(new OpenAiRequestError('x', code, details))
    assert.equal(status(429, { type: 'insufficient_quota' }), 'no_credits')
    assert.equal(status(429, { code: 'insufficient_quota' }), 'no_credits')
    assert.equal(status(429, { code: 'billing_hard_limit_reached' }), 'no_credits')
    assert.equal(status(429, { code: 'rate_limit_exceeded' }), 'rate_limited')
    assert.equal(status(429), 'rate_limited')
    for (const code of [500, 502, 503, 504, 408, 409]) {
      assert.equal(status(code), 'provider', `HTTP ${code}`)
    }
    for (const code of [401, 403, 404]) {
      assert.equal(status(code), 'account', `HTTP ${code}`)
    }
    assert.equal(status(422), 'rejected')
    // A 400 is the photo only when OpenAI says so; otherwise it's our request
    // (a setting or schema the model doesn't take), not "try another photo".
    for (const code of ['invalid_image', 'invalid_image_format', 'image_parse_error', 'moderation_blocked', 'content_policy_violation']) {
      assert.equal(status(400, { code }), 'rejected', code)
    }
    assert.equal(status(400, { code: 'unsupported_parameter' }), 'internal')
    assert.equal(status(400, { code: 'invalid_value' }), 'internal')
    assert.equal(status(400), 'internal')
    assert.equal(status(418), 'internal')
    // JSON.parse on a reply that wasn't the JSON it promised.
    assert.equal(classifyAiError(new SyntaxError('Unexpected token')), 'provider')
    assert.equal(classifyAiError(new Error('ENOENT: no such file')), 'internal')
    assert.equal(classifyAiError('weird'), 'internal')
  })

  it('reads image renders the same way, streamed or not', async () => {
    const render = () =>
      generateImageFromReferences({
        images: [{ data: Buffer.from('x'), filename: 'a.jpg', contentType: 'image/jpeg' }],
        prompt: 'x',
        onPartial: () => undefined,
      })
    reply(() => json(429, INCIDENT))
    assert.equal(classifyAiError(await failure(render())), 'no_credits')
    // The stream starts fine, then an error event names the problem.
    reply(
      () =>
        new Response(`data: ${JSON.stringify({ type: 'error', error: { code: 'insufficient_quota', message: 'No credits.' } })}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    )
    const streamed = await failure(render())
    assert.equal((streamed as OpenAiRequestError).statusCode, 429)
    assert.equal(classifyAiError(streamed), 'no_credits')
    assert.equal(heard.length, 2)
  })

  it('treats a content filter as a refusal, and running out of tokens as the provider', async () => {
    reply(() => json(200, { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }))
    const filtered = await failure(ask())
    assert.equal((filtered as OpenAiRequestError).statusCode, 422)
    assert.equal(classifyAiError(filtered), 'rejected')
    reply(() => json(200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
    assert.equal(classifyAiError(await failure(ask())), 'provider')
  })

  it('reads a missing key as an account problem the founder hears of at once, told once', async () => {
    env.OPENAI_API_KEY = undefined
    reply(() => json(200, { output_text: '{"ok":true}' }))
    const missing = (await failure(ask())) as OpenAiRequestError
    assert.equal(missing.code, 'missing_api_key')
    assert.equal(classifyAiError(missing), 'account')
    assert.deepEqual(heard, [missing])
    // The streamed render too, without telling the listener twice.
    const streamed = await failure(
      generateImageFromReferences({
        images: [{ data: Buffer.from('x'), filename: 'a.jpg', contentType: 'image/jpeg' }],
        prompt: 'x',
        onPartial: () => undefined,
      }),
    )
    assert.equal(classifyAiError(streamed), 'account')
    assert.equal(heard.length, 2)
    assert.equal(calls, 0)
  })

  it('never lets a broken listener break the call', async () => {
    onOpenAiError(() => {
      throw new Error('listener bug')
    })
    reply(() => json(500, { error: { message: 'Server error.' } }))
    assert.equal(classifyAiError(await failure(ask())), 'provider')
  })
})

describe('AI_FAULT', () => {
  it('fails every call on purpose in development, the way OpenAI does, without calling it', async () => {
    reply(() => json(200, { output_text: '{"ok":true}' }))
    const expected = { no_credits: 'no_credits', rate_limit: 'rate_limited', server: 'provider', timeout: 'provider', rejected: 'rejected' } as const

    for (const [fault, failure_] of Object.entries(expected)) {
      env.AI_FAULT = fault as keyof typeof expected
      const error = await failure(ask())
      assert.equal(classifyAiError(error), failure_, fault)
    }

    env.AI_FAULT = 'no_credits'
    const error = (await failure(ask())) as OpenAiRequestError
    assert.equal(error.code, 'credit_balance_exhausted')
    assert.equal(error.type, 'insufficient_quota')
    assert.equal(error.message, INCIDENT.error.message)
    assert.equal(calls, 0)
    // The listener hears simulated errors like real ones.
    assert.equal(heard.length, 6)
  })

  it('is dropped from the config in production', () => {
    const config = new URL('../../../config/env.ts', import.meta.url).href
    const script = `const { env } = await import(${JSON.stringify(config)}); process.stdout.write(String(env.AI_FAULT))`
    const effective = (nodeEnv: string) =>
      execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
        env: { ...process.env, NODE_ENV: nodeEnv, AI_FAULT: 'no_credits' },
        encoding: 'utf8',
      })
    assert.equal(effective('production'), 'undefined')
    assert.equal(effective('development'), 'no_credits')
  })

  it('is ignored in production', async () => {
    reply(() => json(200, { output_text: '{"ok":true}' }))
    env.NODE_ENV = 'production'
    env.AI_FAULT = 'no_credits'
    assert.deepEqual(await ask(), { ok: true })
    assert.equal(calls, 1)
    assert.equal(heard.length, 0)
  })
})

describe('retryDelay', () => {
  it('waits 3 s, then 10 s, and makes 3 attempts at most', () => {
    assert.equal(retryDelay('provider', 1, 2_000, null), 3_000)
    assert.equal(retryDelay('provider', 2, 8_000, null), 10_000)
    assert.equal(retryDelay('provider', 3, 20_000, null), null)
    assert.equal(retryDelay('rate_limited', 1, 0, null), 3_000)
  })

  it('takes what OpenAI asks for, up to 10 s', () => {
    assert.equal(retryDelay('rate_limited', 1, 0, 1_200), 1_200)
    assert.equal(retryDelay('rate_limited', 1, 0, 45_000), 10_000)
  })

  it('starts no attempt after a minute', () => {
    assert.equal(retryDelay('provider', 1, 57_000, null), 3_000)
    assert.equal(retryDelay('provider', 1, 58_000, null), null)
    assert.equal(retryDelay('provider', 2, 50_001, null), null)
    // A 90-second timeout uses the whole budget at once.
    assert.equal(retryDelay('provider', 1, 90_000, null), null)
  })

  it('never retries no credits, a bad key, a rejected photo or our own errors', () => {
    for (const code of ['no_credits', 'account', 'rejected', 'internal'] as const) {
      assert.equal(retryDelay(code, 1, 0, null), null, code)
    }
  })
})

describe('publicReason', () => {
  it('says busy for the provider, photo for a rejected one, error for the rest', () => {
    for (const code of PROVIDER_CODES) {
      assert.equal(publicReason(code), 'busy')
    }
    assert.equal(publicReason('rejected'), 'photo')
    assert.equal(publicReason('internal'), 'error')
    // Failed before reasons were kept.
    assert.equal(publicReason(undefined), 'error')
    assert.equal(publicReason(null), 'error')
  })
})

describe('redactAiMessage', () => {
  it('masks keys and keeps it short', () => {
    const message = redactAiMessage('Incorrect API key provided: sk-proj-abc1********************xyz9. You can find your API key at https://platform.openai.com/account/api-keys.')
    assert.ok(message.includes('sk-…'))
    assert.ok(!message.includes('abc1'))
    assert.ok(!message.includes('xyz9'))
    assert.equal(redactAiMessage('x'.repeat(400)).length, 300)
    assert.equal(redactAiMessage('Rate limit reached.'), 'Rate limit reached.')
  })
})

describe('color read messages', () => {
  it('are translated in both tables', () => {
    for (const message of ['There is no color read to retry.', 'We are still reading your colors. One moment.', 'There is no new color read to choose.']) {
      assert.ok(esMessages[message], `es: ${message}`)
      assert.ok(ptBrMessages[message], `pt-BR: ${message}`)
    }
  })
})
