import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ColorsFailure, ColorsNotify } from '../../../types/mongo.js'
import type { AiFailure } from '../../../utils/openai.js'
import { guestEmail } from '../../../utils/guests.js'
import { storage } from '../../../utils/storage.js'
import { afterFailedRead, countsAsAttempt, pendingNotice, readInTurn, retryColorReads, shouldGiveUp } from '../retry.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const now = new Date()
const ago = (ms: number) => new Date(now.getTime() - ms)
const later = (ms: number) => new Date(now.getTime() + ms)

const notify = (fields: Partial<ColorsNotify> = {}): ColorsNotify => ({
  requestedAt: ago(HOUR),
  attempts: 0,
  lastTriedAt: null,
  sentAt: null,
  gaveUpAt: null,
  via: 'guest',
  ...fields,
})

describe('pending notices', () => {
  it('wait a day at most, until sent or given up', () => {
    assert.equal(pendingNotice(notify(), now), true)
    assert.equal(pendingNotice(notify({ requestedAt: ago(25 * HOUR) }), now), false)
    assert.equal(pendingNotice(notify({ sentAt: now }), now), false)
    assert.equal(pendingNotice(notify({ gaveUpAt: now }), now), false)
    assert.equal(pendingNotice(null, now), false)
  })

  it('are given up after a day or 6 reads that cost something', () => {
    assert.equal(shouldGiveUp(notify({ attempts: 5 }), now), false)
    assert.equal(shouldGiveUp(notify({ attempts: 6 }), now), true)
    assert.equal(shouldGiveUp(notify({ requestedAt: ago(24 * HOUR + MINUTE) }), now), true)
    assert.equal(shouldGiveUp(notify({ attempts: 6, sentAt: now }), now), false)
  })

  it('count every failed read except no credits, a refused key and a rate limit, which cost nothing', () => {
    for (const code of ['no_credits', 'account', 'rate_limited'] as const) {
      assert.equal(countsAsAttempt(code), false, code)
    }
    for (const code of ['provider', 'rejected', 'internal'] as const) {
      assert.equal(countsAsAttempt(code), true, code)
    }
  })

  it('stop the pass only when the AI fails, and give up a refused photo', () => {
    const failed = (code: AiFailure | null) => ({ status: 'failed' as const, failure: code ? { code, at: now, attempts: 1, detail: null } : null })
    for (const code of ['no_credits', 'account', 'rate_limited', 'provider'] as const) {
      assert.equal(afterFailedRead(failed(code)), 'stop', code)
    }
    assert.equal(afterFailedRead(failed('rejected')), 'give_up')
    assert.equal(afterFailedRead(failed('internal')), 'next')
    assert.equal(afterFailedRead(failed(null)), 'next')
    // Replaced by a read they started themselves.
    assert.equal(afterFailedRead({ status: 'processing', failure: null }), 'next')
    assert.equal(afterFailedRead(null), 'next')
  })
})

describe('readInTurn', () => {
  it('stops at the first failure, so the first read is the probe', async () => {
    const read: string[] = []
    const outcomes = await readInTurn(['skip', 'fail', 'never'], async (item) => {
      read.push(item)
      return item === 'skip' ? 'skipped' : 'failed'
    })
    assert.deepEqual(read, ['skip', 'fail'])
    assert.deepEqual(outcomes, ['skipped', 'failed'])
    assert.deepEqual(await readInTurn([1, 2], async () => 'ready'), ['ready', 'ready'])
  })
})

// The whole pass, against in-memory collections, the selfies in memory and
// the AI faked (AI_FAULT, then a stubbed fetch that answers each person in
// turn): 11-Oct-2026 again, the other ways a read fails, then the credits
// back.
describe('retryColorReads', () => {
  const saved = {
    read: storage.read.bind(storage),
    fault: env.AI_FAULT,
    key: env.OPENAI_API_KEY,
    allow: env.EMAIL_DEV_ALLOWLIST,
    fetch: globalThis.fetch,
  }
  const { app, collection, logs } = fakeApp()
  const people: Record<string, { userId: ObjectId; avatarId: ObjectId }> = {}
  const requests: { name: string; instructions: string }[] = []
  const signed: { typ?: string; nx?: string }[] = []
  // Whose selfie each storage key is, and the ones gone from storage.
  const selfies = new Map<string, string>()
  const missing = new Set<string>()
  // What OpenAI answers: everyone (mode), or one person (answers).
  type Answer = 'colors' | 'server' | 'rate' | 'refuse'
  let mode: Answer = 'colors'
  const answers: Record<string, Answer> = {}

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  // Retried at once (retry-after-ms 1), so the server's own 3 tries take no time.
  const replies: Record<Answer, () => Response> = {
    colors: () =>
      json(200, {
        output_text: JSON.stringify({
          season: 'Soft Autumn',
          undertone: 'warm',
          contrast: 'medium',
          summary: 'Warm and soft.',
          bestColors: [
            { name: 'Olive', hex: '#5B5A2C' },
            { name: 'Rust', hex: '#A0482A' },
            { name: 'Teal', hex: '#1F5C5B' },
          ],
          neutrals: [{ name: 'Camel', hex: '#C19A6B' }],
          // No color to avoid: no free preview starts (an image call).
          avoidColors: [],
          metals: 'gold',
          confidence: 'high',
          photoNote: null,
        }),
      }),
    server: () => json(500, { error: { message: 'The server had an error.', type: 'server_error' } }, { 'retry-after-ms': '1' }),
    rate: () => json(429, { error: { message: 'Rate limit reached.', code: 'rate_limit_exceeded' } }, { 'retry-after-ms': '1' }),
    refuse: () => json(400, { error: { message: 'Invalid image.', code: 'invalid_image', type: 'invalid_request_error' } }),
  }

  async function person(name: string, user: Doc, avatar: Doc) {
    const userId = new ObjectId()
    const avatarId = new ObjectId()
    const selfieKey = `users/${userId.toString()}/selfie-1.jpg`
    selfies.set(selfieKey, name)
    collection('users').docs.push({
      _id: userId,
      email: `${name}@example.test`,
      firstName: name,
      createdAt: ago(3 * HOUR),
      ...user,
    })
    collection('avatars').docs.push({
      _id: avatarId,
      userId,
      status: 'failed',
      error: 'x',
      selfieKey,
      avatarKey: null,
      colorAnalysis: null,
      failure: { code: 'no_credits', at: ago(HOUR), attempts: 1, detail: null },
      createdAt: ago(3 * HOUR),
      updatedAt: ago(HOUR),
      ...avatar,
    })
    people[name] = { userId, avatarId }
  }

  const avatarOf = (name: string) => collection('avatars').findOne({ _id: people[name]!.avatarId })
  const userOf = (name: string) => collection('users').findOne({ _id: people[name]!.userId })
  const notifyOf = async (name: string) => (await avatarOf(name))?.colorsNotify as ColorsNotify
  const failureOf = async (name: string) => {
    const failure = (await avatarOf(name))?.failure as ColorsFailure | null

    return failure ? { code: failure.code, attempts: failure.attempts } : null
  }
  const readsOf = (name: string) => requests.filter((request) => request.name === name).length

  before(async () => {
    storage.read = async (key: string) => {
      const name = selfies.get(key)

      if (!name || missing.has(name)) {
        throw new Error(`ENOENT: no such file, open '${key}'`)
      }

      return Buffer.from(`selfie:${name}`)
    }
    env.OPENAI_API_KEY = 'sk-test-not-a-key'
    env.EMAIL_DEV_ALLOWLIST = []
    Object.assign(app.jwt, {
      sign: async (payload: { typ?: string; nx?: string }) => {
        signed.push(payload)
        return `test-token-${signed.length}`
      },
    })
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const target = url instanceof Request ? url.url : url.toString()

      if (!target.endsWith('/responses')) {
        // The free preview that follows a read: not part of this test.
        return json(500, { error: { message: 'no' } })
      }

      const body = JSON.parse(init?.body as string) as {
        instructions: string
        input: { content: { type: string; image_url?: string }[] }[]
      }
      const image = body.input[0]!.content.find((part) => part.type === 'input_image')!.image_url!
      const name = Buffer.from(image.split(',')[1]!, 'base64').toString().replace('selfie:', '')
      requests.push({ name, instructions: body.instructions })
      return replies[answers[name] ?? mode]()
    }

    // A guest who never saved (only a placeholder address), the first to
    // ask; two saved accounts, in English and in Spanish; one asked too
    // long ago; one tried too often.
    await person('guest', { guest: true }, { colorsNotify: notify({ requestedAt: ago(3 * HOUR) }) })
    collection('users').docs.at(-1)!.email = guestEmail(people.guest!.userId)
    await person('ana', { locale: 'en' }, { colorsNotify: notify({ requestedAt: ago(2 * HOUR) }) })
    await person('bea', { locale: 'es' }, { colorsNotify: notify({ requestedAt: ago(HOUR), via: 'account' }) })
    await person('old', {}, { colorsNotify: notify({ requestedAt: ago(25 * HOUR) }) })
    await person('tried', {}, { colorsNotify: notify({ attempts: 6, lastTriedAt: ago(10 * MINUTE) }) })
  })

  after(() => {
    storage.read = saved.read
    env.AI_FAULT = saved.fault
    env.OPENAI_API_KEY = saved.key
    env.EMAIL_DEV_ALLOWLIST = saved.allow
    globalThis.fetch = saved.fetch
  })

  it('while OpenAI has no credits: one probe, no attempt counted, the rest given up or left waiting', async () => {
    env.AI_FAULT = 'no_credits'
    const result = await retryColorReads(app, now)

    assert.deepEqual(result.outcomes, ['skipped', 'failed'])
    assert.equal(result.sent, 0)
    // Too old, tried too often, and the placeholder guest: never emailed.
    for (const name of ['old', 'tried', 'guest']) {
      assert.ok((await notifyOf(name)).gaveUpAt, name)
    }
    // Ana was the probe: failed again for no credits, which costs nothing.
    const ana = await avatarOf('ana')
    assert.equal(ana?.status, 'failed')
    assert.equal((ana?.failure as { code: string }).code, 'no_credits')
    assert.ok((await notifyOf('ana')).lastTriedAt)
    assert.equal((await notifyOf('ana')).attempts, 0)
    // Bea wasn't tried: the pass stopped at the first failure.
    assert.equal((await notifyOf('bea')).lastTriedAt, null)
    const failed = await collection('analyticsEvents').findOne({ name: 'colors_failed' })
    assert.deepEqual(failed?.props, { reason: 'no_credits', attempts: 1, via: 'notify' })
    assert.deepEqual(await collection('analyticsEvents').distinct('name', { name: 'colors_notify_gave_up' }), ['colors_notify_gave_up'])
  })

  it('takes turns: the next pass probes whoever waited longest since their last try', async () => {
    const result = await retryColorReads(app, later(5 * MINUTE))
    assert.deepEqual(result.outcomes, ['failed'])
    assert.ok((await notifyOf('bea')).lastTriedAt)
  })

  it('counts a read that cost something, after the server’s own 3 tries', async () => {
    env.AI_FAULT = undefined
    mode = 'server'
    const result = await retryColorReads(app, later(10 * MINUTE))
    assert.deepEqual(result.outcomes, ['failed'])
    assert.equal(readsOf('ana'), 3)
    assert.deepEqual(await failureOf('ana'), { code: 'provider', attempts: 3 })
    assert.equal((await notifyOf('ana')).attempts, 1)
    assert.equal((await notifyOf('bea')).attempts, 0)
  })

  it('counts no rate limit, however long it lasts (only the day ends the wait)', async () => {
    mode = 'rate'
    const result = await retryColorReads(app, later(15 * MINUTE))
    assert.deepEqual(result.outcomes, ['failed'])
    assert.equal(readsOf('bea'), 3)
    assert.equal((await failureOf('bea'))?.code, 'rate_limited')
    assert.equal((await notifyOf('bea')).attempts, 0)
  })

  it('gives up a photo the AI refuses, without counting it, and goes on to the next', async () => {
    mode = 'server'
    // Dora's read is refused; Eve's own new selfie was, since she asked.
    await person('dora', { locale: 'en' }, { colorsNotify: notify({ requestedAt: ago(30 * MINUTE) }) })
    answers.dora = 'refuse'
    await person('eve', { locale: 'en' }, {
      failure: { code: 'rejected', at: ago(5 * MINUTE), attempts: 1, detail: null },
      colorsNotify: notify({ requestedAt: ago(30 * MINUTE) }),
    })
    const result = await retryColorReads(app, later(20 * MINUTE))

    // Dora once (no retry for a refusal), then Ana, still failing: the probe.
    assert.deepEqual(result.outcomes, ['skipped', 'failed'])
    assert.equal(readsOf('dora'), 1)
    assert.equal(readsOf('eve'), 0)
    assert.ok((await notifyOf('dora')).gaveUpAt)
    assert.equal((await notifyOf('dora')).attempts, 0)
    assert.ok((await notifyOf('eve')).gaveUpAt)
    assert.equal((await notifyOf('ana')).attempts, 2)
  })

  it('counts a selfie gone from storage, and goes on to the next', async () => {
    await person('finn', { locale: 'en' }, { colorsNotify: notify({ requestedAt: ago(20 * MINUTE) }) })
    missing.add('finn')
    const result = await retryColorReads(app, later(25 * MINUTE))

    assert.deepEqual(result.outcomes, ['skipped', 'failed'])
    assert.equal((await failureOf('finn'))?.code, 'internal')
    assert.equal((await notifyOf('finn')).attempts, 1)
    assert.equal((await notifyOf('finn')).gaveUpAt, null)
    // Bea was next, and the server still failing stopped the pass.
    assert.equal((await notifyOf('bea')).attempts, 1)
  })

  it('once reads work: each one in their language, and a sign-in link to their colors', async () => {
    mode = 'colors'
    missing.delete('finn')
    // She retried by herself and got her colors: only the email is owed.
    await person('cleo', { locale: 'pt-BR' }, {
      status: 'ready',
      failure: null,
      colorAnalysis: { season: 'Deep Winter', bestColors: [], neutrals: [], avoidColors: [] },
      colorsNotify: notify({ requestedAt: ago(30 * MINUTE) }),
    })
    // His read was cut off by a restart a quarter of an hour ago: still
    // "processing", past the boot's check.
    await person('gus', { locale: 'es' }, {
      status: 'processing',
      failure: null,
      job: { kind: 'colors', startedAt: ago(15 * MINUTE), previewKey: null, previewCount: 0 },
      updatedAt: ago(15 * MINUTE),
      colorsNotify: notify({ requestedAt: ago(40 * MINUTE), lastTriedAt: ago(15 * MINUTE) }),
    })
    const before = requests.length
    const result = await retryColorReads(app, later(30 * MINUTE))

    assert.deepEqual(result.outcomes, ['ready', 'ready', 'ready', 'ready'])
    assert.equal(result.sent, 5)
    // Each in their language: Bea and Gus in Spanish, Ana and Finn in English.
    const done = requests.slice(before)
    assert.deepEqual(done.map((request) => request.name).sort(), ['ana', 'bea', 'finn', 'gus'])
    for (const request of done) {
      assert.equal(request.instructions.includes('Latin American Spanish'), ['bea', 'gus'].includes(request.name), request.name)
    }

    for (const name of ['ana', 'bea', 'cleo', 'finn', 'gus']) {
      const avatar = await avatarOf(name)
      assert.ok((avatar?.colorsNotify as ColorsNotify).sentAt, name)
      // The colors offer waits its gap after this email.
      const user = await userOf(name)
      assert.ok((user?.lifecycleEmails as Record<string, Date>).colors_ready, name)
      assert.ok(user?.lifecycleEmailLastAt, name)
    }

    assert.equal((await avatarOf('ana'))?.status, 'ready')
    assert.equal((await avatarOf('ana'))?.failure, null)
    const subjects = (await collection('emailSends').find({ kind: 'colors_ready' }).toArray()).map((send) => send.subject)
    assert.deepEqual(subjects.sort(), [
      'Suas cores estão prontas',
      'Tus colores están listos',
      'Tus colores están listos',
      'Your colors are ready',
      'Your colors are ready',
    ])
    // In development the link is logged, never sent. Its own kind of link
    // ('colors'), so the offer's sign-in link a day later doesn't void it.
    const links = logs.filter((line) => line.msg === 'Dev email link (not sent)')
    assert.equal(links.length, 5)
    assert.ok(links.every((line) => String((line.obj as { link: string }).link).includes('/continue?token=')))
    assert.ok(signed.length >= 5)
    assert.ok(signed.every((payload) => payload.typ === 'colors' && payload.nx === '/studio'))
    const ready = await collection('analyticsEvents').find({ name: 'colors_ready' }).toArray()
    assert.ok(ready.every((event) => (event.props as { via?: string }).via === 'notify'))
  })

  it('sends nothing more on the next pass', async () => {
    const result = await retryColorReads(app, later(35 * MINUTE))
    assert.deepEqual(result, { gaveUp: 0, sent: 0, outcomes: [] })
    assert.equal((await collection('emailSends').find({ kind: 'colors_ready' }).toArray()).length, 5)
  })

  it('tries an email that can’t go 3 times, then gives up, leaving no trace of it', async () => {
    await person('hana', { locale: 'en' }, {
      status: 'ready',
      failure: null,
      colorAnalysis: { season: 'Light Spring', bestColors: [], neutrals: [], avoidColors: [] },
      colorsNotify: notify({ requestedAt: ago(30 * MINUTE) }),
    })
    const sign = app.jwt.sign.bind(app.jwt)
    Object.assign(app.jwt, {
      sign: async () => {
        throw new Error('signing is down')
      },
    })

    try {
      for (const [pass, minutes] of [40, 45, 50].entries()) {
        const result = await retryColorReads(app, later(minutes * MINUTE))
        assert.equal(result.sent, 0)
        const hana = await notifyOf('hana')
        assert.equal(hana.sentAt, null)
        assert.equal(hana.sendFailures, pass + 1)
        assert.equal(Boolean(hana.gaveUpAt), pass === 2, `pass ${pass + 1}`)
      }
    } finally {
      Object.assign(app.jwt, { sign })
    }

    assert.equal(await collection('emailSends').countDocuments({ userId: people.hana!.userId }), 0)
    assert.equal(((await userOf('hana'))?.lifecycleEmails as Record<string, Date> | undefined)?.colors_ready, undefined)
    assert.equal((await userOf('hana'))?.lifecycleEmailLastAt, undefined)
    assert.equal((await retryColorReads(app, later(55 * MINUTE))).sent, 0)
  })
})
