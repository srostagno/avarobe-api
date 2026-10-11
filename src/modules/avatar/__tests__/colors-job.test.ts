import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ColorsFailure, ColorsNotify } from '../../../types/mongo.js'
import { storage } from '../../../utils/storage.js'
import { requestColorsNotice, runColorsJob } from '../service.js'

// A color read and its own retries (runColorsJob), and "tell me when my
// colors are ready" (requestColorsNotice), against in-memory collections
// and a stubbed OpenAI.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const saved = { read: storage.read.bind(storage), key: env.OPENAI_API_KEY, fault: env.AI_FAULT, fetch: globalThis.fetch }
// What OpenAI answers, call after call (the last one again when they run out).
let replies: (() => Response)[] = []
let calls = 0
// Runs as the call comes in, before the answer (a new selfie meanwhile).
let onCall: ((call: number) => Promise<void>) | null = null

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const serverError = (retryAfterMs = '1') => () => json(500, { error: { message: 'The server had an error.' } }, { 'retry-after-ms': retryAfterMs })
const colors = () =>
  json(200, {
    output_text: JSON.stringify({
      season: 'Soft Autumn',
      undertone: 'warm',
      contrast: 'medium',
      summary: 'Warm and soft.',
      bestColors: [{ name: 'Olive', hex: '#5B5A2C' }],
      neutrals: [{ name: 'Camel', hex: '#C19A6B' }],
      avoidColors: [],
      metals: 'gold',
      confidence: 'high',
      photoNote: null,
    }),
  })

before(() => {
  storage.read = async () => Buffer.from('selfie')
  env.OPENAI_API_KEY = 'sk-test-not-a-key'
  env.AI_FAULT = undefined
  globalThis.fetch = async (url: string | URL | Request) => {
    const target = url instanceof Request ? url.url : url.toString()

    if (!target.endsWith('/responses')) {
      return json(500, { error: { message: 'no' } })
    }

    calls += 1
    await onCall?.(calls)
    return (replies[calls - 1] ?? replies.at(-1)!)()
  }
})

after(() => {
  storage.read = saved.read
  env.OPENAI_API_KEY = saved.key
  env.AI_FAULT = saved.fault
  globalThis.fetch = saved.fetch
})

beforeEach(() => {
  calls = 0
  onCall = null
})

// The kind and the tries of a failed read.
function failureOf(avatar: Doc | null) {
  const failure = avatar?.failure as ColorsFailure | null | undefined

  return failure ? { code: failure.code, attempts: failure.attempts } : null
}

function reading() {
  const { app, collection } = fakeApp()
  const userId = new ObjectId()
  const avatarId = new ObjectId()
  collection('users').docs.push({ _id: userId, email: 'ana@example.test', createdAt: new Date() })
  collection('avatars').docs.push({
    _id: avatarId,
    userId,
    status: 'processing',
    error: null,
    selfieKey: `users/${userId.toString()}/selfie-1.jpg`,
    avatarKey: null,
    colorAnalysis: null,
    failure: null,
    job: { kind: 'colors', startedAt: new Date(), previewKey: null, previewCount: 0 },
    updatedAt: new Date(),
  })
  // The read reserved one of the day's generations.
  collection('usageCounters').docs.push({ _id: `${userId.toString()}:avatar:${new Date().toISOString().slice(0, 10)}`, count: 1 })

  return { app, collection, userId, avatarId, avatar: () => collection('avatars').findOne({ _id: avatarId }) }
}

describe('runColorsJob', () => {
  it('tries a busy AI 3 times, waiting what OpenAI asks for, then fails as busy', async () => {
    // 1 ms asked (instead of 3 s, then 10 s): the three tries take no time.
    replies = [serverError('1')]
    const { app, collection, avatarId, avatar } = reading()
    const started = Date.now()
    await runColorsJob(app, avatarId)

    assert.equal(calls, 3)
    assert.ok(Date.now() - started < 2_000)
    const failed = await avatar()
    assert.equal(failed?.status, 'failed')
    assert.deepEqual(failureOf(failed), { code: 'provider', attempts: 3 })
    assert.equal(failed?.job, null)
    const event = await collection('analyticsEvents').findOne({ name: 'colors_failed' })
    assert.deepEqual(event?.props, { reason: 'provider', attempts: 3 })
  })

  it('gets the colors when a later try works', async () => {
    replies = [serverError(), colors]
    const { app, avatarId, avatar } = reading()
    await runColorsJob(app, avatarId)

    assert.equal(calls, 2)
    const ready = await avatar()
    assert.equal(ready?.status, 'ready')
    assert.equal(ready?.failure, null)
    assert.equal((ready?.colorAnalysis as { season: string }).season, 'Soft Autumn')
  })

  it('stops when the read was replaced meanwhile (a new selfie), leaving the new one alone', async () => {
    replies = [serverError()]
    const { app, collection, avatarId, avatar } = reading()
    onCall = async (call) => {
      if (call === 1) {
        await collection('avatars').updateOne({ _id: avatarId }, { $set: { selfieKey: 'users/other/selfie-2.jpg' } })
      }
    }
    await runColorsJob(app, avatarId)

    assert.equal(calls, 1)
    const current = await avatar()
    assert.equal(current?.status, 'processing')
    assert.equal(current?.failure, null)
    assert.equal(await collection('analyticsEvents').countDocuments({ name: 'colors_failed' }), 0)
    // The generation it held is given back.
    assert.equal((await collection('usageCounters').findOne({}))?.count, 0)
  })

  it('never retries no credits', async () => {
    replies = [() => json(429, { error: { message: 'No credits.', code: 'credit_balance_exhausted', type: 'insufficient_quota' } })]
    const { app, avatarId, avatar } = reading()
    await runColorsJob(app, avatarId)
    assert.equal(calls, 1)
    assert.deepEqual(failureOf(await avatar()), { code: 'no_credits', attempts: 1 })
  })
})

describe('requestColorsNotice', () => {
  const now = new Date()
  const ago = (ms: number) => new Date(now.getTime() - ms)

  function failedRead(failure: Doc | null, colorsNotify?: Partial<ColorsNotify>) {
    const { app, collection } = fakeApp()
    const userId = new ObjectId()
    collection('avatars').docs.push({
      _id: new ObjectId(),
      userId,
      status: 'failed',
      avatarKey: null,
      colorAnalysis: null,
      failure,
      ...(colorsNotify
        ? {
            colorsNotify: {
              requestedAt: ago(HOUR),
              attempts: 2,
              lastTriedAt: null,
              sentAt: null,
              gaveUpAt: null,
              via: 'guest',
              ...colorsNotify,
            },
          }
        : {}),
    })
    const notify = async () => (await collection('avatars').findOne({ userId }))?.colorsNotify as ColorsNotify | undefined
    const requested = () => collection('analyticsEvents').countDocuments({ name: 'colors_notify_requested' })

    return { app, userId, notify, requested }
  }

  const busy = { code: 'no_credits', at: new Date(), attempts: 1, detail: null }

  it('starts a request after a read the AI couldn’t do', async () => {
    const { app, userId, notify, requested } = failedRead(busy)
    assert.equal(await requestColorsNotice(app, userId, 'account'), true)
    const request = await notify()
    assert.equal(request?.via, 'account')
    assert.equal(request?.attempts, 0)
    assert.equal(request?.sentAt, null)
    assert.equal(await requested(), 1)
  })

  it('leaves a pending one as it is', async () => {
    const { app, userId, notify, requested } = failedRead(busy, {})
    assert.equal(await requestColorsNotice(app, userId, 'account'), true)
    assert.equal((await notify())?.attempts, 2)
    assert.equal((await notify())?.via, 'guest')
    assert.equal(await requested(), 0)
  })

  it('starts a new one after the last was sent, given up, or a day old', async () => {
    for (const old of [{ sentAt: ago(MINUTE) }, { gaveUpAt: ago(MINUTE) }, { requestedAt: ago(25 * HOUR) }]) {
      const { app, userId, notify, requested } = failedRead(busy, old)
      assert.equal(await requestColorsNotice(app, userId, 'guest'), true, JSON.stringify(old))
      assert.equal((await notify())?.attempts, 0)
      assert.equal((await notify())?.sentAt, null)
      assert.equal(await requested(), 1)
    }
  })

  it('refuses a photo the AI refused, our own errors, and reads with no reason kept', async () => {
    for (const failure of [{ ...busy, code: 'rejected' }, { ...busy, code: 'internal' }, null]) {
      const { app, userId, notify } = failedRead(failure)
      assert.equal(await requestColorsNotice(app, userId, 'guest'), false, String(failure?.code))
      assert.equal(await notify(), undefined)
    }
  })
})
