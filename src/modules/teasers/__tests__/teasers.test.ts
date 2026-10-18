import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { form, json, memoryStorage, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { ProSubscription, TeaserDocument } from '../../../types/mongo.js'
import makeupRoutes from '../../makeup/routes.js'
import scoreRoutes from '../../scores/routes.js'
import teaserRoutes from '../routes.js'
import { grantWowOffer } from '../../feedback/wow-offer.js'
import { maybeStartTeaser } from '../service.js'

// Her best version drawn ahead and blurred (Pro plan phase 1, Oct 18, 2026):
// after her first read, once, only without Pro; the half-price first month
// with it; with Pro it's hers at once, without a credit.

const pro: ProSubscription = {
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval: 'month',
  periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  cancelAtPeriodEnd: false,
}

async function pattern(seed: number) {
  let state = seed * 7919 + 13
  const cells = Buffer.from(Array.from({ length: 256 }, () => (state = (state * 9301 + 49297) % 233280) % 255))
  return sharp(cells, { raw: { width: 16, height: 16, channels: 1 } }).resize(480, 480, { kernel: 'nearest' }).png().toBuffer()
}

const measured = () =>
  json(200, { output_text: JSON.stringify({ usable: true, problem: 'none', shows: 'upper_body', photo: { light: 'good', framing: 'good' }, criteria: { shape: 2, color: 3, condition: 2, styling: 2, modern: 2 } }) })
const words = () =>
  json(200, {
  output_text: JSON.stringify({
    headline: 'Soft, easy hair.',
    strengths: ['Healthy shine.'],
    holdingBack: ['The shape is heavy.'],
    tips: [
      { area: 'cut', criterion: 'shape', text: 'Ask for face-framing layers.' },
      { area: 'care', criterion: 'condition', text: 'A gloss treatment.' },
      { area: 'styling', criterion: 'styling', text: 'Blow-dry at the roots.' },
    ],
  }),
})
const hairPlan = () =>
  json(200, { output_text: JSON.stringify({ isHaircut: true, name: 'Soft layered lob', render: 'A soft layered lob.', stylistBrief: 'Collarbone lob.', fit: { verdict: 'great', note: 'Frames your face.' } }) })

describe('Teasers', () => {
  let files: ReturnType<typeof memoryStorage>
  let ai: ReturnType<typeof stubOpenAi>
  const saved = { comp: env.COMP_EMAILS, samples: env.SCORE_SAMPLES, on: env.SCORES_ENABLED, makeup: env.MAKEUP_ENABLED }

  beforeEach(async () => {
    files = memoryStorage()
    ai = stubOpenAi()
    ai.state.reply = (call) => (call.schema === 'hair_request' ? hairPlan() : call.schema.endsWith('_measure') ? measured() : words())
    ai.state.images = 2
    ai.state.image = await pattern(99)
    Object.assign(env, { COMP_EMAILS: '', SCORE_SAMPLES: 1, SCORES_ENABLED: 'on', MAKEUP_ENABLED: 'on' })
  })

  afterEach(() => {
    files.restore()
    ai.restore()
    Object.assign(env, { COMP_EMAILS: saved.comp, SCORE_SAMPLES: saved.samples, SCORES_ENABLED: saved.on, MAKEUP_ENABLED: saved.makeup })
  })

  async function setup(userFields: Record<string, unknown> = {}) {
    const userId = new ObjectId()
    const avatarKey = `users/${userId.toString()}/avatar.webp`
    const selfieKey = `users/${userId.toString()}/selfie.jpg`
    files.files.set(avatarKey, await pattern(1))
    files.files.set(selfieKey, await pattern(2))
    const consented = { consentAt: new Date(), consentVersion: 'scores-2026-10-17', consentMethod: 'tap', createdAt: new Date() }
    const built = await routeApp(
      { '/scores': scoreRoutes, '/teasers': teaserRoutes, '/makeup': makeupRoutes },
      {
        users: [{ _id: userId, email: 'rosa@example.com', credits: 0, createdAt: new Date(), scoreProfile: consented, ...userFields }],
        avatars: [{ _id: new ObjectId(), userId, status: 'ready', avatarKey, selfieKey, versions: [], body: { heightCm: 165, weightKg: 62, build: 'average', presentation: 'womenswear' } }],
      },
    )
    const headers = built.auth(userId)
    const teasers = () => built.collection('teasers').docs as TeaserDocument[]
    const user = () => built.collection('users').docs[0] as Record<string, unknown> & { credits?: number; proHalfOffer?: { from: string } | null }
    const scoreHair = async () => {
      const body = await form({ source: 'camera' }, { photo: await pattern(3) }, headers)
      await built.app.inject({ method: 'POST', url: '/scores/hair/photos', ...body })
      await until(async () => built.collection('scoreChecks').docs.every((check) => (check as { status: string }).status !== 'processing'))
    }

    return { ...built, headers, teasers, user, scoreHair, userId }
  }

  it('draws her perfect haircut after her first Hair Score, blurred, with the half-price month', async () => {
    const { app, headers, teasers, user, scoreHair } = await setup()

    await scoreHair()
    await until(async () => teasers()[0]?.status === 'ready')

    assert.equal(teasers()[0]?.kind, 'perfect_haircut')
    assert.equal(user().proHalfOffer?.from, 'hair_score')

    const state = (await app.inject({ method: 'GET', url: '/scores/hair', headers })).json<{ checks: { teaser: { status: string; lockedUrl: string | null; resultId: string | null } }[] }>()
    assert.equal(state.checks[0]?.teaser.status, 'ready')
    assert.match(state.checks[0]?.teaser.lockedUrl ?? '', /-locked\.webp$/)
    // The sharp picture never leaves while it's locked.
    assert.ok(!JSON.stringify(state).includes(`${teasers()[0]!.key}`))
  })

  it('draws it once, and never for Pro', async () => {
    const free = await setup()

    await free.scoreHair()
    await until(async () => free.teasers()[0]?.status === 'ready')
    assert.equal(await maybeStartTeaser(free.app, free.userId, 'perfect_haircut', new ObjectId(), { tips: [] }), null)
    assert.equal(free.teasers().length, 1)

    const paid = await setup({ pro, credits: 30 })
    await paid.scoreHair()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(paid.teasers().length, 0)
    assert.equal(paid.user().proHalfOffer ?? null, null)
  })

  it('stays locked without Pro, and is hers at once with Pro, without a credit', async () => {
    const { app, headers, teasers, user, scoreHair, collection } = await setup({ credits: 5 })

    await scoreHair()
    await until(async () => teasers()[0]?.status === 'ready')
    const id = teasers()[0]!._id.toString()

    assert.equal((await app.inject({ method: 'POST', url: `/teasers/${id}/unlock`, headers })).statusCode, 402)

    collection('users').docs[0]!.pro = pro
    const unlocked = await app.inject({ method: 'POST', url: `/teasers/${id}/unlock`, headers })
    assert.equal(unlocked.statusCode, 200)
    const hairstyle = collection('hairstyles').docs[0] as { status: string; imageKey: string; name: string }
    assert.equal(hairstyle.status, 'ready')
    assert.equal(hairstyle.imageKey, teasers()[0]!.key)
    assert.equal(hairstyle.name, 'Soft layered lob')
    assert.equal(user().credits, 5)

    const state = (await app.inject({ method: 'GET', url: '/scores/hair', headers })).json<{ checks: { perfect: { status: string } | null }[] }>()
    assert.equal(state.checks[0]?.perfect?.status, 'ready')
  })

  it('hands over the one drawn ahead through the perfect-haircut button, without drawing another', async () => {
    const { app, headers, teasers, scoreHair, collection } = await setup({ pro: null })

    await scoreHair()
    await until(async () => teasers()[0]?.status === 'ready')
    collection('users').docs[0]!.pro = pro
    collection('users').docs[0]!.credits = 10
    const checkId = (collection('scoreChecks').docs[0] as { _id: ObjectId })._id.toString()
    const response = await app.inject({ method: 'POST', url: `/scores/hair/photos/${checkId}/perfect`, headers })

    assert.equal(response.statusCode, 200)
    assert.equal(collection('hairstyles').docs.length, 1)
    assert.equal((collection('users').docs[0] as { credits: number }).credits, 10)
  })

  it('draws her best face from her selfie after a Face Age read', async () => {
    const { app, headers, teasers, userId } = await setup()
    const faceCheckId = new ObjectId()

    await maybeStartTeaser(app, userId, 'best_face', faceCheckId, { tips: ['A rosy blush.'], faceTips: [{ area: 'makeup', text: 'A rosy blush.' }] })
    await until(async () => teasers()[0]?.status === 'ready')
    assert.equal(teasers()[0]?.plan?.name, 'Your best face')

    const list = (await app.inject({ method: 'GET', url: '/teasers', headers })).json<{ teasers: { kind: string; sourceId: string }[] }>()
    assert.deepEqual(list.teasers.map((teaser) => [teaser.kind, teaser.sourceId]), [['best_face', faceCheckId.toString()]])
  })

  it('gives the half-price month once, never after a trial', async () => {
    const fresh = await setup()
    assert.equal(await grantWowOffer(fresh.app, fresh.userId, 'face_age'), true)
    assert.equal(await grantWowOffer(fresh.app, fresh.userId, 'look_score'), false)
    assert.equal(fresh.user().proHalfOffer?.from, 'face_age')

    const trialed = await setup({ proTrialAt: new Date() })
    assert.equal(await grantWowOffer(trialed.app, trialed.userId, 'face_age'), false)
  })
})
