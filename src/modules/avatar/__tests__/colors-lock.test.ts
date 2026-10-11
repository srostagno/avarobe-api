import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { failure, form, json, memoryStorage, photo, routeApp, stubOpenAi, until } from '../../../__tests__/color-reads.js'
import type { Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ColorAnalysis, ColorCandidate, ColorReadLog, PreviousColors } from '../../../types/mongo.js'
import { normalizeSelfie } from '../../../utils/images.js'
import reportRoutes from '../../report/routes.js'
import { isColorsLocked } from '../reads.js'
import avatarRoutes from '../routes.js'

// Buyers keep what they paid for: a new photo that reads clearly
// differently waits as a candidate, the report stays on the paid read until
// she chooses, and only her choice switches it.

const files = memoryStorage()
const ai = stubOpenAi()
const savedComp = env.COMP_EMAILS

after(() => {
  files.restore()
  ai.restore()
  env.COMP_EMAILS = savedComp
})

beforeEach(() => {
  ai.calls.length = 0
  ai.state.reply = null
  // Deep Autumn, 3 ahead of Deep Winter: clearly different.
  ai.state.scores = { warmth: 3, depth: 4, chroma: -1, contrast: 2 }
  env.COLOR_READ_METHOD = 'scored'
  files.removed.length = 0
})

const DAY = 24 * 60 * 60 * 1000
const DEEP_WINTER: ColorAnalysis = {
  season: 'Deep Winter',
  undertone: 'cool',
  contrast: 'high',
  summary: 'Cool and deep.',
  bestColors: [{ name: 'Emerald', hex: '#00785A' }],
  neutrals: [{ name: 'Black', hex: '#000000' }],
  avoidColors: [{ name: 'Beige', hex: '#D8C3A5' }],
  metals: 'silver',
  confidence: 'high',
  photoNote: null,
}

describe('who is a buyer', () => {
  const colors = { colorAnalysis: DEEP_WINTER, colorReport: null }
  const user = (fields: Doc = {}) => ({ email: 'ana@example.test', ...fields })

  it('anyone with colors and the Color Advisor, however it came', () => {
    const live = { subscriptionId: 'sub', customerId: null, interval: 'month' as const, periodEnd: new Date(Date.now() + 5 * DAY), cancelAtPeriodEnd: false }

    assert.equal(isColorsLocked(user({ colorReportAt: new Date() }), colors), true)
    assert.equal(isColorsLocked(user({ colorMirrorAt: new Date() }), colors), true)
    assert.equal(isColorsLocked(user({ pro: { ...live, status: 'trialing' } }), colors), true)
    env.COMP_EMAILS = 'ana@example.test'
    assert.equal(isColorsLocked(user(), colors), true)
    env.COMP_EMAILS = ''
    // A report already written from these colors (the Hair Advisor's too).
    assert.equal(isColorsLocked(user(), { colorAnalysis: DEEP_WINTER, colorReport: { createdAt: new Date() } }), true)
  })

  it('nobody free, and nobody without colors', () => {
    assert.equal(isColorsLocked(user(), colors), false)
    assert.equal(isColorsLocked(user({ colorReportAt: new Date() }), { colorAnalysis: null, colorReport: null }), false)
    assert.equal(isColorsLocked(null, colors), false)
  })
})

// A buyer (Deep Winter, the Color Advisor bought, her report written, its
// drape test and a color board drawn, and a style board) without an avatar.
// `user`: other billing (none: her report alone locks her colors).
async function buyer(user: Doc = { colorReportAt: new Date() }) {
  const { app, collection, auth } = await routeApp({ '/avatar': avatarRoutes, '/report': reportRoutes })
  const userId = new ObjectId()
  const avatarId = new ObjectId()
  const dir = `users/${userId.toString()}`
  const selfieKey = `${dir}/selfie-1.jpg`
  const keys = {
    drape: `${dir}/drape-1.webp`,
    preview: `${dir}/drape-preview-1.webp`,
    neutrals: `${dir}/board-neutrals.webp`,
    capsule: `${dir}/board-capsule.webp`,
  }
  files.files.set(selfieKey, await normalizeSelfie(await photo([150, 100, 80])))

  for (const key of Object.values(keys)) {
    files.files.set(key, Buffer.from(key))
  }

  const board = (key: string) => ({ status: 'ready', key, layout: 'grid', panels: [], prompt: 'x', refs: 'portrait', size: '1024x1024', updatedAt: new Date() })
  collection('users').docs.push({ _id: userId, email: `bea-${userId.toString()}@example.test`, firstName: 'Bea', createdAt: new Date(), ...user })
  collection('avatars').docs.push({
    _id: avatarId,
    userId,
    status: 'ready',
    error: null,
    selfieKey,
    avatarKey: null,
    body: null,
    presentation: 'womenswear',
    colorAnalysis: DEEP_WINTER,
    colorsAt: new Date(Date.now() - DAY),
    colorReport: { data: { seasonLean: 'Deep Winter' }, createdAt: new Date(Date.now() - DAY) },
    drape: { status: 'ready', key: keys.drape, wear: [], avoid: [], updatedAt: new Date() },
    drapePreview: { status: 'ready', key: keys.preview, layout: 'pair', best: DEEP_WINTER.bestColors[0], worst: DEEP_WINTER.avoidColors[0], updatedAt: new Date() },
    reportBoards: { neutrals: board(keys.neutrals), capsule: { ...board(keys.capsule), refs: 'body' } },
    consentVersion: 'v1',
    consentAt: new Date(),
    generations: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const avatar = () => collection('avatars').findOne({ _id: avatarId })
  const headers = auth(userId)
  const send = async (rgb: [number, number, number]) => {
    const multipart = await form({ consent: 'true' }, { selfie: await photo(rgb) })
    return app.inject({ method: 'POST', url: '/avatar/colors', payload: multipart.payload, headers: { ...headers, ...multipart.headers } })
  }
  const recheck = async (rgb: [number, number, number] = [90, 60, 40]) => {
    const response = await send(rgb)
    assert.equal(response.statusCode, 202)
    await until(async () => (await avatar())?.status === 'ready')
    return avatar()
  }
  const choose = (readId: string, keep: 'paid' | 'new') =>
    app.inject({ method: 'POST', url: '/avatar/colors/choice', payload: { readId, keep }, headers })

  return { app, collection, userId, avatarId, selfieKey, keys, avatar, headers, send, recheck, choose, before: await avatar() }
}

const candidateOf = (avatar: Doc | null) => avatar?.colorCandidate as ColorCandidate | null

describe('a buyer’s new photo that reads clearly differently', () => {
  it('waits as a candidate, and everything stays on what she paid for', async () => {
    const bea = await buyer()
    const after = await bea.recheck()

    const candidate = candidateOf(after)!
    assert.equal(candidate.analysis.season, 'Deep Autumn')
    assert.equal((readsOf(after)[0]!).outcome, 'candidate')
    for (const field of ['colorAnalysis', 'colorsAt', 'colorReport', 'drape', 'drapePreview', 'reportBoards', 'selfieKey', 'colorsSource']) {
      assert.deepEqual(after?.[field], bea.before?.[field], field)
    }
    // Her candidate's photo stays for the choice; nothing of hers goes.
    assert.ok(files.files.has(candidate.selfieKey))
    assert.deepEqual(files.removed, [])

    const shown = await bea.app.inject({ method: 'GET', url: '/avatar', headers: bea.headers })
    const avatar = shown.json<{ avatar: Record<string, unknown> }>().avatar
    assert.equal(avatar.colorsLocked, true)
    assert.equal((avatar.colorAnalysis as { season: string }).season, 'Deep Winter')
    assert.deepEqual(
      { ...(avatar.colorCandidate as object), at: undefined, bestColors: undefined, selfieUrl: undefined },
      {
        readId: candidate.readId,
        at: undefined,
        season: 'Deep Autumn',
        undertone: 'warm',
        contrast: 'high',
        summary: 'Palette A.',
        bestColors: undefined,
        selfieUrl: undefined,
        switchable: true,
      },
    )
    assert.equal(((avatar.colorCandidate as { bestColors: unknown[] }).bestColors).length, 3)
    assert.match((avatar.colorCandidate as { selfieUrl: string }).selfieUrl, /selfie-/)
  })

  it('keeps writing her report from the paid read while it waits', async () => {
    const bea = await buyer()
    await bea.recheck()
    ai.calls.length = 0
    ai.state.reply = () => json(500, { error: { message: 'stop here' } })
    await bea.app.inject({ method: 'POST', url: '/report/color', payload: { refresh: true }, headers: bea.headers })

    const report = ai.calls.find((call) => call.schema === 'color_report')!
    const content = (report.body.input as { content: { type: string; text?: string; image_url?: string }[] }[])[0]!.content
    assert.match(content[0]!.text!, /Color season: Deep Winter/)
    assert.doesNotMatch(content[0]!.text!, /Deep Autumn/)
    assert.equal(content[1]!.image_url, `data:image/jpeg;base64,${files.files.get(bea.selfieKey)!.toString('base64')}`)
  })

  it('a confirming photo clears an older candidate, keeping her colors', async () => {
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    ai.state.scores = { warmth: -1, depth: 4, chroma: 0, contrast: 2 }
    const after = await bea.recheck([60, 50, 45])

    assert.equal(readsOf(after)[0]!.outcome, 'confirmed')
    assert.equal(after?.colorCandidate, null)
    assert.deepEqual(after?.colorAnalysis, DEEP_WINTER)
    assert.equal(after?.selfieKey, bea.selfieKey)
    assert.ok(!files.files.has(candidate.selfieKey))
    assert.ok(!files.files.has(readsOf(after)[0]!.selfieKey))
  })
})

describe('her choice', () => {
  it('keep: the candidate goes, her colors and report stay', async () => {
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    const response = await bea.choose(candidate.readId, 'paid')

    assert.equal(response.statusCode, 200)
    const after = await bea.avatar()
    assert.equal(after?.colorCandidate, null)
    for (const field of ['colorAnalysis', 'colorReport', 'drape', 'drapePreview', 'reportBoards', 'selfieKey']) {
      assert.deepEqual(after?.[field], bea.before?.[field], field)
    }
    assert.equal(readsOf(after)[0]!.outcome, 'kept_paid')
    assert.deepEqual(files.removed, [candidate.selfieKey])
    const event = await bea.collection('analyticsEvents').findOne({ name: 'colors_choice' })
    assert.deepEqual({ ...(event?.props as Doc), ageHours: undefined }, { choice: 'paid', paid: 'Deep Winter', candidate: 'Deep Autumn', ageHours: undefined })
  })

  it('switch: the new read and its photo; the report and color boards go, the style boards stay', async () => {
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    const response = await bea.choose(candidate.readId, 'new')

    assert.equal(response.statusCode, 200)
    const after = await bea.avatar()
    assert.equal((after?.colorAnalysis as ColorAnalysis).season, 'Deep Autumn')
    assert.equal(after?.selfieKey, candidate.selfieKey)
    assert.deepEqual(after?.colorsSource, candidate.source)
    assert.equal(after?.colorCandidate, null)
    assert.equal(after?.colorReport, null)
    assert.equal(after?.drape, null)
    assert.equal(after?.hairProfile, null)
    assert.equal((after?.reportBoards as Doc).neutrals, undefined)
    assert.ok((after?.reportBoards as Doc).capsule)
    assert.deepEqual(files.removed.sort(), [bea.selfieKey, bea.keys.drape, bea.keys.preview, bea.keys.neutrals].sort())
    assert.ok(files.files.has(bea.keys.capsule))
    const read = readsOf(after)[0]!
    assert.deepEqual([read.outcome, read.from, read.shown], ['switched', 'Deep Winter', 'Deep Autumn'])
  })

  it('refuses a read that isn’t the one waiting', async () => {
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    const stale = await bea.choose('another-read', 'new')

    assert.equal(stale.statusCode, 404)
    assert.deepEqual(stale.json(), { code: 'no_candidate', message: 'There is no new color read to choose.' })
    assert.equal(candidateOf(await bea.avatar())?.readId, candidate.readId)

    await bea.choose(candidate.readId, 'paid')
    assert.equal((await bea.choose(candidate.readId, 'new')).statusCode, 404)
  })

  it('waits while a read is running', async () => {
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    await bea.collection('avatars').updateOne({ _id: bea.avatarId }, { $set: { status: 'processing', job: { kind: 'colors' } } })

    const busy = await bea.choose(candidate.readId, 'new')
    assert.equal(busy.statusCode, 409)
    assert.deepEqual((await bea.avatar())?.colorAnalysis, DEEP_WINTER)
  })
})

describe('a photo already answered', () => {
  it('the one waiting for her choice, or one she kept her colors over: given back, no AI call', async () => {
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    ai.calls.length = 0

    const again = await bea.send([90, 60, 40])
    assert.equal(again.json<{ reused: boolean }>().reused, true)
    assert.equal(candidateOf(await bea.avatar())?.readId, candidate.readId)

    await bea.choose(candidate.readId, 'paid')
    const declined = await bea.send([90, 60, 40])
    assert.equal(declined.json<{ reused: boolean }>().reused, true)
    assert.equal((await bea.avatar())?.colorCandidate, null)
    assert.equal(ai.calls.length, 0)
    const scopes = (await bea.collection('analyticsEvents').find({ name: 'colors_reused' }).toArray()).map((event) => (event.props as Doc).scope)
    assert.deepEqual(scopes, ['candidate', 'history'])
  })
})

describe('classic reads (the default)', () => {
  beforeEach(() => {
    env.COLOR_READ_METHOD = 'classic'
  })

  it('give anyone with another season on a new photo the choice, not a change', async () => {
    ai.state.season = 'Soft Autumn'
    const bea = await buyer({})
    // Free: no report, no Color Advisor.
    await bea.collection('avatars').updateOne({ _id: bea.avatarId }, { $set: { colorReport: null } })
    const after = await bea.recheck()

    assert.deepEqual(after?.colorAnalysis, DEEP_WINTER)
    assert.equal(candidateOf(after)?.analysis.season, 'Soft Autumn')
    assert.equal(readsOf(after)[0]!.outcome, 'candidate')
    const shown = (await bea.app.inject({ method: 'GET', url: '/avatar', headers: bea.headers })).json<{ avatar: Record<string, unknown> }>().avatar
    assert.equal(shown.seasonRule, 'ask')
    assert.equal(shown.colorsLocked, false)
    const card = shown.colorCandidate as Record<string, unknown>
    // Its colors only with the Color Advisor.
    assert.equal(card.bestColors, undefined)
    assert.equal(card.switchable, true)

    const switched = await bea.choose(candidateOf(after)!.readId, 'new')
    assert.equal(switched.statusCode, 200)
    const done = await bea.avatar()
    assert.equal((done?.colorAnalysis as ColorAnalysis).season, 'Soft Autumn')
    assert.equal(done?.selfieKey, candidateOf(after)!.selfieKey)
    assert.deepEqual((done?.previousColors as PreviousColors).analysis, DEEP_WINTER)
    assert.equal((done?.previousColors as PreviousColors).report, null)
  })

  it('a buyer’s switch keeps what she had, report included, and its report isn’t one of the day’s', async () => {
    ai.state.season = 'Soft Autumn'
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    await bea.choose(candidate.readId, 'new')

    const after = await bea.avatar()
    const previous = after?.previousColors as PreviousColors
    assert.deepEqual(previous.analysis, DEEP_WINTER)
    assert.deepEqual(previous.report, bea.before?.colorReport)
    assert.deepEqual(previous.colorsAt, bea.before?.colorsAt)

    // At the day's limit for reports, the one for her new read is still written.
    const day = new Date().toISOString().slice(0, 10)
    bea.collection('usageCounters').docs.push({ _id: `${bea.userId.toString()}:report:${day}`, count: env.DAILY_REPORT_LIMIT })
    ai.state.reply = () => json(500, { error: { message: 'stop here' } })
    const report = await bea.app.inject({ method: 'POST', url: '/report/color', payload: {}, headers: bea.headers })

    assert.equal(report.statusCode, 502)
    assert.ok(ai.calls.some((call) => call.schema === 'color_report'))
    assert.equal((await bea.collection('usageCounters').findOne({ _id: `${bea.userId.toString()}:report:${day}` }))?.count, env.DAILY_REPORT_LIMIT)
  })

  it('a newer selfie stays when she switches to an older photo’s read', async () => {
    ai.state.season = 'Soft Autumn'
    const bea = await buyer()
    const candidate = candidateOf(await bea.recheck())!
    // A newer selfie since (Photos & measurements), with its hair read.
    const newer = `users/${bea.userId.toString()}/selfie-9.jpg`
    files.files.set(newer, Buffer.from('newer'))
    const hairProfile = { status: 'ready', data: null, error: null, startedAt: new Date(), updatedAt: new Date() }
    await bea.collection('avatars').updateOne({ _id: bea.avatarId }, { $set: { selfieKey: newer, hairProfile } })
    files.removed.length = 0

    await bea.choose(candidate.readId, 'new')
    const after = await bea.avatar()
    assert.equal((after?.colorAnalysis as ColorAnalysis).season, 'Soft Autumn')
    assert.equal(after?.selfieKey, newer)
    assert.deepEqual(after?.hairProfile, hairProfile)
    assert.ok(files.files.has(newer))
    assert.ok(files.removed.includes(candidate.selfieKey))
  })

  it('hold the colors of someone whose report couldn’t be written again (no candidate), and refuse a switch', async () => {
    ai.state.season = 'Soft Autumn'
    // A report from these colors (a lapsed Pro), no Color Advisor now.
    const bea = await buyer({})
    const after = await bea.recheck()

    assert.equal(readsOf(after)[0]!.outcome, 'anchored')
    assert.equal(after?.colorCandidate ?? null, null)
    assert.deepEqual(after?.colorReport, bea.before?.colorReport)

    // A candidate from before her Pro lapsed: hers can't be switched.
    const source = { readId: 'read-old', at: new Date(), selfieKey: bea.selfieKey, imageHash: null, method: 'classic' as const, scores: null, lighting: null }
    const stale: ColorCandidate = { readId: 'read-old', at: new Date(), selfieKey: bea.selfieKey, analysis: { ...DEEP_WINTER, season: 'Soft Autumn' }, source }
    await bea.collection('avatars').updateOne({ _id: bea.avatarId }, { $set: { colorCandidate: stale } })
    const shown = (await bea.app.inject({ method: 'GET', url: '/avatar', headers: bea.headers })).json<{ avatar: { colorCandidate: { switchable: boolean } } }>().avatar
    assert.equal(shown.colorCandidate.switchable, false)

    const refused = await bea.choose('read-old', 'new')
    assert.equal(refused.statusCode, 409)
    assert.deepEqual(refused.json(), { code: 'report_locked', message: 'Your color report stays on the colors it was written for.' })
    assert.deepEqual((await bea.avatar())?.colorReport, bea.before?.colorReport)
    assert.equal((await bea.choose('read-old', 'paid')).statusCode, 200)
  })
})

describe('a buyer’s read that fails', () => {
  it('leaves her paid colors and report alone', async () => {
    ai.state.reply = failure.noCredits
    const bea = await buyer()
    const after = await bea.recheck()

    for (const field of ['colorAnalysis', 'colorReport', 'drape', 'drapePreview', 'reportBoards', 'selfieKey']) {
      assert.deepEqual(after?.[field], bea.before?.[field], field)
    }
    assert.equal(after?.colorCandidate ?? null, null)
  })
})

function readsOf(avatar: Doc | null) {
  return (avatar?.colorReads ?? []) as ColorReadLog[]
}
