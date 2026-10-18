import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { form, json, memoryStorage, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { TeaserDocument, UserDocument } from '../../../types/mongo.js'
import scoreRoutes from '../../scores/routes.js'
import { maybeStartTeaser } from '../../teasers/service.js'
import inviteRoutes from '../routes.js'
import { INVITE_REWARD_CAP, rewardInviter } from '../service.js'

// Invites (Oct 18, 2026): a friend who signs up through her link and does
// her first read unlocks one of her teasers, without Pro.

async function pattern(seed: number) {
  let state = seed * 7919 + 13
  const cells = Buffer.from(Array.from({ length: 256 }, () => (state = (state * 9301 + 49297) % 233280) % 255))
  return sharp(cells, { raw: { width: 16, height: 16, channels: 1 } }).resize(480, 480, { kernel: 'nearest' }).png().toBuffer()
}

const measured = () => json(200, { output_text: JSON.stringify({ usable: true, problem: 'none', shows: 'upper_body', photo: { light: 'good', framing: 'good' }, criteria: { shape: 2, color: 3, condition: 2, styling: 2, modern: 2 } }) })
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
const hairPlan = () => json(200, { output_text: JSON.stringify({ isHaircut: true, name: 'Soft layered lob', render: 'A soft lob.', stylistBrief: 'Lob.', fit: { verdict: 'great', note: 'Frames your face.' } }) })

describe('Invites', () => {
  let files: ReturnType<typeof memoryStorage>
  let ai: ReturnType<typeof stubOpenAi>
  const saved = { comp: env.COMP_EMAILS, samples: env.SCORE_SAMPLES, on: env.SCORES_ENABLED }

  beforeEach(async () => {
    files = memoryStorage()
    ai = stubOpenAi()
    ai.state.reply = (call) => (call.schema === 'hair_request' ? hairPlan() : call.schema.endsWith('_measure') ? measured() : words())
    ai.state.images = 4
    ai.state.image = await pattern(99)
    Object.assign(env, { COMP_EMAILS: '', SCORE_SAMPLES: 1, SCORES_ENABLED: 'on' })
  })

  afterEach(() => {
    files.restore()
    ai.restore()
    Object.assign(env, { COMP_EMAILS: saved.comp, SCORE_SAMPLES: saved.samples, SCORES_ENABLED: saved.on })
  })

  // Rosa (with her Hair Score's perfect haircut, locked) and Ana, who just
  // signed up through Rosa's link.
  async function setup(options: { rosaTeaser?: boolean; anaCreated?: Date } = {}) {
    const rosaId = new ObjectId()
    const anaId = new ObjectId()
    const consented = { consentAt: new Date(), consentVersion: 'scores-2026-10-17', consentMethod: 'tap', createdAt: new Date() }
    const built = await routeApp(
      { '/scores': scoreRoutes, '/invites': inviteRoutes },
      {
        users: [
          { _id: rosaId, email: 'rosa@example.com', credits: 0, createdAt: new Date(Date.now() - 5 * 86400000) },
          { _id: anaId, email: 'ana@example.com', credits: 0, createdAt: options.anaCreated ?? new Date(), scoreProfile: consented },
        ],
      },
    )
    const user = (id: ObjectId) => built.collection('users').docs.find((doc) => (doc._id as ObjectId).equals(id)) as unknown as UserDocument
    const teasers = (id: ObjectId) => (built.collection('teasers').docs as TeaserDocument[]).filter((teaser) => teaser.userId.equals(id))

    if (options.rosaTeaser !== false) {
      files.files.set(`users/${rosaId.toString()}/hairscore-x.jpg`, await pattern(5))
      await maybeStartTeaser(built.app, rosaId, 'perfect_haircut', new ObjectId(), { tips: [], photoKey: `users/${rosaId.toString()}/hairscore-x.jpg` })
      await until(async () => teasers(rosaId)[0]?.status === 'ready')
    }

    const code = (await built.app.inject({ method: 'POST', url: '/invites', headers: built.auth(rosaId) })).json<{ code: string }>().code
    const claim = (id: ObjectId, value = code) => built.app.inject({ method: 'POST', url: '/invites/claim', headers: built.auth(id), payload: { code: value } })
    const anaReads = async () => {
      const body = await form({ source: 'camera' }, { photo: await pattern(7) }, built.auth(anaId))
      await built.app.inject({ method: 'POST', url: '/scores/hair/photos', ...body })
      await until(async () => built.collection('scoreChecks').docs.every((check) => (check as { status: string }).status !== 'processing'))
    }

    return { ...built, rosaId, anaId, code, claim, anaReads, user, teasers }
  }

  it('gives her one code, the same every time', async () => {
    const { app, auth, rosaId, code } = await setup({ rosaTeaser: false })

    assert.match(code, /^[a-z2-9]{8}$/)
    assert.equal((await app.inject({ method: 'POST', url: '/invites', headers: auth(rosaId) })).json<{ code: string }>().code, code)
  })

  it('unlocks her perfect haircut when her friend does her first read, once', async () => {
    const { app, claim, anaId, rosaId, anaReads, user, teasers, collection } = await setup()

    assert.equal((await claim(anaId)).json<{ claimed: boolean }>().claimed, true)
    assert.equal(user(anaId).invitedBy?.userId.toString(), rosaId.toString())

    await anaReads()
    await until(async () => Boolean(teasers(rosaId)[0]?.resultId))

    assert.equal(user(rosaId).invite?.rewards, 1)
    assert.ok((collection('hairstyles').docs as { userId: ObjectId }[]).some((hairstyle) => hairstyle.userId.equals(rosaId)))
    // A second read rewards nothing more.
    assert.equal(await rewardInviter(app, anaId), false)
    assert.equal(user(rosaId).invite?.rewards, 1)
  })

  it('never takes her own code, an old account, or a second inviter', async () => {
    const own = await setup({ rosaTeaser: false })
    assert.equal((await own.claim(own.rosaId)).json<{ claimed: boolean }>().claimed, false)

    const old = await setup({ rosaTeaser: false, anaCreated: new Date(Date.now() - 10 * 86400000) })
    assert.equal((await old.claim(old.anaId)).json<{ claimed: boolean }>().claimed, false)

    const twice = await setup({ rosaTeaser: false })
    assert.equal((await twice.claim(twice.anaId)).json<{ claimed: boolean }>().claimed, true)
    assert.equal((await twice.claim(twice.anaId)).json<{ claimed: boolean }>().claimed, false)
  })

  it('keeps the reward for her next teaser when none is drawn yet, up to the cap', async () => {
    const { app, claim, anaId, rosaId, anaReads, user, teasers, collection } = await setup({ rosaTeaser: false })

    await claim(anaId)
    await anaReads()
    await until(async () => user(rosaId).invite?.pending === 1)

    files.files.set(`users/${rosaId.toString()}/hairscore-y.jpg`, await pattern(6))
    await maybeStartTeaser(app, rosaId, 'perfect_haircut', new ObjectId(), { tips: [], photoKey: `users/${rosaId.toString()}/hairscore-y.jpg` })
    await until(async () => Boolean(teasers(rosaId)[0]?.resultId))
    assert.equal(user(rosaId).invite?.pending, 0)

    collection('users').docs.find((doc) => (doc._id as ObjectId).equals(rosaId))!.invite = { code: 'abcdefgh', createdAt: new Date(), rewards: INVITE_REWARD_CAP, pending: 0 }
    collection('users').docs.find((doc) => (doc._id as ObjectId).equals(anaId))!.invitedBy = { userId: rosaId, code: 'abcdefgh', at: new Date(), rewardedAt: null }
    assert.equal(await rewardInviter(app, anaId), false)
  })
})
