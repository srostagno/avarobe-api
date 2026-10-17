import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { form, json, memoryStorage, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { ProSubscription, ScoreCheckDocument } from '../../../types/mongo.js'
import { differenceHash, hashDistance } from '../../../utils/photo-hash.js'
import { criterionIds } from '../rubrics.js'
import scoreRoutes from '../routes.js'
import { currentScore, scoreFrom, weakestFirst } from '../score.js'
import { failStaleScoreReads } from '../service.js'

// Look Score and Hair Score (Oct 17, 2026): measured against the rubric in
// English with fixed settings, scored in code, explained in her language;
// 3 free photos per kind, the rest is Pro's; the same photo again is never
// read twice.

const pro: ProSubscription = {
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval: 'month',
  periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  cancelAtPeriodEnd: false,
}

// A photo with a pattern of its own (never a face): another seed, another picture.
async function pattern(seed: number) {
  let state = seed * 9301 + 49297
  const random = () => {
    state = (state * 9301 + 49297) % 233280
    return state / 233280
  }
  const cells = Buffer.from(Array.from({ length: 16 * 16 }, () => Math.floor(random() * 255)))

  return sharp(cells, { raw: { width: 16, height: 16, channels: 1 } }).resize(480, 480, { kernel: 'nearest' }).png().toBuffer()
}

const LOOK_RATINGS = { color: 3, fit: 2, proportion: 2, cohesion: 3, finish: 1 }

const measured = (criteria: Record<string, number>, overrides: Record<string, unknown> = {}) =>
  json(200, { output_text: JSON.stringify({ usable: true, problem: 'none', photo: { light: 'good', framing: 'good' }, criteria, ...overrides }) })

const words = (kind: 'look' | 'hair') =>
  json(200, {
    output_text: JSON.stringify({
      headline: 'A warm, easy look that suits you.',
      strengths: ['The rust knit warms your face.'],
      holdingBack: ['The sneakers make it look unfinished.'],
      tips:
        kind === 'look'
          ? [
              { area: 'color', criterion: 'color', text: 'Keep the warm knit.' },
              { area: 'shoes', criterion: 'finish', text: 'Swap the sneakers for loafers.' },
              { area: 'fit', criterion: 'fit', text: 'Hem the trousers to the ankle.' },
            ]
          : [
              { area: 'cut', criterion: 'shape', text: 'Ask for face-framing layers.' },
              { area: 'care', criterion: 'condition', text: 'A gloss treatment.' },
              { area: 'styling', criterion: 'styling', text: 'Blow-dry at the roots.' },
            ],
    }),
  })

describe('the score', () => {
  it('is computed from the criteria, with a floor and never 100', () => {
    const ids = criterionIds('look')

    assert.equal(scoreFrom(LOOK_RATINGS, ids, { offset: 0, floor: 35 }), 55)
    assert.equal(scoreFrom({ color: 4, fit: 4, proportion: 4, cohesion: 4, finish: 4 }, ids, { offset: 0, floor: 35 }), 99)
    assert.equal(scoreFrom({ color: 0, fit: 0, proportion: 1, cohesion: 0, finish: 0 }, ids, { offset: 0, floor: 35 }), 35)
    assert.equal(scoreFrom(LOOK_RATINGS, ids, { offset: 5, floor: 35 }), 60)
  })

  it('puts the weakest criterion first', () => {
    assert.deepEqual(weakestFirst(LOOK_RATINGS, criterionIds('look')).slice(0, 2), ['finish', 'fit'])
  })

  it('is “now” from her recent photos, so one bad photo doesn’t swing it', () => {
    const at = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    assert.equal(currentScore([]), null)
    assert.equal(currentScore([{ takenAt: at(0), score: 70 }, { takenAt: at(1), score: 40 }, { takenAt: at(2), score: 72 }]), 70)
    assert.equal(currentScore([{ takenAt: at(0), score: 70 }, { takenAt: at(200), score: 40 }]), 70)
  })

  it('knows the same picture after re-saving it', async () => {
    const original = await pattern(1)
    const resaved = await sharp(original).jpeg({ quality: 60 }).toBuffer()

    assert.ok(hashDistance(await differenceHash(original), await differenceHash(resaved)) <= 6)
    assert.ok(hashDistance(await differenceHash(original), await differenceHash(await pattern(2))) > 6)
  })
})

describe('Score routes', () => {
  let files: ReturnType<typeof memoryStorage>
  let ai: ReturnType<typeof stubOpenAi>
  const saved = { free: env.SCORE_FREE_PHOTOS, comp: env.COMP_EMAILS, samples: env.SCORE_SAMPLES, on: env.SCORES_ENABLED, daily: env.DAILY_SCORE_LIMIT }

  beforeEach(() => {
    files = memoryStorage()
    ai = stubOpenAi()
    ai.state.reply = (call) => (call.schema.endsWith('_measure') ? measured(LOOK_RATINGS) : words(call.schema.startsWith('hair') ? 'hair' : 'look'))
    Object.assign(env, { SCORE_FREE_PHOTOS: 3, COMP_EMAILS: 'owner@avarobe.test', SCORE_SAMPLES: 1, SCORES_ENABLED: 'on', DAILY_SCORE_LIMIT: 20 })
  })

  afterEach(() => {
    files.restore()
    ai.restore()
    Object.assign(env, {
      SCORE_FREE_PHOTOS: saved.free,
      COMP_EMAILS: saved.comp,
      SCORE_SAMPLES: saved.samples,
      SCORES_ENABLED: saved.on,
      DAILY_SCORE_LIMIT: saved.daily,
    })
  })

  const consented = { consentAt: new Date(), consentVersion: 'scores-2026-10-17', consentMethod: 'tap', createdAt: new Date() }

  async function setup(userFields: Record<string, unknown> = { scoreProfile: consented }) {
    const userId = new ObjectId()
    const built = await routeApp({ '/scores': scoreRoutes }, { users: [{ _id: userId, email: 'rosa@example.com', credits: 0, createdAt: new Date(), locale: 'es', ...userFields }] })
    const headers = built.auth(userId)
    const send = async (kind: 'look' | 'hair', seed: number, image?: Buffer) => {
      const body = await form({ source: 'camera' }, { photo: image ?? (await pattern(seed)) }, headers)
      return built.app.inject({ method: 'POST', url: `/scores/${kind}/photos`, ...body })
    }
    const checks = () => built.collection('scoreChecks').docs as ScoreCheckDocument[]
    const user = () => built.collection('users').docs[0] as Record<string, unknown> & { freeUses?: Record<string, number>; scoreProfile?: { consentMethod: string } }
    const settled = (count: number) => until(async () => checks().length >= count && checks().every((check) => check.status !== 'processing'))

    return { ...built, headers, send, checks, user, settled, userId }
  }

  it('starts with her tap, or the box in Illinois', async () => {
    const { app, headers, user } = await setup({})
    const start = (payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: '/scores/profile', headers: { ...headers, ...extra }, payload })

    assert.equal((await start({})).statusCode, 400)
    assert.equal((await start({ consent: true }, { cookie: 'avarobe_geo=US-IL' })).statusCode, 409)
    assert.equal((await start({ consent: true, method: 'checkbox' }, { cookie: 'avarobe_geo=US-IL' })).statusCode, 200)
    assert.equal(user().scoreProfile?.consentMethod, 'checkbox')
  })

  it('asks for her release before any photo', async () => {
    const { send } = await setup({})
    const response = await send('look', 1)

    assert.equal(response.statusCode, 409)
    assert.equal(response.json<{ code: string }>().code, 'score_setup')
  })

  it('measures in English with fixed settings, never kept, and explains in her language', async () => {
    const { send, settled, checks } = await setup()

    assert.equal((await send('look', 1)).statusCode, 202)
    await settled(1)

    const measure = ai.calls.find((call) => call.schema === 'look_score_measure')!
    const explain = ai.calls.find((call) => call.schema === 'look_score_words')!
    assert.equal(measure.body.temperature, 0)
    assert.deepEqual(measure.body.reasoning, { effort: 'none' })
    assert.equal(measure.body.store, false)
    assert.equal(explain.body.store, false)
    assert.ok(!String(measure.body.instructions).includes('Write in Spanish'))
    assert.match(String(explain.body.instructions), /Spanish|español/i)
    assert.equal(checks()[0]?.reading?.score, 55)
    assert.equal(checks()[0]?.reading?.tips[0]?.criterion, 'finish')
  })

  it('shows free users the score, the weakest criterion and one tip; nothing else leaves', async () => {
    const { app, headers, send, settled } = await setup()

    await send('look', 1)
    await settled(1)

    const state = await app.inject({ method: 'GET', url: '/scores/look', headers })
    const body = state.json<{
      checks: { score: number; reading: { weakest: string; criteria: { id: string; value: number | null }[]; tips: unknown[]; lockedTips: number } }[]
      summary: { score: number; averages: unknown }
      allowance: { freeLeft: number }
    }>()
    const reading = body.checks[0]!.reading

    assert.equal(body.checks[0]?.score, 55)
    assert.equal(reading.weakest, 'finish')
    assert.deepEqual(reading.criteria.filter((criterion) => criterion.value !== null), [{ id: 'finish', value: 1 }])
    assert.equal(reading.tips.length, 1)
    assert.equal(reading.lockedTips, 2)
    assert.equal(body.summary.averages, null)
    assert.equal(body.allowance.freeLeft, 2)
    assert.ok(!state.body.includes('Hem the trousers'))
  })

  it('shows Pro everything', async () => {
    const { app, headers, send, settled } = await setup({ scoreProfile: consented, pro })

    await send('look', 1)
    await settled(1)

    const body = (await app.inject({ method: 'GET', url: '/scores/look', headers })).json<{
      checks: { reading: { criteria: { value: number | null }[]; tips: unknown[]; lockedTips: number } }[]
      summary: { averages: Record<string, number> }
    }>()

    assert.ok(body.checks[0]!.reading.criteria.every((criterion) => criterion.value !== null))
    assert.equal(body.checks[0]!.reading.tips.length, 3)
    assert.equal(body.summary.averages.color, 3)
  })

  it('gives 3 free photos per kind, then the Pro offer', async () => {
    const { send, settled } = await setup()

    for (const seed of [1, 2, 3]) {
      assert.equal((await send('look', seed)).statusCode, 202)
      await settled(seed)
    }

    const fourth = await send('look', 4)
    assert.equal(fourth.statusCode, 402)
    assert.equal(fourth.json<{ code: string }>().code, 'needs_pro')
    // Hair has its own three.
    assert.equal((await send('hair', 5)).statusCode, 202)
  })

  it('never reads the same photo twice, and uses nothing for it', async () => {
    const { send, settled, user } = await setup()
    const image = await pattern(7)

    await send('look', 0, image)
    await settled(1)
    const reads = ai.calls.length

    const again = await send('look', 0, await sharp(image).jpeg({ quality: 70 }).toBuffer())
    assert.equal(again.statusCode, 409)
    assert.equal(again.json<{ code: string; check: { score: number } }>().code, 'duplicate')
    assert.equal(again.json<{ check: { score: number } }>().check.score, 55)
    assert.equal(ai.calls.length, reads)
    assert.equal(user().freeUses?.look_score, 1)
  })

  it('deletes a photo it can’t read and gives its free place back', async () => {
    ai.state.reply = (call) => (call.schema.endsWith('_measure') ? measured(LOOK_RATINGS, { usable: false, problem: 'not_full_body' }) : words('look'))
    const { send, settled, checks, user } = await setup()
    const key = (await send('look', 1)).json<{ check: { id: string } }>().check.id

    await settled(1)
    assert.equal(checks()[0]?.status, 'failed')
    assert.equal(checks()[0]?.error, 'unreadable:not_full_body')
    assert.equal(checks()[0]?.photoKey, '')
    assert.ok(files.removed.some((file) => file.includes(key)))
    assert.equal(user().freeUses?.look_score, 0)
  })

  it('stops at someone who looks under 18', async () => {
    ai.state.reply = (call) => (call.schema.endsWith('_measure') ? measured(LOOK_RATINGS, { usable: false, problem: 'minor' }) : words('look'))
    const { send, settled, checks } = await setup()

    await send('hair', 1)
    await settled(1)
    assert.equal(checks()[0]?.error, 'unreadable:minor')
    assert.ok(!ai.calls.some((call) => call.schema === 'hair_score_words'))
  })

  it('stops at the day’s cap', async () => {
    env.DAILY_SCORE_LIMIT = 1
    const { send, settled } = await setup({ scoreProfile: consented, pro })

    await send('look', 1)
    await settled(1)
    const capped = await send('hair', 2)
    assert.equal(capped.statusCode, 429)
  })

  it('deletes one photo, then all of a kind', async () => {
    const { app, headers, send, settled, checks } = await setup()

    await send('look', 1)
    await send('hair', 2)
    await settled(2)

    const lookId = checks().find((check) => check.kind === 'look')!._id.toString()
    assert.equal((await app.inject({ method: 'DELETE', url: `/scores/look/photos/${lookId}`, headers })).statusCode, 204)
    assert.equal(checks().length, 1)
    assert.equal((await app.inject({ method: 'DELETE', url: '/scores/hair', headers })).statusCode, 204)
    assert.equal(checks().length, 0)
  })

  it('fails a read a restart cut short and gives back what it took', async () => {
    const { app, user, userId, collection } = await setup()
    const old = new Date(Date.now() - 60 * 60 * 1000)

    collection('users').docs[0]!.freeUses = { hair_score: 1 }
    collection('scoreChecks').docs.push({
      _id: new ObjectId(),
      userId,
      kind: 'hair',
      status: 'processing',
      error: null,
      photoKey: `users/${userId.toString()}/hairscore-x.jpg`,
      photoHash: 'x',
      photoDHash: '0000000000000000',
      takenAt: old,
      source: 'camera',
      dateSource: 'now',
      freeUse: true,
      reading: null,
      createdAt: old,
      updatedAt: old,
    })

    assert.equal(await failStaleScoreReads(app), 1)
    assert.equal(user().freeUses?.hair_score, 0)
  })

  it('fixes a look on her avatar with Pro, for one credit, once', async () => {
    const fixPlan = json(200, {
      output_text: JSON.stringify({
        hasOutfit: true,
        dressCode: 'Smart casual',
        title: 'Rust knit, fixed',
        vibe: 'classic',
        summary: 'Your rust knit with loafers.',
        whyItWorks: 'The warm knit stays; loafers finish it.',
        items: [
          { slot: 'top', name: 'Crew-neck knit', color: 'Rust', colorHex: '#A0482A', material: 'Wool', fit: 'Relaxed', fromPhoto: true },
          { slot: 'shoes', name: 'Loafers', color: 'Cognac', colorHex: '#8B4A2B', material: 'Leather', fit: 'Classic', fromPhoto: false },
        ],
        stylingTips: ['Tuck the front.'],
      }),
    })
    ai.state.reply = (call) =>
      call.schema === 'score_fix' ? fixPlan : call.schema.endsWith('_measure') ? measured(LOOK_RATINGS) : words('look')
    ai.state.images = 1
    ai.state.image = await pattern(9)

    const free = await setup()
    await free.send('look', 1)
    await free.settled(1)
    const blocked = await free.app.inject({ method: 'POST', url: `/scores/look/photos/${free.checks()[0]!._id.toString()}/fix`, headers: free.headers })
    assert.equal(blocked.statusCode, 409) // no avatar yet

    const { app, headers, send, settled, checks, collection, userId } = await setup({ scoreProfile: consented, pro, credits: 30 })
    files.files.set(`users/${userId.toString()}/avatar.webp`, await pattern(10))
    files.files.set(`users/${userId.toString()}/selfie.jpg`, await pattern(11))
    collection('avatars').docs.push({ _id: new ObjectId(), userId, status: 'ready', avatarKey: `users/${userId.toString()}/avatar.webp`, selfieKey: `users/${userId.toString()}/selfie.jpg`, versions: [], body: { heightCm: 165, weightKg: 62, build: 'average', presentation: 'womenswear' } })
    await send('look', 2)
    await settled(1)
    const url = `/scores/look/photos/${checks()[0]!._id.toString()}/fix`

    const fixed = await app.inject({ method: 'POST', url, headers })
    assert.equal(fixed.statusCode, 202)
    const look = collection('looks').docs[0] as { referenceKey?: string; source: string; plan: { items: { fromPhoto: boolean }[] } }
    assert.equal(look.source, 'stylist')
    assert.equal(look.referenceKey, undefined)
    assert.equal(look.plan.items.filter((item) => !item.fromPhoto).length, 1)
    assert.equal((collection('users').docs[0] as { credits: number }).credits, 29)

    const again = await app.inject({ method: 'POST', url, headers })
    assert.equal(again.statusCode, 200)
    assert.equal(collection('looks').docs.length, 1)
  })

  it('is off with SCORES_ENABLED=off', async () => {
    env.SCORES_ENABLED = 'off'
    const { app, headers } = await setup()

    assert.equal((await app.inject({ method: 'GET', url: '/scores/look', headers })).statusCode, 404)
  })
})
