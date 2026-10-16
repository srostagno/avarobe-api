import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'

import { Binary, ObjectId } from 'mongodb'

import { form, memoryStorage, photo, routeApp, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { FaceCheckDocument, UserDocument } from '../../../types/mongo.js'
import { exifDate, parseExifDate } from '../../../utils/exif-date.js'
import { ageOn, currentAge, shownAge } from '../age.js'
import { reminderDue } from '../reminders.js'
import lookRoutes from '../routes.js'
import { UNLOCK_HEADER, deleteLookData, lookAvailable, signUnlock } from '../service.js'

// Face Age (Oct 15, 2026; "Look Great" its first day): face photos over time, how old the face reads
// (calibrated, never cruel), and a release, a state gate and a Face ID lock
// around it.

const DAY = 24 * 60 * 60 * 1000

function person(overrides: Partial<UserDocument> = {}): UserDocument {
  const now = new Date()
  return {
    _id: new ObjectId(),
    email: 'rosa@example.com',
    firstName: 'Rosa',
    credits: 0,
    createdAt: now,
    updatedAt: now,
    locale: 'en',
    ...overrides,
  } as UserDocument
}

const profile = (overrides: Partial<NonNullable<UserDocument['lookGreat']>> = {}) => ({
  birthDate: '1970-05-20',
  consentAt: new Date(),
  consentVersion: 'look-2026-10-15',
  consentName: 'Rosa Diaz',
  reminder: 'few' as const,
  reminderLastAt: null,
  lock: false,
  createdAt: new Date(),
  ...overrides,
})

const READING = {
  usable: true,
  problem: 'none',
  apparentAge: 52,
  potentialYears: 4,
  headline: 'Your eyes look bright and rested today.',
  strengths: ['Even skin tone'],
  agingFactors: ['The black top casts shadows under your jaw'],
  tips: [
    { area: 'color', text: 'Try a softer, warmer shade near your face.' },
    { area: 'light', text: 'Face the window.' },
    { area: 'brows', text: 'Fill the tails of your brows lightly.' },
  ],
  photo: { light: 'good', glasses: false, makeup: 'light', expression: 'neutral', angle: 'front' },
}

// Every /responses call answered with this reading.
function stubReadings(reading: Record<string, unknown> = READING) {
  const saved = { fetch: globalThis.fetch, key: env.OPENAI_API_KEY, fault: env.AI_FAULT }
  const bodies: Record<string, unknown>[] = []

  env.OPENAI_API_KEY = 'sk-test-not-a-key'
  env.AI_FAULT = undefined
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>)
    return new Response(JSON.stringify({ output_text: JSON.stringify(reading) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  return {
    bodies,
    restore: () => {
      globalThis.fetch = saved.fetch
      env.OPENAI_API_KEY = saved.key
      env.AI_FAULT = saved.fault
    },
  }
}

describe('the age she sees', () => {
  const offset = env.LOOK_AGE_OFFSET

  after(() => {
    env.LOOK_AGE_OFFSET = offset
  })

  it('counts whole years to the photo’s day', () => {
    assert.equal(ageOn('1970-05-20', new Date('2026-05-19T00:00:00Z')), 55)
    assert.equal(ageOn('1970-05-20', new Date('2026-05-20T00:00:00Z')), 56)
    assert.equal(ageOn('1970-02-30', new Date()), null)
  })

  it('takes the model’s lean off, and never reads more than 6 over her age or 15 under', () => {
    env.LOOK_AGE_OFFSET = -2
    assert.equal(shownAge(54, 56), 52)
    assert.equal(shownAge(70, 56), 62)
    assert.equal(shownAge(30, 56), 41)
    assert.equal(shownAge(54, null), 52)
  })

  it('reads “today” from her recent photos, so one bad photo doesn’t swing it', () => {
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY)

    assert.equal(currentAge([]), null)
    assert.equal(currentAge([{ takenAt: at(0), age: 50 }, { takenAt: at(1), age: 58 }, { takenAt: at(2), age: 51 }]), 51)
    // An old photo doesn't count toward today.
    assert.equal(currentAge([{ takenAt: at(0), age: 50 }, { takenAt: at(400), age: 44 }]), 50)
  })
})

describe('an old photo’s date', () => {
  // A minimal EXIF block: IFD0 → Exif IFD → DateTimeOriginal.
  function exifWith(date: string) {
    const tiff = Buffer.alloc(80)
    tiff.write('II', 0, 'latin1')
    tiff.writeUInt16LE(42, 2)
    tiff.writeUInt32LE(8, 4)
    tiff.writeUInt16LE(1, 8)
    tiff.writeUInt16LE(0x8769, 10)
    tiff.writeUInt16LE(4, 12)
    tiff.writeUInt32LE(1, 14)
    tiff.writeUInt32LE(26, 18)
    tiff.writeUInt16LE(1, 26)
    tiff.writeUInt16LE(0x9003, 28)
    tiff.writeUInt16LE(2, 30)
    tiff.writeUInt32LE(20, 32)
    tiff.writeUInt32LE(44, 36)
    tiff.write(`${date}\0`, 44, 'latin1')

    return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  }

  it('comes from the camera when the photo kept it', () => {
    assert.equal(exifDate(exifWith('2023:07:14 18:22:01'))?.toISOString().slice(0, 10), '2023-07-14')
    assert.equal(exifDate(Buffer.from('nothing here at all')), null)
    assert.equal(parseExifDate('2099:01:01 00:00:00'), null)
  })
})

describe('where Look Great opens', () => {
  it('is closed in Illinois and Washington, by where she is or signed up', () => {
    assert.equal(lookAvailable({ country: 'US', region: 'TX' }, null), true)
    assert.equal(lookAvailable({ country: 'US', region: 'IL' }, null), false)
    assert.equal(lookAvailable({ country: 'BR', region: null }, { country: 'US', region: 'WA' }), false)
    assert.equal(lookAvailable(null, null), true)
  })
})

describe('Look Great routes', () => {
  let files: ReturnType<typeof memoryStorage>
  let ai: ReturnType<typeof stubReadings>
  const saved = { free: env.LOOK_FREE_PHOTOS, comp: env.COMP_EMAILS }

  before(() => {
    env.LOOK_FREE_PHOTOS = 3
    env.COMP_EMAILS = 'owner@avarobe.test'
  })

  after(() => {
    env.LOOK_FREE_PHOTOS = saved.free
    env.COMP_EMAILS = saved.comp
  })

  beforeEach(() => {
    files = memoryStorage()
    ai = stubReadings()
  })

  afterEach(() => {
    files.restore()
    ai.restore()
  })

  async function setup(user: UserDocument, seed: Record<string, Record<string, unknown>[]> = {}) {
    const built = await routeApp({ '/look': lookRoutes }, { users: [user], ...seed })
    const headers = built.auth(user._id)
    const send = async (fields: Record<string, string>, extra: Record<string, string> = {}) => {
      const body = await form(fields, { photo: await photo([180, 140, 120]) }, { ...headers, ...extra })
      return built.app.inject({ method: 'POST', url: '/look/photos', ...body })
    }

    return { ...built, headers, send }
  }

  it('starts only with her consent, at 18 or older, and not from Illinois', async () => {
    const rosa = person()
    const { app, headers } = await setup(rosa)
    const start = (payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: '/look/profile', headers: { ...headers, ...extra }, payload })

    assert.equal((await start({ birthDate: '1970-05-20', consentName: 'Rosa Diaz' })).statusCode, 400)
    assert.equal((await start({ birthDate: '2015-01-01', consent: true, consentName: 'Rosa Diaz' })).statusCode, 400)
    assert.equal((await start({ birthDate: '1970-05-20', consent: true, consentName: 'Rosa Diaz' }, { cookie: 'avarobe_geo=US-IL' })).statusCode, 403)

    const ok = await start({ birthDate: '1970-05-20', consent: true, consentName: 'Rosa Diaz', reminder: 'daily' })
    assert.equal(ok.statusCode, 200)
    assert.equal(ok.json<{ profile: { reminder: string } }>().profile.reminder, 'daily')

    // Since Oct 16 her tap on "Agree and continue" is the consent: no typed
    // name. The page learns it from the state it loads before she starts.
    const fresh = person({ email: 'fresh@avarobe.test' })
    const other = await setup(fresh)
    const before = await other.app.inject({ method: 'GET', url: '/look', headers: other.headers })
    assert.equal(before.json<{ consentByTap?: boolean }>().consentByTap, true)
    const tapped = await start({ consent: true })
    assert.equal(tapped.statusCode, 200)
    const saved = await app.collections.users.findOne({ _id: rosa._id })
    assert.equal(saved?.lookGreat?.consentName, null)
    assert.equal(saved?.lookGreat?.consentVersion, 'face-age-2026-10-16')
  })

  it('reads a photo, calibrated against her age, with her tips', async () => {
    const rosa = person({ lookGreat: profile() })
    const { app, headers, send, collection } = await setup(rosa)

    const added = await send({ source: 'camera' })
    assert.equal(added.statusCode, 202)
    await until(async () => (collection('faceChecks').docs[0] as FaceCheckDocument).status !== 'processing')

    // Never kept by OpenAI, and her palette never sent before she owns it.
    assert.equal(ai.bodies[0]?.store, false)
    assert.ok(!String(ai.bodies[0]?.instructions).includes('Her best colors'))

    // Her real age's decade goes in for the tips only.
    assert.ok(String(ai.bodies[0]?.instructions).includes(`She is in her ${Math.floor(ageOn('1970-05-20', new Date())! / 10) * 10}s`))

    const state = (await app.inject({ method: 'GET', url: '/look', headers })).json<{
      checks: { age: number; realAge: number; potentialAge?: number; photoUrl: string | null; reading: { tips: unknown[]; lockedTips: number } }[]
      summary: { age: number; younger: number }
      allowance: { freeLeft: number }
    }>()
    const realAge = ageOn('1970-05-20', new Date())!

    assert.equal(state.checks[0]?.age, Math.min(realAge + 6, 52 + env.LOOK_AGE_OFFSET))
    // No promised number of years off: the next read wouldn't show it.
    assert.equal(state.checks[0]?.potentialAge, undefined)
    // Without Pro: the first tip; the other two are what Pro unlocks.
    assert.equal(state.checks[0]?.reading.tips.length, 1)
    assert.equal(state.checks[0]?.reading.lockedTips, 2)
    assert.ok(state.checks[0]?.photoUrl)
    assert.equal(state.summary.younger, realAge - state.summary.age)
    assert.equal(state.allowance.freeLeft, 2)
  })

  it('deletes a photo it can’t read (two faces, a minor) and says why', async () => {
    ai.restore()
    ai = stubReadings({ ...READING, usable: false, problem: 'several_faces', apparentAge: 30, potentialYears: 0, strengths: [], agingFactors: [], tips: [], headline: '' })
    const rosa = person({ lookGreat: profile() })
    const { app, headers, send, collection } = await setup(rosa)

    await send({ source: 'upload' })
    await until(async () => (collection('faceChecks').docs[0] as FaceCheckDocument).status !== 'processing')

    const check = collection('faceChecks').docs[0] as FaceCheckDocument
    assert.equal(check.status, 'failed')
    assert.equal(check.photoKey, '')
    assert.equal(files.files.size, 0)

    const state = (await app.inject({ method: 'GET', url: '/look', headers })).json<{ checks: { problem: string | null; age: number | null }[] }>()
    assert.equal(state.checks[0]?.problem, 'several_faces')
    assert.equal(state.checks[0]?.age, null)
  })

  it('shows all three tips with Pro (an admin here)', async () => {
    const owner = person({ email: 'owner@avarobe.test', lookGreat: profile() })
    const { app, headers, send, collection } = await setup(owner)

    await send({ source: 'camera' })
    await until(async () => (collection('faceChecks').docs[0] as FaceCheckDocument).status !== 'processing')

    const state = (await app.inject({ method: 'GET', url: '/look', headers })).json<{ checks: { reading: { tips: unknown[]; lockedTips: number } }[]; summary: { areas: Record<string, number> } }>()
    assert.equal(state.checks[0]?.reading.tips.length, 3)
    assert.equal(state.checks[0]?.reading.lockedTips, 0)
    assert.deepEqual(state.summary.areas, { color: 1, light: 1, brows: 1 })
  })

  it('works without a birth date: no real age, no decade, old photos taken', async () => {
    const rosa = person()
    const { app, headers, send, collection } = await setup(rosa)
    const started = await app.inject({ method: 'POST', url: '/look/profile', headers, payload: { consent: true, consentName: 'Rosa Diaz' } })
    assert.equal(started.statusCode, 200)

    assert.equal((await send({ source: 'import', takenAt: '1985-06' })).statusCode, 202)
    await until(async () => (collection('faceChecks').docs[0] as FaceCheckDocument).status !== 'processing')
    assert.ok(!String(ai.bodies[0]?.instructions).includes('She is in her'))

    const state = (await app.inject({ method: 'GET', url: '/look', headers })).json<{ checks: { age: number; realAge: number | null }[]; summary: { realAge: number | null; younger: number | null } }>()
    assert.equal(state.checks[0]?.age, 52 + env.LOOK_AGE_OFFSET)
    assert.equal(state.checks[0]?.realAge, null)
    assert.equal(state.summary.younger, null)
  })

  it('lets an admin start over as a first-timer, free photos included; nobody else', async () => {
    const owner = person({ email: 'owner@avarobe.test', lookGreat: profile(), lookPhotosAdded: 3 })
    const { app, headers, collection } = await setup(owner)

    const reset = await app.inject({ method: 'POST', url: '/look/reset', headers })
    assert.equal(reset.statusCode, 200)
    assert.equal(reset.json<{ profile: unknown }>().profile, null)
    const saved = collection('users').docs[0] as UserDocument
    assert.equal(saved.lookGreat, undefined)
    assert.equal(saved.lookPhotosAdded, undefined)

    const rosa = person({ lookGreat: profile() })
    const other = await setup(rosa)
    assert.equal((await other.app.inject({ method: 'POST', url: '/look/reset', headers: other.headers })).statusCode, 403)
  })

  it('dates an old photo by her pick, and never takes one of her under 18', async () => {
    const rosa = person({ lookGreat: profile() })
    const { send, collection } = await setup(rosa)

    const undated = await send({ source: 'import' })
    assert.equal(undated.statusCode, 400)
    assert.equal(undated.json<{ code: string }>().code, 'needs_date')

    const minor = await send({ source: 'import', takenAt: '1985-06' })
    assert.equal(minor.json<{ code: string }>().code, 'too_young')

    const old = await send({ source: 'import', takenAt: '2019-08' })
    assert.equal(old.statusCode, 202)
    const check = collection('faceChecks').docs[0] as FaceCheckDocument
    assert.equal(check.takenAt.toISOString().slice(0, 10), '2019-08-01')
    assert.equal(check.dateSource, 'chosen')
  })

  it('gives three photos free, then offers Pro', async () => {
    const rosa = person({ lookGreat: profile() })
    const { send } = await setup(rosa)

    for (let index = 0; index < 3; index += 1) {
      assert.equal((await send({ source: 'camera' })).statusCode, 202)
    }

    const fourth = await send({ source: 'camera' })
    assert.equal(fourth.statusCode, 402)
    assert.equal(fourth.json<{ code: string }>().code, 'needs_pro')
  })

  it('doesn’t give a free photo back when she deletes one, only when it couldn’t be read', async () => {
    const rosa = person({ lookGreat: profile() })
    const { app, headers, send, collection } = await setup(rosa)

    for (let index = 0; index < 3; index += 1) {
      await send({ source: 'camera' })
    }

    await until(async () => collection('faceChecks').docs.every((doc) => (doc as FaceCheckDocument).status !== 'processing'))
    const first = collection('faceChecks').docs[0] as FaceCheckDocument
    await app.inject({ method: 'DELETE', url: `/look/photos/${first._id.toString()}`, headers })
    await app.inject({ method: 'DELETE', url: '/look', headers })
    await app.inject({ method: 'POST', url: '/look/profile', headers, payload: { birthDate: '1970-05-20', consent: true, consentName: 'Rosa Diaz' } })

    assert.equal((await send({ source: 'camera' })).statusCode, 402)

    // A photo it couldn't read: its place comes back.
    await app.collections.users.updateOne({ _id: rosa._id }, { $set: { lookPhotosAdded: 2 } })
    ai.restore()
    ai = stubReadings({ ...READING, usable: false, problem: 'no_face' })
    assert.equal((await send({ source: 'camera' })).statusCode, 202)
    await until(async () => collection('faceChecks').docs.every((doc) => (doc as FaceCheckDocument).status !== 'processing'))
    assert.equal((collection('users').docs[0] as UserDocument).lookPhotosAdded, 2)
  })

  it('locks older photos behind her passkey; the unlock opens them and is no session', async () => {
    const rosa = person({ lookGreat: profile() })
    const old: FaceCheckDocument = {
      _id: new ObjectId(),
      userId: rosa._id,
      status: 'ready',
      error: null,
      photoKey: `users/${rosa._id.toString()}/face-old.jpg`,
      takenAt: new Date('2024-03-01T00:00:00Z'),
      source: 'import',
      dateSource: 'chosen',
      reading: { ...READING, problem: null } as FaceCheckDocument['reading'],
      createdAt: new Date(Date.now() - 2 * DAY),
      updatedAt: new Date(Date.now() - 2 * DAY),
    }
    const { app, headers } = await setup(rosa, { faceChecks: [old] })
    const lock = () => app.inject({ method: 'PATCH', url: '/look/profile', headers, payload: { lock: true } })

    // No passkey yet: no lock.
    assert.equal((await lock()).json<{ code: string }>().code, 'no_passkey')

    await app.collections.passkeys.insertOne({
      _id: new ObjectId(),
      userId: rosa._id,
      credentialId: 'cred-1',
      publicKey: new Binary(Buffer.from('key')),
      counter: 0,
      transports: [],
      deviceType: 'multiDevice',
      backedUp: true,
      name: 'iPhone',
      createdAt: new Date(),
      lastUsedAt: null,
    })
    assert.equal((await lock()).statusCode, 200)

    const lockedState = (await app.inject({ method: 'GET', url: '/look', headers })).json<{ checks: { photoUrl: string | null; locked: boolean }[] }>()
    assert.equal(lockedState.checks[0]?.photoUrl, null)
    assert.equal(lockedState.checks[0]?.locked, true)

    const token = signUnlock(app, rosa._id)
    const open = (await app.inject({ method: 'GET', url: '/look', headers: { ...headers, [UNLOCK_HEADER]: token } })).json<{ checks: { photoUrl: string | null }[] }>()
    assert.ok(open.checks[0]?.photoUrl)

    // Someone else's unlock opens nothing, and an unlock is never a session.
    const other = signUnlock(app, new ObjectId())
    const stranger = (await app.inject({ method: 'GET', url: '/look', headers: { ...headers, [UNLOCK_HEADER]: other } })).json<{ checks: { photoUrl: string | null }[] }>()
    assert.equal(stranger.checks[0]?.photoUrl, null)
    assert.equal((await app.inject({ method: 'GET', url: '/look', headers: { authorization: `Bearer ${token}` } })).statusCode, 401)
  })

  it('deletes everything when she asks: photos, readings, birth date and release', async () => {
    const rosa = person({ lookGreat: profile() })
    const { app, headers, send, collection } = await setup(rosa)

    await send({ source: 'camera' })
    await until(async () => (collection('faceChecks').docs[0] as FaceCheckDocument).status !== 'processing')
    assert.equal(files.files.size, 1)

    const gone = await app.inject({ method: 'DELETE', url: '/look', headers })
    assert.equal(gone.json<{ photos: number }>().photos, 1)
    assert.equal(files.files.size, 0)
    assert.equal(collection('faceChecks').docs.length, 0)
    assert.equal((collection('users').docs[0] as UserDocument).lookGreat, undefined)

    // Again: nothing left to delete.
    assert.equal((await deleteLookData(app, rosa._id, { profile: true })).photos, 0)
  })
})

describe('the reminder she asked for', () => {
  const now = new Date('2026-10-20T13:00:00Z')
  const base = { reminderLastAt: null, startedAt: new Date('2026-10-01T00:00:00Z'), hour: 9, now }

  it('goes in her morning, once the period since her last photo has passed', () => {
    assert.equal(reminderDue({ ...base, reminder: 'daily', lastPhotoAt: new Date(now.getTime() - 21 * 60 * 60 * 1000) }), true)
    assert.equal(reminderDue({ ...base, reminder: 'daily', lastPhotoAt: new Date(now.getTime() - 5 * 60 * 60 * 1000) }), false)
    assert.equal(reminderDue({ ...base, reminder: 'weekly', lastPhotoAt: new Date(now.getTime() - 3 * DAY) }), false)
    assert.equal(reminderDue({ ...base, reminder: 'daily', lastPhotoAt: null, hour: 15 }), false)
    assert.equal(reminderDue({ ...base, reminder: 'off', lastPhotoAt: null }), false)
  })
})
