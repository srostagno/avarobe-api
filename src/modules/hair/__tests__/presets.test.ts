import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { memoryStorage, photo, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { HairstyleDocument, ProSubscription } from '../../../types/mongo.js'
import { buildHairstylePrompt } from '../prompts.js'
import { HAIR_PRESETS } from '../presets.js'
import hairRoutes from '../routes.js'

// Hair presets (Oct 17, 2026): the catalog's cuts and colors on her, one free
// without Pro, then a credit each; the same one again isn't charged twice;
// a failed render gives back what it took; her best colors stay hers.

const pro: ProSubscription = {
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval: 'month',
  periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  cancelAtPeriodEnd: false,
}

const hairTest = {
  insight: 'Warm brown is yours',
  note: 'x',
  current: 'Medium brown',
  kind: 'color' as const,
  panels: [
    { name: 'Golden chestnut', hex: '#8A5A3B', verdict: 'wear' as const },
    { name: 'Ash blonde', hex: '#C8B79A', verdict: 'avoid' as const },
  ],
}

describe('Hair presets', () => {
  let files: ReturnType<typeof memoryStorage>
  let ai: ReturnType<typeof stubOpenAi>
  const saved = { free: env.FREE_HAIR_PRESETS, comp: env.COMP_EMAILS, on: env.HAIR_PRESETS_ENABLED }

  beforeEach(() => {
    files = memoryStorage()
    ai = stubOpenAi()
    env.FREE_HAIR_PRESETS = 1
    env.COMP_EMAILS = ''
    env.HAIR_PRESETS_ENABLED = 'on'
  })

  afterEach(() => {
    files.restore()
    ai.restore()
    Object.assign(env, { FREE_HAIR_PRESETS: saved.free, COMP_EMAILS: saved.comp, HAIR_PRESETS_ENABLED: saved.on })
  })

  async function setup(userFields: Record<string, unknown> = {}, avatarFields: Record<string, unknown> = {}) {
    const userId = new ObjectId()
    const avatarId = new ObjectId()
    const selfieKey = `users/${userId.toString()}/selfie-1.jpg`
    const avatarKey = `users/${userId.toString()}/avatar-1.webp`

    files.files.set(selfieKey, await photo([180, 140, 120]))
    files.files.set(avatarKey, await photo([170, 150, 130]))

    const built = await routeApp(
      { '/hair': hairRoutes },
      {
        users: [{ _id: userId, email: 'rosa@example.com', credits: 0, createdAt: new Date(), ...userFields }],
        avatars: [{ _id: avatarId, userId, status: 'ready', selfieKey, avatarKey, versions: [], ...avatarFields }],
      },
    )
    const headers = built.auth(userId)
    const tryOn = (id: string) => built.app.inject({ method: 'POST', url: `/hair/presets/${id}`, headers })
    const hairstyles = () => built.collection('hairstyles').docs as HairstyleDocument[]
    const user = () => built.collection('users').docs[0] as Record<string, unknown> & { credits?: number; freeUses?: Record<string, number> }

    return { ...built, headers, tryOn, hairstyles, user, userId }
  }

  it('lists the catalog in collections, with her free try', async () => {
    const { app, headers } = await setup()
    const list = await app.inject({ method: 'GET', url: '/hair/presets', headers })

    assert.equal(list.statusCode, 200)
    const body = list.json<{ collections: { presets: { id: string; image: string }[] }[]; freeLeft: number; personal: { locked: boolean } }>()
    assert.equal(body.collections.flatMap((collection) => collection.presets).length, HAIR_PRESETS.length)
    assert.equal(body.collections[0]?.presets[0]?.image, `/hair-presets/${body.collections[0]?.presets[0]?.id}.webp`)
    assert.equal(body.freeLeft, 1)
    assert.equal(body.personal.locked, false)
  })

  it('tries one free, then shows the Pro offer', async () => {
    ai.state.images = 1
    ai.state.image = await photo([120, 90, 70])
    const { tryOn, hairstyles } = await setup({ credits: 5 })

    const first = await tryOn('collarbone-lob')
    assert.equal(first.statusCode, 202)
    await until(async () => hairstyles()[0]?.status === 'ready')
    assert.equal(hairstyles()[0]?.source, 'preset')
    assert.equal(hairstyles()[0]?.presetId, 'collarbone-lob')
    assert.equal(hairstyles()[0]?.freePreset, true)

    const second = await tryOn('french-bob')
    assert.equal(second.statusCode, 402)
    assert.equal(second.json<{ code: string }>().code, 'needs_pro')
  })

  it('spends a credit with Pro, and the same one again costs nothing', async () => {
    ai.state.images = 1
    ai.state.image = await photo([120, 90, 70])
    const { tryOn, hairstyles, user } = await setup({ pro, credits: 30 })

    assert.equal((await tryOn('gray-blending')).statusCode, 202)
    await until(async () => hairstyles()[0]?.status === 'ready')
    assert.equal(user().credits, 29)

    const again = await tryOn('gray-blending')
    assert.equal(again.statusCode, 200)
    assert.equal(user().credits, 29)
    assert.equal(hairstyles().length, 1)
  })

  it('gives back her free try when the render fails', async () => {
    const { tryOn, hairstyles, user } = await setup()

    assert.equal((await tryOn('bixie')).statusCode, 202)
    await until(async () => hairstyles()[0]?.status === 'failed')
    assert.equal(user().freeUses?.hair_preset, 0)
    assert.equal(hairstyles()[0]?.freePreset, false)
  })

  it('changes only the color for a color preset', async () => {
    const prompt = buildHairstylePrompt({ name: 'Gray blending', render: 'Blend the grays.', hasReference: false, colorOnly: true })

    assert.match(prompt, /new hair color/)
    assert.match(prompt, /Change only the color/)
    assert.doesNotMatch(prompt, /new haircut/)
  })

  it('answers 404 for a preset that does not exist', async () => {
    const { tryOn } = await setup()

    assert.equal((await tryOn('mullet-2099')).statusCode, 404)
    assert.equal((await tryOn('../../x')).statusCode, 404)
  })

  it('keeps her best colors hers: counted but never named before she owns them', async () => {
    const { app, headers, tryOn } = await setup({}, { colorReport: { data: { hairTest }, createdAt: new Date() } })
    const list = (await app.inject({ method: 'GET', url: '/hair/presets', headers })).json<{ personal: { locked: boolean; count: number; colors: unknown[] } }>()

    assert.deepEqual(list.personal, { locked: true, count: 1, colors: [] })
    assert.ok(!JSON.stringify(list).includes('Golden chestnut'))

    const locked = await tryOn('my-color-1')
    assert.equal(locked.statusCode, 402)
    assert.equal(locked.json<{ code: string }>().code, 'needs_color_report')
  })

  it('names them once she owns her Color Advisor', async () => {
    const { app, headers } = await setup({ colorReportAt: new Date() }, { colorReport: { data: { hairTest }, createdAt: new Date() } })
    const list = (await app.inject({ method: 'GET', url: '/hair/presets', headers })).json<{ personal: { locked: boolean; colors: { id: string; name: string }[] } }>()

    assert.equal(list.personal.locked, false)
    assert.deepEqual(list.personal.colors.map((color) => [color.id, color.name]), [['my-color-1', 'Golden chestnut']])
  })

  it('is off with HAIR_PRESETS_ENABLED=off', async () => {
    env.HAIR_PRESETS_ENABLED = 'off'
    const { app, headers, tryOn } = await setup()

    assert.equal((await app.inject({ method: 'GET', url: '/hair/presets', headers })).statusCode, 404)
    assert.equal((await tryOn('bixie')).statusCode, 404)
  })
})
