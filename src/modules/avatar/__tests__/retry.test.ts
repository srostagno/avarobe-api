import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ColorsNotify } from '../../../types/mongo.js'
import { guestEmail } from '../../../utils/guests.js'
import { countsAsAttempt, pendingNotice, readInTurn, retryColorReads, shouldGiveUp } from '../retry.js'

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

  it('count every failed read except no credits and a refused key, which cost nothing', () => {
    assert.equal(countsAsAttempt('no_credits'), false)
    assert.equal(countsAsAttempt('account'), false)
    for (const code of ['provider', 'rate_limited', 'rejected', 'internal'] as const) {
      assert.equal(countsAsAttempt(code), true, code)
    }
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

// The whole pass, against in-memory collections, a selfie on disk and the
// AI faked (AI_FAULT, then a stubbed fetch): 11-Oct-2026 again, then the
// credits back.
describe('retryColorReads', { skip: env.STORAGE_DRIVER !== 'local' }, () => {
  const saved = {
    dir: env.STORAGE_LOCAL_DIR,
    fault: env.AI_FAULT,
    key: env.OPENAI_API_KEY,
    allow: env.EMAIL_DEV_ALLOWLIST,
    fetch: globalThis.fetch,
  }
  let dir = ''
  const { app, collection, logs } = fakeApp()
  const people: Record<string, { userId: ObjectId; avatarId: ObjectId }> = {}
  const requests: { url: string; instructions: string }[] = []

  async function person(name: string, user: Doc, avatar: Doc) {
    const userId = new ObjectId()
    const avatarId = new ObjectId()
    const selfieKey = `users/${userId.toString()}/selfie-1.jpg`
    await mkdir(path.join(dir, 'users', userId.toString()), { recursive: true })
    await writeFile(path.join(dir, selfieKey), Buffer.from('fake selfie'))
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

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avarobe-retry-'))
    env.STORAGE_LOCAL_DIR = dir
    env.OPENAI_API_KEY = 'sk-test-not-a-key'
    env.EMAIL_DEV_ALLOWLIST = []
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const target = url instanceof Request ? url.url : url.toString()

      if (!target.endsWith('/responses')) {
        // The free preview that follows a read: not part of this test.
        return new Response(JSON.stringify({ error: { message: 'no' } }), { status: 500 })
      }

      requests.push({ url: target, instructions: (JSON.parse(init?.body as string) as { instructions: string }).instructions })
      return new Response(
        JSON.stringify({
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
        { status: 200 },
      )
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

  after(async () => {
    env.STORAGE_LOCAL_DIR = saved.dir
    env.AI_FAULT = saved.fault
    env.OPENAI_API_KEY = saved.key
    env.EMAIL_DEV_ALLOWLIST = saved.allow
    globalThis.fetch = saved.fetch
    await rm(dir, { recursive: true, force: true })
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

  it('counts a read that cost something', async () => {
    env.AI_FAULT = 'rejected'
    await retryColorReads(app, later(10 * MINUTE))
    assert.equal((await notifyOf('ana')).attempts, 1)
    assert.equal((await notifyOf('bea')).attempts, 0)
  })

  it('once reads work: each one in their language, and a sign-in link to their colors', async () => {
    env.AI_FAULT = undefined
    // She retried by herself and got her colors: only the email is owed.
    await person('cleo', { locale: 'pt-BR' }, {
      status: 'ready',
      failure: null,
      colorAnalysis: { season: 'Deep Winter', bestColors: [], neutrals: [], avoidColors: [] },
      colorsNotify: notify({ requestedAt: ago(30 * MINUTE) }),
    })
    const result = await retryColorReads(app, later(15 * MINUTE))

    assert.deepEqual(result.outcomes, ['ready', 'ready'])
    assert.equal(result.sent, 3)
    // Bea first (her last try is older than Ana's), in Spanish; Ana's in English.
    assert.equal(requests.length, 2)
    assert.ok(requests[0]!.instructions.includes('Latin American Spanish'))
    assert.ok(!requests[1]!.instructions.includes('Language:'))

    for (const name of ['ana', 'bea', 'cleo']) {
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
    assert.deepEqual(subjects.sort(), ['Suas cores estão prontas', 'Tus colores están listos', 'Your colors are ready'])
    // In development the link is logged, never sent.
    const links = logs.filter((line) => line.msg === 'Dev email link (not sent)')
    assert.equal(links.length, 3)
    assert.ok(links.every((line) => String((line.obj as { link: string }).link).includes('/continue?token=')))
    const ready = await collection('analyticsEvents').find({ name: 'colors_ready' }).toArray()
    assert.ok(ready.every((event) => (event.props as { via?: string }).via === 'notify'))
  })

  it('sends nothing more on the next pass', async () => {
    const result = await retryColorReads(app, later(20 * MINUTE))
    assert.deepEqual(result, { gaveUp: 0, sent: 0, outcomes: [] })
    assert.equal((await collection('emailSends').find({ kind: 'colors_ready' }).toArray()).length, 3)
  })
})
