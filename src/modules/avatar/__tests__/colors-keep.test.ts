import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { failure, form, memoryStorage, photo, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { AvatarDocument, ColorAnalysis, ColorReadLog, ColorsFailure, ColorsSource } from '../../../types/mongo.js'
import { normalizeSelfie } from '../../../utils/images.js'
import { serializeAvatar } from '../../../utils/serializers.js'
import { storage } from '../../../utils/storage.js'
import { failStaleColorReads } from '../../../utils/stale-jobs.js'
import { imageHash, readEntry } from '../reads.js'
import avatarRoutes from '../routes.js'
import { runColorsJob } from '../service.js'

// A read never deletes anything before it succeeds: whatever way a re-read
// fails, the colors, the selfie and everything drawn from them stay; the
// same photo again costs no AI call; a successful read writes once, then
// cleans up. Through the routes, with the files in memory and OpenAI stubbed.

const files = memoryStorage()
const ai = stubOpenAi()

after(() => {
  files.restore()
  ai.restore()
})

beforeEach(() => {
  ai.calls.length = 0
  ai.state.reply = null
  ai.state.scores = { warmth: 3, depth: 4, chroma: -1, contrast: 2 }
  ai.state.images = 0
  ai.state.image = null
  env.COLOR_READ_METHOD = 'scored'
  files.removed.length = 0
})

const MINUTE = 60 * 1000
const DEEP_WINTER: ColorAnalysis = {
  season: 'Deep Winter',
  undertone: 'cool',
  contrast: 'high',
  summary: 'Cool and deep.',
  bestColors: [
    { name: 'Emerald', hex: '#00785A' },
    { name: 'Ruby', hex: '#9B111E' },
    { name: 'Sapphire', hex: '#0F52BA' },
  ],
  neutrals: [{ name: 'Black', hex: '#000000' }],
  avoidColors: [{ name: 'Beige', hex: '#D8C3A5' }],
  metals: 'silver',
  confidence: 'high',
  photoNote: null,
}

const body = { heightCm: '165', weightKg: '60', build: 'average', presentation: 'womenswear' }

// Someone with her colors read (Deep Winter), her selfie, its free preview
// and a hair read, without an avatar yet.
async function withColors(fields: Doc = {}, user: Doc = {}) {
  const { app, collection, auth } = await routeApp({ '/avatar': avatarRoutes })
  const userId = new ObjectId()
  const avatarId = new ObjectId()
  const dir = `users/${userId.toString()}`
  const selfieKey = `${dir}/selfie-1.jpg`
  const selfie = await normalizeSelfie(await photo([150, 100, 80]))

  for (const key of [`${dir}/drape-preview-1.webp`, `${dir}/drape-preview-1-locked.webp`]) {
    files.files.set(key, Buffer.from(key))
  }

  files.files.set(selfieKey, selfie)
  collection('users').docs.push({ _id: userId, email: `ana-${userId.toString()}@example.test`, firstName: 'Ana', createdAt: new Date(), ...user })
  collection('avatars').docs.push({
    _id: avatarId,
    userId,
    status: 'ready',
    error: null,
    failure: null,
    selfieKey,
    avatarKey: null,
    body: null,
    colorAnalysis: DEEP_WINTER,
    colorsAt: new Date(Date.now() - 60 * MINUTE),
    drapePreview: {
      status: 'ready',
      key: `${dir}/drape-preview-1.webp`,
      lockedKey: `${dir}/drape-preview-1-locked.webp`,
      layout: 'grid',
      best: DEEP_WINTER.bestColors[0],
      bests: DEEP_WINTER.bestColors,
      worst: DEEP_WINTER.avoidColors[0],
      updatedAt: new Date(),
    },
    hairProfile: { status: 'ready', data: null, error: null, startedAt: new Date(), updatedAt: new Date() },
    consentVersion: 'v1',
    consentAt: new Date(),
    generations: 0,
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 60 * MINUTE),
    ...fields,
  })

  const avatar = () => collection('avatars').findOne({ _id: avatarId })
  const event = (name: string) => collection('analyticsEvents').findOne({ name })
  return { app, collection, auth, userId, avatarId, selfieKey, selfie, avatar, event, before: await avatar() }
}

// Sends a multipart form, as the web does.
async function post(app: Awaited<ReturnType<typeof routeApp>>['app'], url: string, headers: Record<string, string>, fields: Record<string, string>, upload?: Buffer) {
  const multipart = await form(fields, upload ? { selfie: upload } : {})

  return app.inject({ method: 'POST', url, payload: multipart.payload, headers: { ...headers, ...multipart.headers } })
}

const readsOf = (avatar: Doc | null) => (avatar?.colorReads ?? []) as ColorReadLog[]
const propsOf = (event: Doc | null) => (event?.props ?? {}) as Doc
const failureOf = (avatar: Doc | null) => avatar?.failure as ColorsFailure | null

// Everything a failed re-read must leave as it was.
function assertKept(after: Doc | null, before: Doc | null) {
  for (const field of ['colorAnalysis', 'colorsAt', 'colorReport', 'drape', 'drapePreview', 'reportBoards', 'hairProfile', 'selfieKey']) {
    assert.deepEqual(after?.[field], before?.[field], field)
  }

  assert.equal(after?.status, 'ready')
  assert.equal(after?.error, null)
  assert.equal(after?.job, null)
}

describe('a re-read that fails keeps everything', () => {
  for (const [name, reply, code, attempts] of [
    ['out of credits', failure.noCredits, 'no_credits', 1],
    ['busy three times', failure.busy, 'provider', 3],
  ] as const) {
    it(`when the AI is ${name}`, async () => {
      ai.state.reply = reply
      const ana = await withColors()
      const response = await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, await photo([90, 60, 40]))

      assert.equal(response.statusCode, 202)
      await until(async () => Boolean(await ana.event('colors_failed')))

      const after = await ana.avatar()
      assertKept(after, ana.before)
      assert.deepEqual({ code: failureOf(after)?.code, attempts: failureOf(after)?.attempts }, { code, attempts })
      const read = readsOf(after)[0]!
      assert.equal(read.outcome, 'failed')
      assert.equal(read.shown, 'Deep Winter')
      // Only the held selfie goes; her selfie and its preview stay.
      assert.deepEqual(files.removed, [read.selfieKey])
      assert.notEqual(read.selfieKey, ana.selfieKey)
      assert.ok(files.files.has(ana.selfieKey))
      assert.ok(files.files.has((ana.before?.drapePreview as { key: string }).key))
      assert.equal(propsOf(await ana.event('colors_failed')).kept, true)
    })
  }

  it('when the read crashes', async () => {
    const ana = await withColors()
    const avatars = ana.collection('avatars')
    const update = avatars.updateOne.bind(avatars)
    let crashed = false
    avatars.updateOne = async (filter, change, options) => {
      const reads = ((change as Doc).$set as Doc | undefined)?.colorReads as ColorReadLog[] | undefined

      if (!crashed && reads?.[0]?.outcome === 'changed') {
        crashed = true
        throw new Error('The database went away.')
      }

      return update(filter, change, options)
    }
    await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, await photo([90, 60, 40]))
    await until(async () => Boolean(await ana.event('colors_failed')))

    const after = await ana.avatar()
    assert.ok(crashed)
    assertKept(after, ana.before)
    assert.equal(failureOf(after)?.code, 'internal')
    assert.equal(files.removed.length, 1)
  })

  it('when the server restarted in the middle (giving back the generation it held)', async () => {
    const ana = await withColors()
    const held = `users/${ana.userId.toString()}/selfie-2.jpg`
    files.files.set(held, Buffer.from('held'))
    const started = new Date(Date.now() - 15 * MINUTE)
    await ana.collection('avatars').updateOne(
      { _id: ana.avatarId },
      { $set: { status: 'processing', job: { kind: 'colors', startedAt: started, previewKey: null, previewCount: 0, readId: 'read-9', selfieKey: held }, updatedAt: started } },
    )
    ana.collection('usageCounters').docs.push({ _id: `${ana.userId.toString()}:avatar:${new Date().toISOString().slice(0, 10)}`, count: 1 })

    assert.equal(await failStaleColorReads(ana.app), 1)
    const after = await ana.avatar()
    assertKept(after, ana.before)
    assert.deepEqual(failureOf(after) && { code: failureOf(after)!.code, detail: failureOf(after)!.detail }, { code: 'internal', detail: 'interrupted' })
    assert.deepEqual(files.removed, [held])
    assert.equal(readsOf(after)[0]?.outcome, 'failed')
    assert.equal((await ana.collection('usageCounters').findOne({}))?.count, 0)
  })
})

describe('a first read that fails', () => {
  it('is failed as before, keeping the photo for a retry', async () => {
    ai.state.reply = failure.noCredits
    const { app, collection, auth } = await routeApp({ '/avatar': avatarRoutes })
    const userId = new ObjectId()
    collection('users').docs.push({ _id: userId, email: 'new@example.test', firstName: 'Bea', createdAt: new Date() })
    await post(app, '/avatar/colors', auth(userId), { consent: 'true' }, await photo([90, 60, 40]))
    await until(async () => Boolean(await collection('analyticsEvents').findOne({ name: 'colors_failed' })))

    const avatar = await collection('avatars').findOne({ userId })
    assert.equal(avatar?.status, 'failed')
    assert.match(avatar?.error as string, /selfie/)
    assert.equal(failureOf(avatar)?.code, 'no_credits')
    assert.equal(avatar?.colorAnalysis, null)
    assert.ok(files.files.has(avatar?.selfieKey as string))
    assert.equal(files.removed.length, 0)
    assert.equal(propsOf(await collection('analyticsEvents').findOne({ name: 'colors_failed' })).kept, false)
  })
})

describe('the same photo again', () => {
  const unused = async (ana: Awaited<ReturnType<typeof withColors>>) => {
    assert.equal(ai.calls.length, 0)
    assert.equal(await ana.collection('usageCounters').countDocuments({}), 0)
    const after = await ana.avatar()
    assert.deepEqual(after?.colorAnalysis, ana.before?.colorAnalysis)
    assert.equal(after?.status, 'ready')
    assert.equal(readsOf(after)[0]?.outcome, 'reused')
    assert.equal(propsOf(await ana.event('colors_reused')).scope, 'current')
    assert.equal(await ana.collection('analyticsEvents').countDocuments({ name: 'colors_started' }), 0)
  }

  it('without a photo: the colors as they are, no AI call', async () => {
    const ana = await withColors()
    const response = await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { trigger: 'auto' })

    assert.equal(response.statusCode, 202)
    assert.equal(response.json<{ reused: boolean }>().reused, true)
    assert.equal(response.json<{ avatar: { colorAnalysis: { season: string } } }>().avatar.colorAnalysis.season, 'Deep Winter')
    await unused(ana)
  })

  it('tapped again and again: one line in the history, so the real reads stay', async () => {
    const read = readEntry({ id: 'read-0', at: new Date(), selfieKey: 'users/x/selfie-0.jpg', method: 'classic', outcome: 'first', season: 'Deep Winter', shown: 'Deep Winter' })
    const ana = await withColors({ colorReads: [read] })

    for (let tap = 0; tap < 3; tap += 1) {
      await post(ana.app, '/avatar/colors', ana.auth(ana.userId), {})
    }

    assert.deepEqual(readsOf(await ana.avatar()).map((entry) => entry.outcome), ['reused', 'first'])
    assert.equal(ai.calls.length, 0)
  })

  it('the same bytes as the photo the colors came from', async () => {
    const same = await photo([200, 150, 120])
    const ana = await withColors({
      colorsSource: { readId: 'read-0', at: new Date(), selfieKey: 'users/x/selfie-0.jpg', imageHash: imageHash(await normalizeSelfie(same)), method: 'scored', scores: null, lighting: null },
    })
    const response = await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, same)

    assert.equal(response.json<{ reused: boolean }>().reused, true)
    await unused(ana)
  })

  it('the stored selfie, for colors read before sources were kept', async () => {
    const ana = await withColors()
    const response = await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, await photo([150, 100, 80]))

    assert.equal(response.json<{ reused: boolean }>().reused, true)
    await unused(ana)
  })
})

describe('a re-read that works', () => {
  it('writes once, guarded by its id, and only then replaces the selfie and its preview', async () => {
    const ana = await withColors()
    const avatars = ana.collection('avatars')
    const update = avatars.updateOne.bind(avatars)
    const remove = storage.remove.bind(storage)
    const sequence: string[] = []
    avatars.updateOne = async (filter, change, options) => {
      if ('job.readId' in filter) {
        sequence.push('update')
      }

      return update(filter, change, options)
    }
    storage.remove = async (key) => {
      sequence.push(`remove ${key}`)
      return remove(key)
    }

    try {
      const upload = await photo([90, 60, 40])
      await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, upload)
      await until(async () => Boolean(await ana.event('colors_ready')))

      const after = await ana.avatar()
      const read = readsOf(after)[0]!
      // Deep Autumn leads Deep Winter by 3 on the new photo: changed.
      assert.equal(read.outcome, 'changed')
      assert.equal((after?.colorAnalysis as ColorAnalysis).season, 'Deep Autumn')
      assert.equal(after?.selfieKey, read.selfieKey)
      assert.equal((after?.colorsSource as { imageHash: string }).imageHash, imageHash(await normalizeSelfie(upload)))
      assert.notEqual((after?.drapePreview as { key: string | null } | null)?.key, (ana.before?.drapePreview as { key: string }).key)
      assert.equal(after?.hairProfile, null)
      assert.deepEqual(sequence.filter((step) => step === 'update'), ['update'])
      const old = [ana.selfieKey, `users/${ana.userId.toString()}/drape-preview-1.webp`, `users/${ana.userId.toString()}/drape-preview-1-locked.webp`]
      assert.deepEqual(sequence.slice(sequence.indexOf('update') + 1, sequence.indexOf('update') + 4).sort(), old.map((key) => `remove ${key}`).sort())
      assert.ok(sequence.indexOf('update') < sequence.findIndex((step) => step.startsWith('remove')))
      assert.deepEqual((await ana.event('colors_ready'))?.props, {
        season: 'Deep Autumn',
        via: 'colors',
        outcome: 'changed',
        method: 'scored',
        read: 'Deep Autumn',
        samples: 1,
        margin: 1.25,
        lead: 3,
        from: 'Deep Winter',
      })

      const shown = await ana.app.inject({ method: 'GET', url: '/avatar', headers: ana.auth(ana.userId) })
      const avatar = shown.json<{ avatar: Record<string, unknown> }>().avatar
      assert.equal(avatar.readsKept, true)
      assert.equal(avatar.colorsLocked, false)
      assert.equal(avatar.colorCandidate, null)
      assert.deepEqual({ ...(avatar.lastRead as object), id: undefined, at: undefined }, {
        id: undefined,
        at: undefined,
        outcome: 'changed',
        season: 'Deep Autumn',
        from: 'Deep Winter',
        to: 'Deep Autumn',
        direction: 'warmer',
        via: 'colors',
      })
      assert.equal(avatar.seasonRule, 'clear')
    } finally {
      storage.remove = remove
    }
  })

  it('ignores a read that was replaced meanwhile', async () => {
    const { app, collection } = fakeApp()
    const userId = new ObjectId()
    const avatarId = new ObjectId()
    const selfieKey = `users/${userId.toString()}/selfie-1.jpg`
    const held = `users/${userId.toString()}/selfie-2.jpg`
    files.files.set(selfieKey, Buffer.from('old'))
    files.files.set(held, Buffer.from('held'))
    collection('users').docs.push({ _id: userId, email: 'cy@example.test', createdAt: new Date() })
    collection('avatars').docs.push({
      _id: avatarId,
      userId,
      status: 'processing',
      selfieKey,
      avatarKey: null,
      colorAnalysis: DEEP_WINTER,
      job: { kind: 'colors', startedAt: new Date(), previewKey: null, previewCount: 0, readId: 'read-1', selfieKey: held },
      updatedAt: new Date(),
    })
    collection('usageCounters').docs.push({ _id: `${userId.toString()}:avatar:${new Date().toISOString().slice(0, 10)}`, count: 1 })
    ai.state.reply = () => {
      // A new read started while this one was measuring.
      Object.assign(collection('avatars').docs[0]!, { job: { kind: 'colors', startedAt: new Date(), previewKey: null, previewCount: 0, readId: 'read-2', selfieKey: held } })
      return failure.busy()
    }
    await runColorsJob(app, avatarId, { readId: 'read-1', photoKey: held })

    const avatar = await collection('avatars').findOne({ _id: avatarId })
    assert.equal(avatar?.status, 'processing')
    assert.equal((avatar?.job as { readId: string }).readId, 'read-2')
    assert.deepEqual(avatar?.colorAnalysis, DEEP_WINTER)
    assert.equal(avatar?.colorReads, undefined)
    // Its held photo is the new read's too: it stays. The generation goes back.
    assert.ok(files.files.has(held))
    assert.equal((await collection('usageCounters').findOne({}))?.count, 0)
  })

  it('a read that fails after it was replaced says so, instead of claiming colors lost', async () => {
    const ana = await withColors()
    const held = `users/${ana.userId.toString()}/selfie-2.jpg`
    files.files.set(held, Buffer.from('held'))
    await ana.collection('avatars').updateOne(
      { _id: ana.avatarId },
      { $set: { status: 'processing', job: { kind: 'colors', startedAt: new Date(), previewKey: null, previewCount: 0, readId: 'read-1', selfieKey: held } } },
    )
    ai.state.reply = () => {
      Object.assign(ana.collection('avatars').docs[0]!, { job: { kind: 'colors', startedAt: new Date(), previewKey: null, previewCount: 0, readId: 'read-2', selfieKey: held } })
      return failure.noCredits()
    }
    await runColorsJob(ana.app, ana.avatarId, { readId: 'read-1', photoKey: held })

    assert.deepEqual((await ana.event('colors_failed'))?.props, { reason: 'no_credits', attempts: 1, superseded: true })
    assert.equal(((await ana.avatar())?.job as { readId: string }).readId, 'read-2')
  })

  it('reuses the scores of a photo read before: only the palette, still told what the photo showed', async () => {
    const upload = await photo([90, 60, 40])
    const coloring = { skin: 'warm olive', hair: 'dark brown', eyes: 'hazel', lighting: 'window light' }
    const earlier = readEntry({
      id: 'read-0',
      at: new Date(Date.now() - 5 * MINUTE),
      selfieKey: 'users/x/selfie-0.jpg',
      imageHash: imageHash(await normalizeSelfie(upload)),
      method: 'scored',
      outcome: 'anchored',
      season: 'Deep Autumn',
      scores: { warmth: 3, depth: 4, chroma: -1, contrast: 2 },
      lighting: 'good',
      shown: 'Soft Summer',
      coloring,
    })
    const ana = await withColors({ colorReads: [earlier] })
    await post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, upload)
    await until(async () => Boolean(await ana.event('colors_ready')))

    assert.deepEqual(ai.calls.map((call) => call.schema), ['color_palette'])
    const text = ((ai.calls[0]!.body.input as { content: { text?: string }[] }[])[0]!.content[0]!.text)!
    assert.match(text, /skin warm olive; hair dark brown; eyes hazel/)
    assert.equal(propsOf(await ana.event('colors_reused')).scope, 'history')
    assert.equal(propsOf(await ana.event('colors_ready')).samples, 0)
    const after = await ana.avatar()
    assert.equal((after?.colorAnalysis as ColorAnalysis).season, 'Deep Autumn')
    assert.deepEqual(readsOf(after)[0]!.coloring, coloring)
  })
})

describe('two reads at once', () => {
  it('starts one; the other waits, and its photo and generation are given back', async () => {
    const ana = await withColors()
    const uploads = [await photo([90, 60, 40]), await photo([95, 65, 45])]
    const put = storage.put.bind(storage)
    let arrived = 0
    let both!: () => void
    const ready = new Promise<void>((resolve) => {
      both = resolve
    })
    // Both get past the busy check before either starts.
    storage.put = async (key, body, type) => {
      if (key.includes('/selfie-')) {
        arrived += 1

        if (arrived === 2) {
          both()
        }

        await ready
      }

      return put(key, body, type)
    }

    try {
      const responses = await Promise.all(uploads.map((upload) => post(ana.app, '/avatar/colors', ana.auth(ana.userId), { consent: 'true' }, upload)))

      // Both stored their photo, so both were past the busy check.
      assert.equal(arrived, 2)
      assert.deepEqual(responses.map((response) => response.statusCode).sort(), [202, 409])
      assert.match(responses.find((response) => response.statusCode === 409)!.json<{ message: string }>().message, /still reading your colors/)
    } finally {
      storage.put = put
    }

    await until(async () => Boolean(await ana.event('colors_ready')))
    const after = await ana.avatar()
    // One read: one measurement and its palette, one generation.
    assert.deepEqual(ai.calls.map((call) => call.schema), ['color_measure', 'color_palette'])
    assert.equal((await ana.collection('usageCounters').findOne({}))?.count, 1)
    assert.equal(await ana.collection('analyticsEvents').countDocuments({ name: 'colors_started' }), 1)
    // The winner's photo is her selfie now; the loser's is gone, never orphaned.
    const selfies = [...files.files.keys()].filter((key) => key.startsWith(`users/${ana.userId.toString()}/selfie-`))
    assert.deepEqual(selfies, [after?.selfieKey])
    assert.equal(readsOf(after).length, 1)
  })
})

describe('a new selfie from Photos & measurements', () => {
  it('keeps the colors of someone whose read fails while the avatar renders', async () => {
    ai.state.reply = failure.noCredits
    ai.state.images = 1
    ai.state.image = await photo([200, 200, 200])
    const ana = await withColors()
    const response = await post(ana.app, '/avatar', ana.auth(ana.userId), { ...body, consent: 'true' }, await photo([90, 60, 40]))

    assert.equal(response.statusCode, 202)
    await until(async () => (await ana.avatar())?.status !== 'processing')

    const after = await ana.avatar()
    assert.equal(after?.status, 'ready')
    assert.equal(after?.error, null)
    assert.ok(after?.avatarKey)
    assert.deepEqual(after?.colorAnalysis, DEEP_WINTER)
    assert.deepEqual(after?.drapePreview, ana.before?.drapePreview)
    assert.equal(failureOf(after)?.code, 'no_credits')
    assert.equal(readsOf(after)[0]?.outcome, 'failed')
    await until(async () => Boolean(await ana.event('colors_failed')))
    assert.deepEqual((await ana.event('colors_failed'))?.props, { reason: 'no_credits', attempts: 1, via: 'avatar', kept: true })
    // Her colors came from the old selfie, written down before it went: the
    // new one is never taken for theirs.
    const source = after?.colorsSource as ColorsSource
    assert.equal(source.selfieKey, ana.selfieKey)
    assert.equal(source.imageHash, imageHash(ana.selfie))
    const shown = await ana.app.inject({ method: 'GET', url: '/avatar', headers: ana.auth(ana.userId) })
    assert.deepEqual(
      (({ outcome, reason, via }) => ({ outcome, reason, via }))(shown.json<{ avatar: { lastRead: Record<string, unknown> } }>().avatar.lastRead),
      { outcome: 'failed', reason: 'busy', via: 'avatar' },
    )
  })

  it('tries a busy AI again beside the render, like any read', async () => {
    ai.state.reply = failure.busy
    ai.state.images = 1
    ai.state.image = await photo([200, 200, 200])
    const ana = await withColors()
    await post(ana.app, '/avatar', ana.auth(ana.userId), { ...body, consent: 'true' }, await photo([90, 60, 40]))
    await until(async () => Boolean(await ana.event('colors_failed')))

    assert.equal(ai.calls.length, 3)
    assert.deepEqual(failureOf(await ana.avatar()), { ...failureOf(await ana.avatar())!, code: 'provider', attempts: 3 })
    assert.deepEqual((await ana.avatar())?.colorAnalysis, DEEP_WINTER)
  })

  it('applies a read that works with the render, then deletes the old preview', async () => {
    ai.state.images = 1
    ai.state.image = await photo([200, 200, 200])
    const ana = await withColors()
    const upload = await photo([90, 60, 40])
    const oldPreview = (ana.before?.drapePreview as { key: string; lockedKey: string })
    await post(ana.app, '/avatar', ana.auth(ana.userId), { ...body, consent: 'true' }, upload)
    await until(async () => Boolean(await ana.event('colors_ready')))

    const after = await ana.avatar()
    assert.equal(after?.status, 'ready')
    assert.ok(after?.avatarKey)
    assert.equal((after?.colorAnalysis as ColorAnalysis).season, 'Deep Autumn')
    assert.deepEqual([readsOf(after)[0]!.outcome, readsOf(after)[0]!.via], ['changed', 'avatar'])
    assert.equal((after?.colorsSource as ColorsSource).imageHash, imageHash(await normalizeSelfie(upload)))
    assert.equal((after?.colorsSource as ColorsSource).selfieKey, after?.selfieKey)
    assert.ok(!files.files.has(oldPreview.key))
    assert.ok(!files.files.has(oldPreview.lockedKey))
    assert.deepEqual(
      (({ outcome, via, season }) => ({ outcome, via, season }))(propsOf(await ana.event('colors_ready'))),
      { outcome: 'changed', via: 'avatar', season: 'Deep Autumn' },
    )
  })

  it('never reads a buyer’s colors again: her report, drape test, preview and color boards stay', async () => {
    ai.state.images = 1
    ai.state.image = await photo([200, 200, 200])
    const dir = (userId: ObjectId) => `users/${userId.toString()}`
    const report = { data: { seasonLean: 'Deep Winter' }, createdAt: new Date() }
    const ana = await withColors({}, { colorReportAt: new Date() })
    const boards = {
      neutrals: { status: 'ready', key: `${dir(ana.userId)}/board-neutrals.webp`, layout: 'grid', panels: [], prompt: 'x', refs: 'portrait', size: '1024x1024', updatedAt: new Date() },
      capsule: { status: 'ready', key: `${dir(ana.userId)}/board-capsule.webp`, layout: 'grid', panels: [], prompt: 'x', refs: 'body', size: '1024x1024', updatedAt: new Date() },
    }
    const drape = { status: 'ready', key: `${dir(ana.userId)}/drape-1.webp`, wear: [], avoid: [], updatedAt: new Date() }

    for (const key of [boards.neutrals.key, boards.capsule.key, drape.key]) {
      files.files.set(key, Buffer.from(key))
    }

    await ana.collection('avatars').updateOne({ _id: ana.avatarId }, { $set: { colorReport: report, reportBoards: boards, drape } })
    const before = await ana.avatar()
    await post(ana.app, '/avatar', ana.auth(ana.userId), { ...body, consent: 'true' }, await photo([90, 60, 40]))
    await until(async () => (await ana.avatar())?.status !== 'processing')

    const after = await ana.avatar()
    assert.equal(ai.calls.length, 0)
    assert.equal(after?.status, 'ready')
    for (const field of ['colorAnalysis', 'colorsAt', 'colorReport', 'drape', 'drapePreview']) {
      assert.deepEqual(after?.[field], before?.[field], field)
    }
    assert.deepEqual((after?.reportBoards as Doc).neutrals, boards.neutrals)
    // The style boards follow the body, as before.
    assert.equal((after?.reportBoards as Doc).capsule, undefined)
    assert.ok(files.files.has(boards.neutrals.key))
    assert.ok(files.files.has(drape.key))
    assert.ok(!files.files.has(boards.capsule.key))
    assert.notEqual(after?.selfieKey, ana.selfieKey)
    assert.ok(!files.files.has(ana.selfieKey))
  })
})

describe('the last read the web hears of', () => {
  const entry = (fields: Partial<ColorReadLog> = {}) =>
    readEntry({ id: 'read-1', at: new Date(), selfieKey: 'users/x/selfie-1.jpg', method: 'classic', outcome: 'confirmed', season: 'Deep Winter', shown: 'Deep Winter', ...fields })

  it('is the newest read of the last week, never a photo given back', async () => {
    const ana = await withColors()
    const lastRead = async (reads: ColorReadLog[]) =>
      (await serializeAvatar({ ...(ana.before as unknown as AvatarDocument), colorReads: reads }, { fullPalette: false })).lastRead

    const confirmed = entry()
    assert.deepEqual(await lastRead([confirmed]), { id: 'read-1', outcome: 'confirmed', at: confirmed.at.toISOString(), season: 'Deep Winter' })
    assert.equal(await lastRead([entry({ outcome: 'reused' }), entry({ id: 'read-0' })]), null)
    assert.equal(await lastRead([entry({ at: new Date(Date.now() - 8 * 24 * 60 * MINUTE) })]), null)
    assert.deepEqual(
      (({ outcome, reason, via }) => ({ outcome, reason, via }))((await lastRead([entry({ outcome: 'failed', failure: { code: 'rejected', at: new Date(), attempts: 1, detail: null }, via: 'colors' })]))!),
      { outcome: 'failed', reason: 'photo', via: 'colors' },
    )
  })
})
