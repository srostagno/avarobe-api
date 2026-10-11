import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import { OpenAiRequestError } from '../../../utils/openai.js'
import {
  ALERT_RULES,
  alertAccount,
  alertContent,
  alertIsOver,
  alertWasSent,
  chileTime,
  duration,
  noteReadFailed,
  noteReadSucceeded,
  shouldAlertReads,
  undeliveredLastSentAt,
} from '../alerts.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
// 8:40 in Chile, when the reads started failing on 11-Oct-2026.
const start = new Date('2026-10-11T11:40:00Z')
const at = (ms: number) => new Date(start.getTime() + ms)
const incident = () =>
  new OpenAiRequestError('You exceeded your current quota, please check your plan and billing details.', 429, {
    code: 'credit_balance_exhausted',
    type: 'insufficient_quota',
  })

const saved = { alert: env.ALERT_EMAILS, allow: env.EMAIL_DEV_ALLOWLIST, nodeEnv: env.NODE_ENV }

before(() => {
  // Development never delivers to an address outside the allowlist: the
  // alert is the "Dev email (not sent)" log line.
  env.ALERT_EMAILS = 'founder@example.test'
  env.EMAIL_DEV_ALLOWLIST = []
  env.NODE_ENV = 'development'
})

after(() => {
  env.ALERT_EMAILS = saved.alert
  env.EMAIL_DEV_ALLOWLIST = saved.allow
  env.NODE_ENV = saved.nodeEnv
})

const emailed = (logs: { msg: string; obj: unknown }[]) =>
  logs.filter((line) => line.msg === 'Dev email (not sent)').map((line) => (line.obj as { subject: string }).subject)
// The last alert's text (logged with it).
const lastText = (logs: { msg: string; obj: unknown }[]) =>
  (logs.filter((line) => line.msg === 'Operations alert').at(-1)?.obj as { text: string } | undefined)?.text ?? ''

function failedAvatar(code: string, when: Date, guest = false): { avatar: Doc; user: Doc } {
  const userId = new ObjectId()
  return {
    user: { _id: userId, email: `${userId.toString()}@example.test`, ...(guest ? { guest: true } : {}) },
    avatar: {
      _id: new ObjectId(),
      userId,
      status: 'failed',
      avatarKey: null,
      colorAnalysis: null,
      updatedAt: when,
      failure: { code, at: when, attempts: code === 'provider' ? 3 : 1, detail: `${code} detail` },
    },
  }
}

describe('shouldAlertReads', () => {
  const now = at(0)
  it('needs 3 people', () => {
    assert.equal(shouldAlertReads(2, null, null, now), false)
    assert.equal(shouldAlertReads(3, null, null, now), true)
  })

  it('goes out at most once an hour', () => {
    assert.equal(shouldAlertReads(5, at(-30 * MINUTE), null, now), false)
    assert.equal(shouldAlertReads(5, at(-61 * MINUTE), null, now), true)
  })

  it('stays quiet while the credits alert, which explains it, is under an hour old', () => {
    assert.equal(shouldAlertReads(5, null, at(-10 * MINUTE), now), false)
    assert.equal(shouldAlertReads(5, null, at(-2 * HOUR), now), true)
  })
})

describe('when an alert is over', () => {
  const now = at(0)
  it('the credits one, once OpenAI has stopped saying so for 2 minutes', () => {
    assert.equal(alertIsOver('openai_account', { lastAccountErrorAt: null, failingPeople: 9 }, now), true)
    assert.equal(alertIsOver('openai_account', { lastAccountErrorAt: at(-MINUTE), failingPeople: 0 }, now), false)
    assert.equal(alertIsOver('openai_account', { lastAccountErrorAt: at(-2 * MINUTE), failingPeople: 0 }, now), true)
  })

  it('the reads one, once fewer than 3 people failed in 10 minutes', () => {
    assert.equal(alertIsOver('reads_failing', { lastAccountErrorAt: null, failingPeople: 3 }, now), false)
    assert.equal(alertIsOver('reads_failing', { lastAccountErrorAt: null, failingPeople: 2 }, now), true)
  })

  it('says so only if the founder was told of it', () => {
    assert.equal(alertWasSent({ lastSentAt: at(0), openSince: at(0) }), true)
    assert.equal(alertWasSent({ lastSentAt: at(HOUR), openSince: at(0) }), true)
    // Came back within the hour, held back by the throttle.
    assert.equal(alertWasSent({ lastSentAt: at(0), openSince: at(20 * MINUTE) }), false)
  })

  it('an undelivered alert is tried again in 10 minutes', () => {
    const lastSentAt = undeliveredLastSentAt(now)
    assert.equal(now.getTime() - lastSentAt.getTime(), ALERT_RULES.every - 10 * MINUTE)
  })
})

describe('alert text', () => {
  it('escapes the HTML and keeps the lines', () => {
    const content = alertContent('Avarobe: test', ['Último error: <script>', 'línea 2'])
    assert.equal(content.text, 'Último error: <script>\nlínea 2')
    assert.ok(content.html.includes('&lt;script&gt;<br>'))
    assert.ok(!content.html.includes('<script>'))
  })

  it('writes Chile’s time and short durations', () => {
    assert.ok(chileTime(start).includes('08:40'))
    assert.ok(chileTime(start).includes('hora de Chile'))
    assert.equal(duration(125 * MINUTE), '2 h 5 min')
    assert.equal(duration(35 * MINUTE), '35 min')
  })
})

describe('the credits alert', () => {
  const { app, collection, logs } = fakeApp()

  it('goes out at the first error, with the subject that says what to do', async () => {
    const people = [failedAvatar('no_credits', at(-5 * MINUTE), true), failedAvatar('no_credits', at(-2 * MINUTE))]
    collection('avatars').docs.push(...people.map((person) => person.avatar))
    collection('users').docs.push(...people.map((person) => person.user))
    await alertAccount(app, incident(), 'no_credits', at(0))
    assert.deepEqual(emailed(logs), ['Avarobe: OpenAI sin créditos — las lecturas de color están fallando'])
    const alert = await collection('opsAlerts').findOne({ _id: 'openai_account' })
    assert.equal((alert?.lastSentAt as Date).getTime(), at(0).getTime())
    assert.equal((alert?.openSince as Date).getTime(), at(0).getTime())
  })

  it('says since when, how many failed, how many wait, and where to top up', async () => {
    collection('avatars').docs.push({
      ...failedAvatar('no_credits', at(2 * HOUR - 5 * MINUTE)).avatar,
      colorsNotify: { requestedAt: at(HOUR), attempts: 0, lastTriedAt: null, sentAt: null, gaveUpAt: null, via: 'guest' },
    })
    await alertAccount(app, incident(), 'no_credits', at(2 * HOUR))
    const text = lastText(logs)
    assert.ok(text.startsWith('OpenAI respondió HTTP 429 (credit_balance_exhausted / insufficient_quota).'))
    assert.ok(text.includes('Desde: 11 '))
    assert.ok(text.includes('08:40'))
    assert.ok(text.includes('Personas con la lectura fallida en la última hora: 1 (0 invitados)'))
    assert.ok(text.includes('Esperando aviso por email: 1'))
    assert.ok(text.includes('Último error: You exceeded your current quota'))
    assert.ok(text.includes('https://platform.openai.com/settings/organization/billing/overview'))
    assert.equal(emailed(logs).length, 2)
  })

  it('goes out at most once an hour, across restarts (the throttle is in the database)', async () => {
    const before = logs.length
    // Errors keep coming, each one a new call to the watcher.
    await alertAccount(app, incident(), 'no_credits', at(2 * HOUR + 10 * MINUTE))
    await alertAccount(app, incident(), 'no_credits', at(2 * HOUR + 59 * MINUTE))
    assert.deepEqual(emailed(logs.slice(before)), [])
    // An hour after the last one: again, with the trouble's first time kept.
    await alertAccount(app, incident(), 'no_credits', at(3 * HOUR + MINUTE))
    assert.equal(emailed(logs.slice(before)).length, 1)
    const alert = await collection('opsAlerts').findOne({ _id: 'openai_account' })
    assert.equal((alert?.openSince as Date).getTime(), at(0).getTime())
  })

  it('names a missing key as ours, without the top-up link', async () => {
    const other = fakeApp()
    await alertAccount(
      other.app,
      new OpenAiRequestError('OPENAI_API_KEY is missing on avarobe-api.', 503, { code: 'missing_api_key' }),
      'account',
      at(0),
    )
    assert.deepEqual(emailed(other.logs), ['Avarobe: falta OPENAI_API_KEY en el servidor — las lecturas de color están fallando'])
    assert.ok(lastText(other.logs).startsWith('avarobe-api no tiene OPENAI_API_KEY'))
    assert.ok(!lastText(other.logs).includes('platform.openai.com'))
  })

  it('names a refused key differently', async () => {
    const other = fakeApp()
    await alertAccount(other.app, new OpenAiRequestError('Incorrect API key provided: sk-proj-abc****xyz.', 401), 'account', at(0))
    assert.deepEqual(emailed(other.logs), ['Avarobe: OpenAI rechaza la clave o la configuración — las lecturas de color están fallando'])
    // The key never reaches the stored error.
    const alert = await other.collection('opsAlerts').findOne({ _id: 'openai_account' })
    assert.ok(!String(alert?.lastError).includes('abc'))
  })

  it('closes with one email when a read works again', async () => {
    const before = logs.length
    collection('analyticsEvents').docs.push(
      { name: 'colors_failed', origin: 'server', at: at(MINUTE), userId: new ObjectId() },
      { name: 'colors_failed', origin: 'server', at: at(2 * MINUTE), userId: new ObjectId() },
    )
    await noteReadSucceeded(app, at(3 * HOUR + 30 * MINUTE))
    await noteReadSucceeded(app, at(3 * HOUR + 31 * MINUTE))
    assert.deepEqual(emailed(logs.slice(before)), ['Avarobe: las lecturas de color funcionan de nuevo'])
    const text = lastText(logs)
    assert.ok(text.includes('desde 11 '))
    assert.ok(text.includes('(3 h 30 min)'))
    assert.ok(text.includes('Personas con una lectura fallida en ese lapso: 2'))
    assert.ok(text.includes('Esperando aviso por email: 1 (se les envía su lectura en los próximos minutos)'))
    const alert = await collection('opsAlerts').findOne({ _id: 'openai_account' })
    assert.equal(alert?.openSince, null)
  })
})

describe('the reads failing alert', () => {
  it('goes out when 3 people fail within 10 minutes, once an hour', async () => {
    const { app, collection, logs } = fakeApp()
    const now = at(0)
    const add = (code: string, when: Date) => {
      const person = failedAvatar(code, when)
      collection('avatars').docs.push(person.avatar)
      collection('users').docs.push(person.user)
    }

    add('provider', at(-8 * MINUTE))
    add('rate_limited', at(-3 * MINUTE))
    await noteReadFailed(app, now)
    assert.deepEqual(emailed(logs), [])
    // An old failure doesn't count.
    add('provider', at(-30 * MINUTE))
    await noteReadFailed(app, now)
    assert.deepEqual(emailed(logs), [])
    add('provider', at(-MINUTE))
    await noteReadFailed(app, now)
    assert.deepEqual(emailed(logs), ['Avarobe: 3 lecturas de color fallaron en 10 min'])
    const text = lastText(logs)
    assert.ok(text.includes('OpenAI caído o lento (provider): 2, límite de uso (rate_limited): 1'))
    assert.ok(text.includes('Invitados: 0 · Con cuenta: 3'))
    assert.ok(text.includes('Último error: provider detail'))
    // A 4th within the hour adds nothing.
    add('provider', at(MINUTE))
    await noteReadFailed(app, at(2 * MINUTE))
    assert.equal(emailed(logs).length, 1)
  })

  it('stays quiet while the credits alert is open', async () => {
    const { app, collection, logs } = fakeApp({
      opsAlerts: [{ _id: 'openai_account', lastSentAt: at(-20 * MINUTE), openSince: at(-20 * MINUTE), lastError: 'x' }],
    })

    for (const minutes of [1, 2, 3, 4]) {
      const person = failedAvatar('no_credits', at(-minutes * MINUTE))
      collection('avatars').docs.push(person.avatar)
      collection('users').docs.push(person.user)
    }

    await noteReadFailed(app, at(0))
    assert.deepEqual(emailed(logs), [])
  })
})

describe('an alert that can’t be delivered', () => {
  const saved = { fetch: globalThis.fetch, key: env.MAILERSEND_API_KEY, from: env.MAILERSEND_FROM_EMAIL }
  let calls = 0
  let failing = true

  before(() => {
    // Allowlisted, so it really goes to MailerSend: here a stub, down.
    env.EMAIL_DEV_ALLOWLIST = ['founder@example.test']
    env.MAILERSEND_API_KEY = 'mlsn-test-not-a-key'
    env.MAILERSEND_FROM_EMAIL = 'hello@example.test'
    globalThis.fetch = async () => {
      calls += 1
      return new Response(failing ? 'down' : '{}', { status: failing ? 503 : 202 })
    }
  })

  after(() => {
    env.EMAIL_DEV_ALLOWLIST = []
    env.MAILERSEND_API_KEY = saved.key
    env.MAILERSEND_FROM_EMAIL = saved.from
    globalThis.fetch = saved.fetch
  })

  it('is tried again in 10 minutes, not at every failed call, and not counted as sent', async () => {
    const { app, collection } = fakeApp()
    await alertAccount(app, incident(), 'no_credits', at(0))
    assert.equal(calls, 1)
    const alert = await collection('opsAlerts').findOne({ _id: 'openai_account' })
    assert.equal((alert?.lastSentAt as Date).getTime(), undeliveredLastSentAt(at(0)).getTime())
    assert.equal((alert?.openSince as Date).getTime(), at(0).getTime())
    assert.equal(await collection('analyticsEvents').countDocuments({ name: 'ops_alert_sent' }), 0)

    // The errors keep coming: no new delivery for 10 minutes.
    await alertAccount(app, incident(), 'no_credits', at(MINUTE))
    await alertAccount(app, incident(), 'no_credits', at(9 * MINUTE))
    assert.equal(calls, 1)

    failing = false
    await alertAccount(app, incident(), 'no_credits', at(11 * MINUTE))
    assert.equal(calls, 2)
    const sent = await collection('opsAlerts').findOne({ _id: 'openai_account' })
    assert.equal((sent?.lastSentAt as Date).getTime(), at(11 * MINUTE).getTime())
    assert.equal((sent?.openSince as Date).getTime(), at(0).getTime())
    assert.equal(await collection('analyticsEvents').countDocuments({ name: 'ops_alert_sent' }), 1)
  })
})

describe('the reads failing alert, after it went out', () => {
  // 3 people failed for the provider; the alert went out at 0.
  function outage() {
    const { app, collection, logs } = fakeApp({
      opsAlerts: [{ _id: 'reads_failing', lastSentAt: at(0), openSince: at(0), lastError: 'x' }],
    })
    const fail = (when: Date, reason = 'provider') => {
      const person = failedAvatar(reason, when)
      collection('avatars').docs.push(person.avatar)
      collection('users').docs.push(person.user)
      collection('analyticsEvents').docs.push({ name: 'colors_failed', origin: 'server', at: when, userId: person.user._id, props: { reason } })
    }

    return { app, collection, logs, fail }
  }

  it('stays open while people keep failing, though some reads get through (a rate limit)', async () => {
    const { app, collection, logs, fail } = outage()
    fail(at(MINUTE))
    fail(at(2 * MINUTE))
    fail(at(3 * MINUTE))
    await noteReadSucceeded(app, at(4 * MINUTE))
    assert.deepEqual(emailed(logs), [])
    assert.ok((await collection('opsAlerts').findOne({ _id: 'reads_failing' }))?.openSince)
    // Ten quiet minutes later, it's over.
    await noteReadSucceeded(app, at(14 * MINUTE))
    assert.deepEqual(emailed(logs), ['Avarobe: las lecturas de color funcionan de nuevo'])
  })

  it('doesn’t count photos the AI refused, to open or to keep open', async () => {
    const { app, logs, fail } = outage()
    fail(at(MINUTE), 'rejected')
    fail(at(2 * MINUTE), 'rejected')
    fail(at(3 * MINUTE), 'rejected')
    await noteReadSucceeded(app, at(4 * MINUTE))
    assert.deepEqual(emailed(logs), ['Avarobe: las lecturas de color funcionan de nuevo'])

    const fresh = fakeApp()
    for (const minutes of [1, 2, 3]) {
      const person = failedAvatar('rejected', at(-minutes * MINUTE))
      fresh.collection('avatars').docs.push(person.avatar)
      fresh.collection('users').docs.push(person.user)
    }
    await noteReadFailed(fresh.app, at(0))
    assert.deepEqual(emailed(fresh.logs), [])
  })

  it('after "funcionan de nuevo", a new outage alerts 10 minutes later at the earliest, not in an hour', async () => {
    const { app, collection, logs, fail } = outage()
    await noteReadSucceeded(app, at(5 * MINUTE))
    assert.equal(emailed(logs).length, 1)

    // Back 5 minutes after: held back.
    fail(at(10 * MINUTE))
    fail(at(10 * MINUTE))
    fail(at(10 * MINUTE))
    await noteReadFailed(app, at(10 * MINUTE))
    assert.equal(emailed(logs).length, 1)
    // Still failing 10 minutes after the recovery: the alert.
    fail(at(16 * MINUTE))
    await noteReadFailed(app, at(16 * MINUTE))
    assert.equal(emailed(logs).at(-1), 'Avarobe: 4 lecturas de color fallaron en 10 min')
    const alert = await collection('opsAlerts').findOne({ _id: 'reads_failing' })
    assert.equal((alert?.lastSentAt as Date).getTime(), at(16 * MINUTE).getTime())
  })

  it('trouble back within the hour and over before any alert ends quietly', async () => {
    const { app, collection, logs } = fakeApp({
      opsAlerts: [{ _id: 'openai_account', lastSentAt: at(0), openSince: null, lastError: 'x' }],
    })
    // 20 minutes after the last alert (and its recovery): no credits again.
    await alertAccount(app, incident(), 'no_credits', at(20 * MINUTE))
    assert.deepEqual(emailed(logs), [])
    assert.equal(((await collection('opsAlerts').findOne({ _id: 'openai_account' }))?.openSince as Date).getTime(), at(20 * MINUTE).getTime())
    await noteReadSucceeded(app, at(25 * MINUTE))
    assert.deepEqual(emailed(logs), [])
    assert.equal((await collection('opsAlerts').findOne({ _id: 'openai_account' }))?.openSince, null)
  })
})
