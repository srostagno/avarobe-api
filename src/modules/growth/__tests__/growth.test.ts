import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import Fastify from 'fastify'
import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { MongoCollections } from '../../../plugins/mongodb.js'
import { runGrowthQuery } from '../queries.js'
import growthRoutes from '../routes.js'

const DAY = 24 * 60 * 60 * 1000
const TOKEN = 'test-growth-token-0123456789abcdef0123456789abcdef'
// Real time: the route reads the clock itself (segment, context).
const now = new Date()
const ago = (days: number) => new Date(now.getTime() - days * DAY)
const READ = 'secondaryPreferred'

// What the scripts ask for, copied from growth/metrics.mjs and
// growth/customers.mjs (Oct 28, 2026): the server must keep asking the same.
const SCRIPT_USER_FIELDS = { createdAt: 1, acquisition: 1, 'location.country': 1, guest: 1, proTrialAt: 1, 'pro.status': 1, 'pro.trialEnd': 1, 'pro.cancelAtPeriodEnd': 1, 'pro.interval': 1 }
const SCRIPT_CUSTOMER_FIELDS = {
  email: 1, firstName: 1, locale: 1, location: 1, createdAt: 1, guest: 1, role: 1, acquisition: 1, paidAt: 1,
  colorReportAt: 1, styleReportAt: 1, hairAdvisorAt: 1, pro: 1, proTrialAt: 1, proTrialColor: 1, proTrialFree: 1,
  emailTipsOptOutAt: 1, lifecycleEmailLastAt: 1,
}

type Call = { collection: string; op: 'find' | 'findOne' | 'aggregate'; query: unknown; projection?: unknown; sort?: unknown; limit?: unknown; readPreference?: unknown }

// The fake collections, with every read they get recorded.
function spyCollections(seed: Record<string, Doc[]> = {}) {
  const fake = fakeApp(seed)
  const calls: Call[] = []
  const wrap = (name: string) => {
    const collection = fake.collection(name)

    return {
      find: (filter: Doc, options: Doc = {}) => {
        const call: Call = { collection: name, op: 'find', query: filter, projection: options.projection, readPreference: options.readPreference }
        calls.push(call)
        const cursor = collection.find(filter)
        const recording = {
          sort: (sort: Record<string, 1 | -1>) => {
            call.sort = sort
            cursor.sort(sort)
            return recording
          },
          limit: (limit: number) => {
            call.limit = limit
            cursor.limit(limit)
            return recording
          },
          toArray: () => cursor.toArray(),
        }

        return recording
      },
      findOne: (filter: Doc, options: Doc = {}) => {
        calls.push({ collection: name, op: 'findOne', query: filter, projection: options.projection, readPreference: options.readPreference })
        return collection.findOne(filter)
      },
      aggregate: (pipeline: Doc[], options: Doc = {}) => {
        calls.push({ collection: name, op: 'aggregate', query: pipeline, readPreference: options.readPreference })
        return collection.aggregate(pipeline)
      },
    }
  }

  return { collections: new Proxy({}, { get: (_target, name) => wrap(String(name)) }) as unknown as MongoCollections, calls }
}

async function growthApp(seed: Record<string, Doc[]> = {}) {
  const spy = spyCollections(seed)
  const app = Fastify({ logger: false })
  app.decorate('collections', spy.collections)
  await app.register(growthRoutes, { prefix: '/internal/growth' })
  await app.ready()

  const ask = (body: unknown, authorization: string | null = `Bearer ${TOKEN}`) =>
    app.inject({ method: 'POST', url: '/internal/growth/query', headers: authorization ? { authorization } : {}, payload: body as Doc })
  const rows = async <T>(name: string, params?: unknown) => {
    const response = await ask({ name, params })
    assert.equal(response.statusCode, 200, response.body)
    return response.json<{ rows: T }>().rows
  }

  return { app, calls: spy.calls, ask, rows }
}

const saved = { token: env.GROWTH_API_TOKEN, comp: env.COMP_EMAILS }

before(() => {
  env.GROWTH_API_TOKEN = TOKEN
  env.COMP_EMAILS = ' Founder@Example.test , tester@example.test'
})

after(() => {
  env.GROWTH_API_TOKEN = saved.token
  env.COMP_EMAILS = saved.comp
})

describe('growth data route: access', () => {
  it('is not there without GROWTH_API_TOKEN', async () => {
    env.GROWTH_API_TOKEN = undefined
    const { ask } = await growthApp()
    env.GROWTH_API_TOKEN = TOKEN

    assert.equal((await ask({ name: 'staff' })).statusCode, 404)
  })

  it('answers 401 without the right bearer token, before any read', async () => {
    const { ask, calls } = await growthApp()

    for (const authorization of [null, 'Bearer ', `Bearer ${TOKEN.slice(0, -1)}x`, `Bearer ${TOKEN}x`, 'Bearer short', `Basic ${TOKEN}`, TOKEN]) {
      const response = await ask({ name: 'staff' }, authorization)
      assert.equal(response.statusCode, 401, String(authorization))
      assert.doesNotMatch(response.body, new RegExp(TOKEN))
    }

    assert.equal(calls.length, 0)
    assert.equal((await ask({ name: 'staff' })).statusCode, 200)
  })

  it('answers 400 on an unknown name or bad params, before any read', async () => {
    const { ask, calls } = await growthApp()
    const id = new ObjectId().toHexString()
    const bad: [unknown, RegExp][] = [
      [{ name: 'drop' }, /Unknown query/],
      [{ name: 'constructor' }, /Unknown query/],
      [{ name: '__proto__' }, /Unknown query/],
      [{}, /name/],
      [{ name: 'staff', filter: {} }, /Unrecognized key/],
      [{ name: 'staff', params: { filter: { role: 'admin' } } }, /Bad params/],
      [{ name: 'usersSince', params: { since: 'yesterday' } }, /Bad params: since/],
      [{ name: 'usersSince', params: { since: now.getTime() } }, /Bad params: since/],
      [{ name: 'usersSince', params: { since: now.toISOString(), filter: { $where: '1' } } }, /Unrecognized key/],
      [{ name: 'usersByIds', params: { ids: [id, '123'] } }, /Bad params: ids\.1/],
      [{ name: 'usersByIds', params: { ids: [{ $gt: '' }] } }, /Bad params: ids\.0/],
      [{ name: 'usersByIds', params: { ids: Array.from({ length: 5_001 }, () => id) } }, /Bad params: ids/],
      [{ name: 'funnelReached', params: { userIds: [id], names: ['purchase_completed'], since: now.toISOString() } }, /Bad params: names\.0/],
      [{ name: 'visitors', params: { from: now.toISOString() } }, /Bad params: to/],
      [{ name: 'segment', params: { segment: 'everyone' } }, /Bad params: segment/],
      [{ name: 'userByEmail', params: { email: { $ne: null } } }, /Bad params: email/],
      [{ name: 'context', params: { userIds: id } }, /Bad params: userIds/],
      [{ name: 'activeDays', params: { from: ago(121).toISOString(), to: now.toISOString() } }, /Bad params: to/],
      [{ name: 'activeDays', params: { from: now.toISOString(), to: ago(1).toISOString() } }, /Bad params: to/],
      [{ name: 'eventCounts', params: { from: ago(63).toISOString(), to: now.toISOString() } }, /Bad params: to/],
      [{ name: 'offerEvents', params: { from: ago(63).toISOString(), to: now.toISOString() } }, /Bad params: to/],
      [{ name: 'surveyAnswers', params: { since: ago(7).toISOString(), question: 'held_back' } }, /Unrecognized key/],
      [{ name: 'feedback', params: {} }, /Bad params: since/],
      [{ name: 'generationHealth', params: { hours: 169 } }, /Bad params: hours/],
      [{ name: 'generationHealth', params: { hours: '24' } }, /Bad params: hours/],
    ]

    for (const [body, message] of bad) {
      const response = await ask(body)
      assert.equal(response.statusCode, 400, JSON.stringify(body).slice(0, 120))
      assert.match(response.json<{ message: string }>().message, message)
    }

    assert.equal(calls.length, 0)
  })
})

describe('growth data route: the queries', () => {
  it('staff: admins and the server COMP_EMAILS', async () => {
    const admin = new ObjectId()
    const founder = new ObjectId()
    const { rows, calls } = await growthApp({
      users: [
        { _id: admin, email: 'ops@example.test', role: 'admin' },
        { _id: founder, email: 'founder@example.test' },
        { _id: new ObjectId(), email: 'nora@example.com' },
      ],
    })

    const staff = await rows<{ ids: string[]; compEmails: string[] }>('staff')
    assert.deepEqual(staff.ids.sort(), [admin.toHexString(), founder.toHexString()].sort())
    assert.deepEqual(staff.compEmails, ['founder@example.test', 'tester@example.test'])
    assert.deepEqual(calls, [
      { collection: 'users', op: 'find', query: { $or: [{ role: 'admin' }, { email: { $in: ['founder@example.test', 'tester@example.test'] } }] }, projection: { _id: 1 }, readPreference: READ },
    ])

    env.COMP_EMAILS = ''
    calls.length = 0
    assert.deepEqual((await rows<{ ids: string[]; compEmails: string[] }>('staff')).ids, [admin.toHexString()])
    assert.deepEqual(calls[0]?.query, { $or: [{ role: 'admin' }] })
    env.COMP_EMAILS = ' Founder@Example.test , tester@example.test'
  })

  it('usersSince, usersByIds and purchasesSince: the metrics reads, ids and dates as strings', async () => {
    const recent = new ObjectId()
    const older = new ObjectId()
    const purchase = new ObjectId()
    const { rows, calls } = await growthApp({
      users: [
        { _id: recent, createdAt: ago(3), acquisition: { channel: 'meta', campaign: 'colors_us' }, location: { country: 'US' }, guest: true },
        { _id: older, createdAt: ago(40), proTrialAt: ago(35), pro: { status: 'trialing', trialEnd: ago(32), cancelAtPeriodEnd: false, interval: 'month' } },
      ],
      purchases: [
        { _id: purchase, userId: older, product: 'color_report', amountUsd: 499, amountTotal: 499, createdAt: ago(2), refundedAt: null },
        { _id: new ObjectId(), userId: older, product: 'pro_trial', amountUsd: 0, amountTotal: 0, createdAt: ago(35), refundedAt: null },
      ],
    })

    const since = ago(30).toISOString()
    assert.deepEqual(await rows('usersSince', { since }), [
      { _id: recent.toHexString(), createdAt: ago(3).toISOString(), acquisition: { channel: 'meta', campaign: 'colors_us' }, location: { country: 'US' }, guest: true },
    ])
    const [byId] = await rows<{ _id: string; proTrialAt: string; pro: { trialEnd: string } }[]>('usersByIds', { ids: [older.toHexString(), older.toHexString()] })
    assert.equal(byId?._id, older.toHexString())
    assert.equal(byId?.pro.trialEnd, ago(32).toISOString())
    assert.deepEqual(await rows('purchasesSince', { since }), [
      { _id: purchase.toHexString(), userId: older.toHexString(), product: 'color_report', amountUsd: 499, amountTotal: 499, createdAt: ago(2).toISOString(), refundedAt: null },
    ])

    assert.deepEqual(calls, [
      { collection: 'users', op: 'find', query: { createdAt: { $gte: ago(30) } }, projection: SCRIPT_USER_FIELDS, readPreference: READ },
      { collection: 'users', op: 'find', query: { _id: { $in: [older, older] } }, projection: SCRIPT_USER_FIELDS, readPreference: READ },
      {
        collection: 'purchases',
        op: 'find',
        query: { createdAt: { $gte: ago(30) } },
        projection: { userId: 1, product: 1, amountUsd: 1, amountTotal: 1, createdAt: 1, refundedAt: 1 },
        readPreference: READ,
      },
    ])
  })

  it('firstPaid: the first paid purchase per buyer, never a $0 trial or a refund', async () => {
    const [nora, ana, other] = [new ObjectId(), new ObjectId(), new ObjectId()]
    const { rows, calls } = await growthApp({
      purchases: [
        { userId: nora, product: 'color_report', amountUsd: 499, createdAt: ago(20), refundedAt: ago(19) },
        { userId: nora, product: 'pro_trial', amountUsd: 0, amountTotal: 0, createdAt: ago(10), refundedAt: null },
        { userId: nora, product: 'pro_monthly', amountUsd: 799, amountTotal: 799, createdAt: ago(3), refundedAt: null },
        { userId: nora, product: 'look_pack', amountUsd: 499, amountTotal: 499, createdAt: ago(1), refundedAt: null },
        { userId: ana, product: 'color_report', amountTotal: 499, createdAt: ago(5) },
        { userId: other, product: 'color_report', amountUsd: 499, createdAt: ago(4), refundedAt: null },
      ],
    })

    const first = await rows<{ _id: string; first: string }[]>('firstPaid', { userIds: [nora.toHexString(), ana.toHexString()] })
    assert.deepEqual(
      first.sort((a, b) => a.first.localeCompare(b.first)),
      [
        { _id: ana.toHexString(), first: ago(5).toISOString() },
        { _id: nora.toHexString(), first: ago(3).toISOString() },
      ],
    )
    assert.deepEqual(calls, [
      {
        collection: 'purchases',
        op: 'aggregate',
        query: [
          { $match: { userId: { $in: [nora, ana] }, refundedAt: null, $or: [{ amountUsd: { $gt: 0 } }, { amountTotal: { $gt: 0 } }] } },
          { $group: { _id: '$userId', first: { $min: '$createdAt' } } },
        ],
        readPreference: READ,
      },
    ])
  })

  it('funnelReached: which funnel events each new user reached', async () => {
    const [nora, ana] = [new ObjectId(), new ObjectId()]
    const event = (userId: ObjectId, name: string, at: Date) => ({ _id: new ObjectId(), userId, name, at })
    const { rows, calls } = await growthApp({
      analyticsEvents: [
        event(nora, 'avatar_photo_added', ago(2)),
        event(nora, 'avatar_photo_added', ago(1)),
        event(nora, 'colors_ready', ago(1)),
        event(nora, 'page_view', ago(1)),
        event(ana, 'checkout_created', ago(9)),
        event(new ObjectId(), 'colors_ready', ago(1)),
      ],
    })
    const names = ['avatar_photo_added', 'colors_ready', 'signup_completed', 'upsell_viewed', 'checkout_created']

    const reached = await rows<{ _id: { u: string; n: string } }[]>('funnelReached', { userIds: [nora.toHexString(), ana.toHexString()], names, since: ago(7).toISOString() })
    assert.deepEqual(
      reached.map((r) => `${r._id.u}:${r._id.n}`).sort(),
      [`${nora.toHexString()}:avatar_photo_added`, `${nora.toHexString()}:colors_ready`],
    )
    assert.deepEqual(calls, [
      {
        collection: 'analyticsEvents',
        op: 'aggregate',
        query: [{ $match: { userId: { $in: [nora, ana] }, name: { $in: names }, at: { $gte: ago(7) } } }, { $group: { _id: { u: '$userId', n: '$name' } } }],
        readPreference: READ,
      },
    ])
  })

  it('visitors: people per campaign and channel, never their visitor ids', async () => {
    const view = (visitorId: string, channel: string, campaign: string | null, at: Date, name = 'page_view') => ({ _id: new ObjectId(), name, visitorId, channel, campaign, at })
    const { rows, calls } = await growthApp({
      analyticsEvents: [
        view('visitor-aaaa', 'meta', 'colors_us', ago(0.5)),
        view('visitor-aaaa', 'meta', 'colors_us', ago(0.4)),
        view('visitor-bbbb', 'meta', 'colors_us', ago(0.3)),
        view('visitor-cccc', 'organic', null, ago(0.2)),
        view('visitor-dddd', 'meta', 'colors_us', ago(2)),
        view('visitor-eeee', 'meta', 'colors_us', ago(0.2), 'colors_ready'),
      ],
    })

    const response = await rows<{ _id: { c: string | null; ch: string }; people: number }[]>('visitors', { from: ago(1).toISOString(), to: now.toISOString() })
    assert.deepEqual(
      response.sort((a, b) => b.people - a.people),
      [
        { _id: { c: 'colors_us', ch: 'meta' }, people: 2 },
        { _id: { c: null, ch: 'organic' }, people: 1 },
      ],
    )
    assert.doesNotMatch(JSON.stringify(response), /visitor-/)
    assert.deepEqual(calls[0]?.query, [
      { $match: { name: 'page_view', at: { $gte: ago(1), $lt: now } } },
      { $group: { _id: { c: '$campaign', ch: '$channel' }, v: { $addToSet: '$visitorId' } } },
      { $project: { people: { $size: '$v' } } },
    ])
    assert.equal(calls[0]?.readPreference, READ)
  })

  it('segment: the customers.mjs segments, newest update first, at most 400', async () => {
    const people = {
      cancelled: { _id: new ObjectId(), email: 'cancelled@example.com', pro: { status: 'active', cancelAtPeriodEnd: true }, updatedAt: ago(3), createdAt: ago(60), paidAt: ago(40) },
      unopened: { _id: new ObjectId(), email: 'unopened@example.com', colorReportAt: ago(5), updatedAt: ago(4), createdAt: ago(60), paidAt: ago(50) },
      no_buy: { _id: new ObjectId(), email: 'nobuy@example.com', createdAt: ago(3), updatedAt: ago(2), paidAt: null },
      buyers: { _id: new ObjectId(), email: 'buyer@example.com', paidAt: ago(10), updatedAt: ago(9), createdAt: ago(12) },
    }
    const { collections, calls } = spyCollections({ users: Object.values(people) })
    const { rows } = await growthApp({ users: Object.values(people) })
    const filters = {
      cancelled: { 'pro.cancelAtPeriodEnd': true, updatedAt: { $gte: ago(10) } },
      unopened: { colorReportAt: { $gte: ago(14), $lte: ago(2) } },
      no_buy: { createdAt: { $gte: ago(7), $lte: ago(1) }, paidAt: null },
      buyers: { paidAt: { $gte: ago(30), $lte: ago(5) } },
    }

    for (const segment of ['cancelled', 'unopened', 'no_buy', 'buyers'] as const) {
      calls.length = 0
      const result = await runGrowthQuery(collections, 'segment', { segment }, now)
      assert.ok(result.ok)
      assert.deepEqual(
        (result.rows as { _id: ObjectId }[]).map((u) => u._id),
        [people[segment]._id],
        segment,
      )
      assert.deepEqual(calls, [
        { collection: 'users', op: 'find', query: filters[segment], projection: SCRIPT_CUSTOMER_FIELDS, readPreference: READ, sort: { updatedAt: -1 }, limit: 400 },
      ])
    }

    const [cancelled] = await rows<{ _id: string; email: string; updatedAt: string }[]>('segment', { segment: 'cancelled' })
    assert.equal(cancelled?._id, people.cancelled._id.toHexString())
    assert.equal(cancelled?.updatedAt, ago(3).toISOString())
  })

  it('userByEmail: one person by email, or null', async () => {
    const nora = new ObjectId()
    const { rows, calls } = await growthApp({ users: [{ _id: nora, email: 'nora@example.com', firstName: 'Nora', createdAt: ago(9) }] })

    assert.deepEqual(await rows('userByEmail', { email: '  Nora@Example.com ' }), { _id: nora.toHexString(), email: 'nora@example.com', firstName: 'Nora', createdAt: ago(9).toISOString() })
    assert.equal(await rows('userByEmail', { email: 'nobody@example.com' }), null)
    assert.deepEqual(calls[0], { collection: 'users', op: 'findOne', query: { email: 'nora@example.com' }, projection: SCRIPT_CUSTOMER_FIELDS, readPreference: READ })
  })

  it('context: avatars, unrefunded purchases and the last 30 days of checkouts', async () => {
    const [nora, ana] = [new ObjectId(), new ObjectId()]
    const seed = {
      avatars: [{ _id: new ObjectId(), userId: nora, colorAnalysis: { season: 'soft_autumn', undertone: 'warm' }, colorsAt: ago(6), colorReport: { createdAt: ago(5) }, avatarKey: 'users/n/avatar.png' }],
      purchases: [
        { _id: new ObjectId(), userId: nora, product: 'color_report', createdAt: ago(5), amountUsd: 499, refundedAt: null },
        { _id: new ObjectId(), userId: ana, product: 'color_report', createdAt: ago(4), amountUsd: 499, refundedAt: ago(3) },
      ],
      analyticsEvents: [
        { _id: new ObjectId(), userId: nora, name: 'checkout_created', props: { product: 'color_report' }, at: ago(6) },
        { _id: new ObjectId(), userId: nora, name: 'checkout_created', props: { product: 'pro_monthly' }, at: ago(1) },
        { _id: new ObjectId(), userId: nora, name: 'checkout_created', props: { product: 'look_pack' }, at: ago(40) },
        { _id: new ObjectId(), userId: nora, name: 'page_view', props: {}, at: ago(1) },
      ],
    }
    const { collections, calls } = spyCollections(seed)
    const userIds = [nora.toHexString(), ana.toHexString()]

    const result = await runGrowthQuery(collections, 'context', { userIds }, now)
    assert.ok(result.ok)
    const context = result.rows as { avatars: Doc[]; purchases: Doc[]; checkouts: { props: { product: string } }[] }
    assert.equal(context.avatars.length, 1)
    assert.deepEqual(context.purchases.map((p) => p.userId), [nora])
    assert.deepEqual(context.checkouts.map((c) => c.props.product), ['pro_monthly', 'color_report'])
    assert.deepEqual(calls, [
      {
        collection: 'avatars',
        op: 'find',
        query: { userId: { $in: [nora, ana] } },
        projection: { userId: 1, 'colorAnalysis.season': 1, 'colorAnalysis.undertone': 1, colorsAt: 1, 'colorReport.createdAt': 1, avatarKey: 1 },
        readPreference: READ,
      },
      { collection: 'purchases', op: 'find', query: { userId: { $in: [nora, ana] }, refundedAt: null }, projection: { userId: 1, product: 1, createdAt: 1, amountUsd: 1 }, readPreference: READ },
      {
        collection: 'analyticsEvents',
        op: 'find',
        query: { userId: { $in: [nora, ana] }, name: 'checkout_created', at: { $gte: ago(30) } },
        projection: { userId: 1, props: 1, at: 1 },
        readPreference: READ,
        sort: { at: -1 },
      },
    ])

    const { rows } = await growthApp(seed)
    const viaRoute = await rows<{ avatars: { userId: string; colorsAt: string }[]; purchases: unknown[]; checkouts: unknown[] }>('context', { userIds })
    assert.deepEqual(viaRoute.avatars.map((a) => [a.userId, a.colorsAt]), [[nora.toHexString(), ago(6).toISOString()]])
    assert.equal(viaRoute.purchases.length, 1)
  })
})

describe('growth data route: behavior', () => {
  // An instant at a Los Angeles hour, `days` days ago (stays inside that LA day).
  const laNoon = (days: number) => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ago(days))
    return { day, at: new Date(`${day}T19:00:00Z`) }
  }

  it('activeDays: the Los Angeles days each signed-in person used the site', async () => {
    const [nora, ana] = [new ObjectId(), new ObjectId()]
    const [d3, d1] = [laNoon(3), laNoon(1)]
    const event = (userId: ObjectId | null, at: Date, origin = 'web') => ({ _id: new ObjectId(), name: 'page_view', origin, userId, visitorId: 'v', at })
    const { rows, calls } = await growthApp({
      analyticsEvents: [
        event(nora, d3.at),
        event(nora, new Date(d3.at.getTime() + 60_000)),
        event(nora, d1.at),
        event(nora, d1.at, 'server'),
        event(ana, d1.at, 'server'),
        event(null, d1.at),
      ],
    })

    const active = await rows<{ _id: string; days: string[]; events: number }[]>('activeDays', { from: ago(10).toISOString(), to: now.toISOString() })
    assert.deepEqual(
      active.map((row) => ({ ...row, days: row.days.sort() })),
      [{ _id: nora.toHexString(), days: [d3.day, d1.day].sort(), events: 3 }],
    )
    assert.deepEqual(calls[0]?.query, [
      { $match: { at: { $gte: ago(10), $lt: now }, origin: 'web', userId: { $ne: null } } },
      { $group: { _id: '$userId', days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: 'America/Los_Angeles' } } }, events: { $sum: 1 } } },
    ])
    assert.equal(calls[0]?.readPreference, READ)
  })

  it('eventCounts: events, people and visitors per name and day, without the team', async () => {
    const [admin, nora, ana] = [new ObjectId(), new ObjectId(), new ObjectId()]
    const d1 = laNoon(1)
    const event = (name: string, userId: ObjectId | null, visitorId: string | null) => ({ _id: new ObjectId(), name, userId, visitorId, at: d1.at })
    const { rows } = await growthApp({
      users: [{ _id: admin, email: 'ops@example.test', role: 'admin' }],
      analyticsEvents: [
        event('look_generated', nora, 'v1'),
        event('look_generated', nora, 'v1'),
        event('look_generated', ana, 'v2'),
        event('look_generated', admin, 'v9'),
        event('page_view', null, 'v3'),
        event('page_view', null, 'v4'),
        event('page_view', nora, null),
      ],
    })

    const counts = await rows<{ _id: { n: string; d: string }; events: number; users: number; visitors: number }[]>('eventCounts', {
      from: ago(5).toISOString(),
      to: now.toISOString(),
    })
    assert.deepEqual(
      counts.sort((a, b) => a._id.n.localeCompare(b._id.n)),
      [
        { _id: { n: 'look_generated', d: d1.day }, events: 3, users: 2, visitors: 2 },
        { _id: { n: 'page_view', d: d1.day }, events: 3, users: 1, visitors: 2 },
      ],
    )
  })

  it('offerEvents: each offer step by reason, placement and product, in people, without the team', async () => {
    const [admin, nora, ana] = [new ObjectId(), new ObjectId(), new ObjectId()]
    const at = ago(1)
    const event = (name: string, userId: ObjectId | null, visitorId: string | null, props: Doc) => ({ _id: new ObjectId(), name, userId, visitorId, props, at })
    const shown = { reason: 'pro_credit', placement: 'purchase_success_pro_credit' }
    const { rows, calls } = await growthApp({
      users: [{ _id: admin, email: 'ops@example.test', role: 'admin' }],
      analyticsEvents: [
        event('paywall_viewed', nora, 'v1', shown),
        event('paywall_viewed', nora, 'v1', shown),
        event('paywall_viewed', ana, 'v2', shown),
        event('paywall_viewed', admin, 'v9', shown),
        event('pair_toggled', null, 'v3', { on: true, placement: 'colors_result' }),
        event('checkout_started', nora, 'v1', { product: 'pro_annual', amount: 2999, placement: 'purchase_success_pro_credit' }),
        event('look_generated', nora, 'v1', {}),
      ],
    })

    const offers = await rows<{ _id: Doc; events: number; people: number }[]>('offerEvents', { from: ago(5).toISOString(), to: now.toISOString() })
    assert.deepEqual(
      offers.map((row) => [row._id.n, row.events, row.people]).sort(),
      [
        ['checkout_started', 1, 1],
        ['pair_toggled', 1, 1],
        ['paywall_viewed', 3, 2],
      ],
    )
    assert.deepEqual(offers.find((row) => row._id.n === 'checkout_started')?._id, { n: 'checkout_started', placement: 'purchase_success_pro_credit', product: 'pro_annual' })
    assert.deepEqual(calls.at(-1)?.query, [
      {
        $match: {
          at: { $gte: ago(5), $lt: now },
          userId: { $nin: [admin] },
          name: { $in: ['paywall_viewed', 'paywall_closed', 'pair_toggled', 'checkout_started', 'checkout_created', 'purchase_completed'] },
        },
      },
      {
        $group: {
          _id: { n: '$name', reason: '$props.reason', placement: '$props.placement', product: '$props.product', on: '$props.on' },
          events: { $sum: 1 },
          p: { $addToSet: { $ifNull: ['$userId', '$visitorId'] } },
        },
      },
      { $project: { events: 1, people: { $size: { $setDifference: ['$p', [null]] } } } },
    ])
  })

  it('surveyAnswers and feedback: the answers and reviews since a date, newest first', async () => {
    const nora = new ObjectId()
    const { rows, calls } = await growthApp({
      surveyAnswers: [
        { _id: new ObjectId(), userId: nora, question: 'held_back', answer: 'too_expensive', note: null, context: { placement: 'colors_result' }, content: 'colors_e', createdAt: ago(2) },
        { _id: new ObjectId(), userId: nora, question: 'intent', answer: 'event', note: null, context: {}, content: null, createdAt: ago(20) },
      ],
      feedback: [
        { _id: new ObjectId(), userId: nora, product: 'color_advisor', score: 9, comment: 'Loved it', quoteOk: true, locale: 'en', region: 'US', pro: false, content: null, createdAt: ago(3), updatedAt: ago(3) },
      ],
    })

    const answers = await rows<{ answer: string }[]>('surveyAnswers', { since: ago(7).toISOString() })
    assert.deepEqual(answers.map((row) => row.answer), ['too_expensive'])
    const reviews = await rows<{ score: number; comment: string }[]>('feedback', { since: ago(7).toISOString() })
    assert.deepEqual(reviews.map((row) => [row.score, row.comment]), [[9, 'Loved it']])
    assert.deepEqual(calls, [
      {
        collection: 'surveyAnswers',
        op: 'find',
        query: { createdAt: { $gte: ago(7) } },
        projection: { userId: 1, question: 1, answer: 1, note: 1, context: 1, content: 1, createdAt: 1 },
        readPreference: READ,
        sort: { createdAt: -1 },
        limit: 5000,
      },
      {
        collection: 'feedback',
        op: 'find',
        query: { updatedAt: { $gte: ago(7) } },
        projection: { userId: 1, product: 1, score: 1, comment: 1, locale: 1, region: 1, pro: 1, content: 1, createdAt: 1, updatedAt: 1 },
        readPreference: READ,
        sort: { updatedAt: -1 },
        limit: 2000,
      },
    ])
  })

  it('generationHealth: generations by status, top errors without keys or emails, and open alerts', async () => {
    const look = (status: string, error: string | null, createdAt: Date) => ({ _id: new ObjectId(), status, error, createdAt })
    const { collections } = spyCollections({
      looks: [
        look('ready', null, ago(0.1)),
        look('ready', null, ago(0.2)),
        look('failed', 'OpenAI 401: Incorrect API key provided: sk-proj-abc123XYZ', ago(0.3)),
        look('failed', 'Timed out for ana@example.com', ago(0.4)),
        look('failed', 'Timed out for ana@example.com', ago(0.5)),
        look('failed', 'old', ago(3)),
      ],
      opsAlerts: [{ _id: 'reads_failing', lastSentAt: ago(0.2), openSince: ago(0.3), lastError: 'boom' }],
    })

    const result = await runGrowthQuery(collections, 'generationHealth', { hours: 24 }, now)
    assert.ok(result.ok)
    const health = result.rows as { collections: { name: string; byStatus: Record<string, number>; errors: { error: string; n: number }[] }[]; alerts: { kind: string; lastError: string }[] }
    const looks = health.collections.find((row) => row.name === 'looks')
    assert.deepEqual(looks?.byStatus, { ready: 2, failed: 3 })
    assert.deepEqual(looks?.errors, [
      { error: 'Timed out for [email]', n: 2 },
      { error: 'OpenAI 401: Incorrect API key provided: [key]', n: 1 },
    ])
    assert.deepEqual(health.collections.find((row) => row.name === 'avatars'), { name: 'avatars', byStatus: {}, errors: [] })
    assert.deepEqual(health.alerts.map((alert) => [alert.kind, alert.lastError]), [['reads_failing', 'boom']])
  })
})
