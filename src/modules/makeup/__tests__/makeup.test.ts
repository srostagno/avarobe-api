import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { memoryStorage, photo, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { MakeupTryOnDocument, ProSubscription } from '../../../types/mongo.js'
import { MAKEUP_PRESETS } from '../presets.js'
import { buildMakeupPrompt } from '../prompts.js'
import makeupRoutes from '../routes.js'
import { deleteMakeupTryOns } from '../service.js'

// Makeup (the Face studio, Oct 17, 2026): ready-made makeup tried on her
// from her selfie (and avatar), one free without Pro, then a credit each.

const pro: ProSubscription = {
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval: 'month',
  periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  cancelAtPeriodEnd: false,
}

const faceTest = {
  insight: 'Warm roses are yours',
  note: 'x',
  kind: 'lips' as const,
  panels: [
    { name: 'Warm rose', hex: '#B5646E', verdict: 'wear' as const },
    { name: 'Cool fuchsia', hex: '#C2185B', verdict: 'avoid' as const },
  ],
}

describe('Makeup try-ons', () => {
  let files: ReturnType<typeof memoryStorage>
  let ai: ReturnType<typeof stubOpenAi>
  const saved = { free: env.FREE_MAKEUP_TRY_ONS, comp: env.COMP_EMAILS, on: env.MAKEUP_ENABLED }

  beforeEach(() => {
    files = memoryStorage()
    ai = stubOpenAi()
    env.FREE_MAKEUP_TRY_ONS = 1
    env.COMP_EMAILS = ''
    env.MAKEUP_ENABLED = 'on'
  })

  afterEach(() => {
    files.restore()
    ai.restore()
    Object.assign(env, { FREE_MAKEUP_TRY_ONS: saved.free, COMP_EMAILS: saved.comp, MAKEUP_ENABLED: saved.on })
  })

  async function setup(userFields: Record<string, unknown> = {}, avatar: Record<string, unknown> | null = {}) {
    const userId = new ObjectId()
    const selfieKey = `users/${userId.toString()}/selfie-1.jpg`
    const avatarKey = `users/${userId.toString()}/avatar-1.webp`

    files.files.set(selfieKey, await photo([180, 140, 120]))
    files.files.set(avatarKey, await photo([170, 150, 130]))

    const built = await routeApp(
      { '/makeup': makeupRoutes },
      {
        users: [{ _id: userId, email: 'rosa@example.com', credits: 0, createdAt: new Date(), ...userFields }],
        avatars: avatar ? [{ _id: new ObjectId(), userId, status: 'ready', selfieKey, avatarKey, versions: [], ...avatar }] : [],
      },
    )
    const headers = built.auth(userId)
    const tryOn = (id: string) => built.app.inject({ method: 'POST', url: `/makeup/presets/${id}/try-on`, headers })
    const tryOns = () => built.collection('makeupTryOns').docs as MakeupTryOnDocument[]
    const user = () => built.collection('users').docs[0] as Record<string, unknown> & { credits?: number; freeUses?: Record<string, number> }

    return { ...built, headers, tryOn, tryOns, user, userId, selfieKey }
  }

  const rendered = async () => {
    ai.state.images = 1
    ai.state.image = await photo([200, 120, 120])
  }

  it('shows the collections with the how-to only for Pro', async () => {
    const free = await setup()
    const body = (await free.app.inject({ method: 'GET', url: '/makeup', headers: free.headers })).json<{
      collections: { presets: { steps: string[]; stepsCount: number }[] }[]
      freeLeft: number
      ready: boolean
    }>()

    assert.equal(body.ready, true)
    assert.equal(body.freeLeft, 1)
    assert.equal(body.collections.flatMap((collection) => collection.presets).length, MAKEUP_PRESETS.length)
    assert.deepEqual(body.collections[0]?.presets[0]?.steps, [])
    assert.ok((body.collections[0]?.presets[0]?.stepsCount ?? 0) > 0)

    const paid = await setup({ pro })
    const proBody = (await paid.app.inject({ method: 'GET', url: '/makeup', headers: paid.headers })).json<{ collections: { presets: { steps: string[] }[] }[] }>()
    assert.ok((proBody.collections[0]?.presets[0]?.steps.length ?? 0) > 0)
  })

  it('needs her selfie first', async () => {
    const { tryOn } = await setup({}, null)
    const response = await tryOn('soft-glam')

    assert.equal(response.statusCode, 409)
    assert.equal(response.json<{ code: string }>().code, 'needs_selfie')
  })

  it('works from the selfie alone, before an avatar', async () => {
    await rendered()
    const { tryOn, tryOns } = await setup({}, { avatarKey: null, status: 'processing' })

    assert.equal((await tryOn('classic-red')).statusCode, 202)
    await until(async () => tryOns()[0]?.status === 'ready')
    assert.equal(tryOns()[0]?.avatarId, null)
  })

  it('tries one free, then shows the Pro offer', async () => {
    await rendered()
    const { tryOn, tryOns } = await setup({ credits: 3 })

    assert.equal((await tryOn('fresh-everyday')).statusCode, 202)
    await until(async () => tryOns()[0]?.status === 'ready')
    assert.equal(tryOns()[0]?.freeUse, true)

    const second = await tryOn('soft-glow')
    assert.equal(second.statusCode, 402)
    assert.equal(second.json<{ code: string }>().code, 'needs_pro')
  })

  it('spends a credit with Pro, and the same one again costs nothing', async () => {
    await rendered()
    const { tryOn, tryOns, user } = await setup({ pro, credits: 30 })

    assert.equal((await tryOn('berry-stain')).statusCode, 202)
    await until(async () => tryOns()[0]?.status === 'ready')
    assert.equal(user().credits, 29)
    assert.equal((await tryOn('berry-stain')).statusCode, 200)
    assert.equal(user().credits, 29)
  })

  it('gives back what a failed render took', async () => {
    const { tryOn, tryOns, user } = await setup({ pro, credits: 30 })

    assert.equal((await tryOn('plum-evening')).statusCode, 202)
    await until(async () => tryOns()[0]?.status === 'failed')
    assert.equal(user().credits, 30)
    assert.equal(tryOns()[0]?.creditSpent, false)
  })

  it('keeps only the makeup changing, her real skin and age', () => {
    const prompt = buildMakeupPrompt({ name: 'Soft glam', render: 'Bronze eyes.', hasAvatar: false })

    assert.match(prompt, /Image 1 is a selfie/)
    assert.match(prompt, /Change ONLY the makeup/)
    assert.match(prompt, /they keep their age/)
  })

  it('makes "my colors" only for who owns the Color Advisor', async () => {
    const locked = await setup({}, { colorReport: { data: { faceTest }, createdAt: new Date() } })
    const studio = (await locked.app.inject({ method: 'GET', url: '/makeup', headers: locked.headers })).json<{ myColors: { locked: boolean; lips: unknown[] } }>()

    assert.deepEqual(studio.myColors, { locked: true, lips: [] })
    assert.ok(!JSON.stringify(studio).includes('Warm rose'))
    assert.equal((await locked.tryOn('my-colors')).statusCode, 402)

    await rendered()
    const owner = await setup({ colorReportAt: new Date() }, { colorReport: { data: { faceTest }, createdAt: new Date() } })
    assert.equal((await owner.tryOn('my-colors')).statusCode, 202)
    assert.match(owner.tryOns()[0]?.render ?? '', /Warm rose/)
  })

  it('goes with her old selfie', async () => {
    await rendered()
    const { app, tryOn, tryOns, userId } = await setup({ pro, credits: 30 })

    await tryOn('winged-liner')
    await until(async () => tryOns()[0]?.status === 'ready')
    const key = tryOns()[0]?.imageKey

    await deleteMakeupTryOns(app, userId)
    assert.equal(tryOns().length, 0)
    assert.ok(key && files.removed.includes(key))
  })

  it('unlocks her best face from a Face Age read, with Pro only', async () => {
    await rendered()
    const reading = {
      usable: true,
      problem: null,
      apparentAge: 52,
      potentialYears: 3,
      headline: 'x',
      strengths: [],
      agingFactors: [],
      tips: [
        { area: 'makeup', text: 'A rosy cream blush high on the cheeks.' },
        { area: 'light', text: 'Face a window.' },
      ],
      photo: { light: 'good', glasses: false, makeup: 'none', expression: 'neutral', angle: 'front' },
    }
    const face = (userId: ObjectId) => ({ _id: new ObjectId(), userId, status: 'ready', error: null, photoKey: 'x', takenAt: new Date(), source: 'camera', dateSource: 'now', reading, createdAt: new Date(), updatedAt: new Date() })

    const free = await setup()
    const freeCheck = face(free.userId)
    free.collection('faceChecks').docs.push(freeCheck)
    assert.equal((await free.app.inject({ method: 'POST', url: '/makeup/best-face', headers: free.headers, payload: { checkId: freeCheck._id.toString() } })).statusCode, 402)

    const paid = await setup({ pro, credits: 30 })
    const check = face(paid.userId)
    paid.collection('faceChecks').docs.push(check)
    const started = await paid.app.inject({ method: 'POST', url: '/makeup/best-face', headers: paid.headers, payload: { checkId: check._id.toString() } })
    assert.equal(started.statusCode, 202)
    assert.match(paid.tryOns()[0]?.render ?? '', /rosy cream blush/)
    assert.equal(paid.tryOns()[0]?.presetId, `best-face-${check._id.toString()}`)
    await until(async () => paid.tryOns()[0]?.status === 'ready')
    assert.equal(paid.user().credits, 29)
    assert.equal((await paid.app.inject({ method: 'POST', url: '/makeup/best-face', headers: paid.headers, payload: { checkId: check._id.toString() } })).statusCode, 200)
  })

  it('is off with MAKEUP_ENABLED=off', async () => {
    env.MAKEUP_ENABLED = 'off'
    const { app, headers } = await setup()

    assert.equal((await app.inject({ method: 'GET', url: '/makeup', headers })).statusCode, 404)
  })
})
