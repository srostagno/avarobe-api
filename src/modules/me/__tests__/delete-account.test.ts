import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { memoryStorage, routeApp } from '../../../__tests__/color-reads.js'
import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type {
  AvatarDocument,
  ColorCheckDocument,
  EmailSendDocument,
  GuideOrderDocument,
  HairstyleDocument,
  LookDocument,
  MagazineDocument,
  PurchaseDocument,
  UserDocument,
} from '../../../types/mongo.js'
import { deletedEmail, isPlaceholderEmail } from '../../../utils/deleted-accounts.js'
import { deliverEmail } from '../../../utils/email.js'
import { hashPassword } from '../../../utils/password.js'
import authRoutes from '../../auth/routes.js'
import { deleteStaleGuests } from '../../auth/guests.js'
import { adminUserIds } from '../../billing/entitlements.js'
import { customerEmail } from '../../billing/conversions.js'
import { sendReportReminders } from '../../lifecycle/service.js'
import { deleteAccount } from '../delete-account.js'
import meRoutes from '../routes.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms)
const PASSWORD = 'violet-lantern-orchard-42'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const files = memoryStorage()
const saved = { allow: env.EMAIL_DEV_ALLOWLIST, comp: env.COMP_EMAILS }

before(() => {
  env.EMAIL_DEV_ALLOWLIST = []
})

after(() => {
  env.EMAIL_DEV_ALLOWLIST = saved.allow
  env.COMP_EMAILS = saved.comp
  files.restore()
})

type Doc = Record<string, unknown>

// One buyer with a picture of her everywhere the app keeps one, and another
// person whose files must stay.
async function buyer() {
  const userId = new ObjectId()
  const otherId = new ObjectId()
  const avatarId = new ObjectId()
  const lookId = new ObjectId()
  const drawingId = new ObjectId()
  const hairId = new ObjectId()
  const magazineId = new ObjectId()
  const checkId = new ObjectId()
  const f = (name: string) => `users/${userId.toString()}/${name}`
  const theirs = `users/${otherId.toString()}/selfie-1.jpg`
  const keys = {
    selfie: f('selfie-2.jpg'),
    body: f('body-2.jpg'),
    avatar: f('avatar-2.webp'),
    first: f('avatar-1.webp'),
    hairRef: f('avatar-hair-1.webp'),
    drape: f('drape-preview-1.webp'),
    drapeLocked: f('drape-preview-1-locked.webp'),
    board: f('board-palette-1.webp'),
    look: f(`look-${lookId.toString()}-1.webp`),
    reference: f(`look-${lookId.toString()}-reference.jpg`),
    teaser: f(`look-${lookId.toString()}-2.webp`),
    teaserLocked: f(`look-${lookId.toString()}-2-locked.webp`),
    piece: f(`look-${lookId.toString()}-piece-p1.webp`),
    drawing: f(`look-${drawingId.toString()}-preview.webp`),
    hair: f(`hairstyle-${hairId.toString()}-1.webp`),
    hairPhoto: f(`hairstyle-${hairId.toString()}-reference.jpg`),
    cover: f(`magazine-${magazineId.toString()}-cover-1.webp`),
    page: f(`magazine-${magazineId.toString()}-look1-1.webp`),
    garment: f(`check-${checkId.toString()}-garment.jpg`),
    check: f(`check-${checkId.toString()}-1.webp`),
    emailPicture: f('email-magazine-1.webp'),
    // An older selfie no document points to anymore.
    orphan: f('selfie-1.jpg'),
  }

  for (const key of [...Object.values(keys), theirs]) {
    files.files.set(key, Buffer.from(key))
  }

  const seed: Record<string, Doc[]> = {
    users: [
      {
        _id: userId,
        email: 'ana@example.com',
        firstName: 'Ana',
        createdAt: ago(10 * DAY),
        updatedAt: ago(DAY),
        lastLoginAt: ago(DAY),
        emailVerifiedAt: ago(9 * DAY),
        passwordHash: await hashPassword(PASSWORD),
        passwordUpdatedAt: ago(9 * DAY),
        signInNonceHash: 'n1',
        passwordResetNonceHash: 'n2',
        handoffNonceHash: 'n3',
        checkoutLinkNonceHash: 'n4',
        colorsLinkNonceHash: 'n5',
        emailVerificationNonceHash: 'n6',
        emailTipsOptOutAt: null,
        credits: 12,
        colorReportAt: ago(DAY),
        paidAt: ago(DAY),
        locale: 'en',
        location: { country: 'US', region: 'TX', source: 'edge', at: ago(10 * DAY) },
        acquisition: { visitorId: 'v1', channel: 'meta', source: 'facebook', medium: 'paid', campaign: 'launch_us', content: 'colors_a', term: null, landing: '/' },
        xsellAssets: { xsell_magazine: { status: 'ready', key: keys.emailPicture, ref: null, startedAt: ago(DAY) } },
      },
      { _id: otherId, email: 'lia@example.com', firstName: 'Lia', createdAt: ago(DAY), emailTipsOptOutAt: null },
    ],
    avatars: [
      {
        _id: avatarId,
        userId,
        status: 'ready',
        error: null,
        selfieKey: keys.selfie,
        bodyPhotoKey: keys.body,
        avatarKey: keys.avatar,
        versions: [
          { id: 'v2', key: keys.avatar, source: 'hair', createdAt: ago(DAY), hair: { hairstyleId: hairId.toString(), name: 'Curtain bangs', render: 'curtain bangs', refKey: keys.hairRef } },
          { id: 'v1', key: keys.first, source: 'create', createdAt: ago(2 * DAY) },
        ],
        job: null,
        body: { presentation: 'womenswear' },
        colorAnalysis: { season: 'Soft Autumn', undertone: 'warm', contrast: 'medium' },
        colorReads: [{ id: 'r1', at: ago(DAY), selfieKey: keys.selfie, imageHash: 'abc', method: 'scored', outcome: 'first', season: 'Soft Autumn' }],
        colorsSource: { readId: 'r1', at: ago(DAY), selfieKey: keys.selfie, imageHash: 'abc', method: 'scored', scores: null, lighting: 'good' },
        colorReport: { data: { headline: 'Warm and soft' }, createdAt: ago(DAY) },
        drapePreview: { status: 'ready', key: keys.drape, lockedKey: keys.drapeLocked, best: { name: 'Teal', hex: '#008080' }, worst: { name: 'Black', hex: '#000000' }, updatedAt: ago(DAY) },
        reportBoards: { palette: { status: 'ready', key: keys.board, layout: 'grid', panels: [{ label: 'Teal', verdict: 'wear', hex: '#008080' }], prompt: 'p', refs: 'portrait', size: '1024x1024', updatedAt: ago(DAY) } },
        consentVersion: 'v1',
        consentAt: ago(10 * DAY),
        generations: 2,
        createdAt: ago(10 * DAY),
        updatedAt: ago(DAY),
        readyAt: ago(10 * DAY),
      },
    ],
    looks: [
      {
        _id: lookId,
        userId,
        avatarId,
        occasion: { text: 'A garden wedding in Napa', dressCode: 'cocktail', summary: 'Garden wedding' },
        plan: { title: 'Garden party', items: [] },
        status: 'ready',
        error: null,
        imageKey: keys.look,
        previewKey: null,
        referenceKey: keys.reference,
        teaser: { status: 'ready', key: keys.teaser, lockedKey: keys.teaserLocked },
        pieces: [{ id: 'p1', slot: 'top', name: 'Silk blouse', status: 'ready', imageKey: keys.piece }],
        collectionIds: [],
        favorite: true,
        createdAt: ago(DAY),
        updatedAt: ago(DAY),
        readyAt: ago(DAY),
      },
      // Still drawing when she deleted the account.
      { _id: drawingId, userId, avatarId, occasion: { text: 'Office', dressCode: 'smart', summary: '' }, plan: { title: 'Office', items: [] }, status: 'processing', error: null, imageKey: null, previewKey: keys.drawing, collectionIds: [], favorite: false, createdAt: ago(HOUR), updatedAt: ago(HOUR), readyAt: null },
    ],
    hairstyles: [{ _id: hairId, userId, source: 'photo', status: 'ready', name: 'Curtain bangs', referenceKey: keys.hairPhoto, imageKey: keys.hair, previewKey: null, createdAt: ago(DAY), updatedAt: ago(DAY) }],
    magazines: [
      {
        _id: magazineId,
        userId,
        status: 'ready',
        moments: ['Paris in October'],
        season: 'Soft Autumn',
        palette: [],
        plan: { theme: 'Autumn in Paris' },
        cover: { status: 'ready', key: keys.cover },
        looks: [{ status: 'ready', key: keys.page }],
        via: 'credit',
        createdAt: ago(DAY),
        updatedAt: ago(DAY),
        readyAt: ago(DAY),
      },
    ],
    colorChecks: [
      {
        _id: checkId,
        userId,
        status: 'ready',
        error: null,
        garmentKey: keys.garment,
        imageKey: keys.check,
        reading: { garment: 'Red coat', verdict: 'wear', deep: { angles: [{ key: 'color', verdict: 'good', note: 'Warm red' }] } },
        createdAt: ago(DAY),
        updatedAt: ago(DAY),
      },
    ],
    refreshTokens: [{ _id: new ObjectId(), userId, tokenHash: 'th', expiresAt: new Date(Date.now() + DAY) }],
    passkeys: [{ _id: new ObjectId(), userId, credentialId: 'cred' }],
    authChallenges: [{ _id: new ObjectId(), userId, challenge: 'ch' }],
    emailSends: [{ _id: new ObjectId(), userId, kind: 'magazine_ready', subject: 'Ana, your magazine is ready', sentAt: ago(DAY) }],
    guideOrders: [{ _id: new ObjectId(), userId, email: 'ana@example.com', token: 'download_token_abc', sessionId: 'cs_book', amount: 1490, currency: 'usd', createdAt: ago(DAY), refundedAt: null }],
    surveyAnswers: [{ _id: new ObjectId(), userId, question: 'why_here', answer: 'colors', note: null, context: {}, content: null, createdAt: ago(DAY) }],
    usageCounters: [{ _id: `${userId.toString()}:look`, userId, kind: 'look', day: '2026-10-12', count: 3, expireAt: new Date(Date.now() + DAY) }],
    purchases: [
      { _id: new ObjectId(), userId, product: 'advisors_bundle', stripeSessionId: 'cs_bundle', stripePaymentIntentId: 'pi_bundle', amountTotal: 1990, currency: 'usd', amountUsd: 1990, credits: 0, createdAt: ago(DAY), refundedAt: null, colorRead: { season: 'Soft Autumn', readId: 'r1' }, cardCountry: 'US', placement: 'colors_sticky' },
    ],
  }

  return { userId, otherId, keys, theirs, seed }
}

const one = <T>(docs: Doc[]) => docs[0] as unknown as T
const byId = <T>(docs: Doc[], id: ObjectId) => docs.find((doc) => (doc._id as ObjectId).equals(id)) as unknown as T

describe('deleting an account', () => {
  it('keeps everything but her photos and name, and she can’t sign in anymore', async () => {
    const b = await buyer()
    const { app, collection, auth } = await routeApp({ '/me': meRoutes, '/auth': authRoutes }, b.seed)
    const headers = auth(b.userId)

    const response = await app.inject({ method: 'DELETE', url: '/me', headers })
    assert.equal(response.statusCode, 200)

    // The row stays, without her email, name or any way in.
    const user = byId<UserDocument>(collection('users').docs, b.userId)
    assert.equal(user.email, deletedEmail(b.userId))
    assert.equal(user.email, `deleted-${b.userId.toString()}@deleted.avarobe.invalid`)
    assert.equal(user.emailHash, sha256('ana@example.com'))
    assert.equal(user.firstName, '')
    assert.ok(user.deletedAt instanceof Date)
    assert.ok(user.emailTipsOptOutAt instanceof Date)
    for (const field of ['passwordHash', 'signInNonceHash', 'passwordResetNonceHash', 'handoffNonceHash', 'checkoutLinkNonceHash', 'colorsLinkNonceHash', 'emailVerificationNonceHash'] as const) {
      assert.equal(user[field], undefined, field)
    }
    // What she bought and where she came from stay.
    assert.equal(user.credits, 12)
    assert.ok(user.colorReportAt instanceof Date)
    assert.equal(user.location?.country, 'US')
    assert.equal(user.acquisition?.campaign, 'launch_us')
    assert.equal(user.xsellAssets?.xsell_magazine?.key, null)
    assert.equal(collection('refreshTokens').docs.length, 0)
    assert.equal(collection('passkeys').docs.length, 0)
    assert.equal(collection('authChallenges').docs.length, 0)

    // Her colors and reports stay, without a picture.
    const avatar = one<AvatarDocument>(collection('avatars').docs)
    assert.equal(avatar.colorAnalysis?.season, 'Soft Autumn')
    assert.ok(avatar.colorReport)
    assert.equal(avatar.selfieKey, '')
    assert.equal(avatar.bodyPhotoKey, null)
    assert.equal(avatar.avatarKey, null)
    assert.deepEqual(avatar.versions?.map((version) => version.key), ['', ''])
    assert.equal(avatar.versions?.[0]?.hair?.refKey, '')
    assert.equal(avatar.versions?.[0]?.hair?.name, 'Curtain bangs')
    assert.equal(avatar.colorReads?.[0]?.selfieKey, '')
    assert.equal(avatar.colorReads?.[0]?.season, 'Soft Autumn')
    assert.equal(avatar.colorsSource?.selfieKey, '')
    assert.equal(avatar.drapePreview?.key, null)
    assert.equal(avatar.drapePreview?.lockedKey, null)
    assert.equal(avatar.drapePreview?.best.name, 'Teal')
    assert.equal(avatar.reportBoards?.palette?.key, null)
    assert.equal(avatar.reportBoards?.palette?.panels[0]?.label, 'Teal')
    assert.ok(avatar.photosDeletedAt instanceof Date)

    const [look, drawing] = collection('looks').docs as unknown as LookDocument[]
    assert.equal(look!.occasion.text, 'A garden wedding in Napa')
    assert.equal(look!.imageKey, null)
    assert.equal(look!.referenceKey, null)
    assert.deepEqual(look!.teaser, { status: 'ready', key: null, lockedKey: null })
    assert.equal(look!.pieces?.[0]?.imageKey, null)
    assert.equal(look!.pieces?.[0]?.name, 'Silk blouse')
    assert.ok(look!.photosDeletedAt)
    // A render still running can't write its picture anymore.
    assert.equal(drawing!.status, 'failed')
    assert.equal(drawing!.previewKey, null)

    const hairstyle = one<HairstyleDocument & { name: string }>(collection('hairstyles').docs)
    assert.equal(hairstyle.name, 'Curtain bangs')
    assert.equal(hairstyle.imageKey, null)
    assert.equal(hairstyle.referenceKey, null)

    const magazine = one<MagazineDocument>(collection('magazines').docs)
    assert.equal(magazine.plan?.theme, 'Autumn in Paris')
    assert.deepEqual(magazine.cover, { status: 'ready', key: null })
    assert.deepEqual(magazine.looks, [{ status: 'ready', key: null }])

    const check = one<ColorCheckDocument>(collection('colorChecks').docs)
    assert.equal(check.garmentKey, '')
    assert.equal(check.imageKey, null)
    // Not a storage key: left alone.
    assert.equal(check.reading?.deep?.angles[0]?.key, 'color')

    // Every file of hers is gone, the one nothing pointed to too; the other
    // person's stays.
    assert.deepEqual([...files.files.keys()].filter((key) => key.includes(b.userId.toString())), [])
    assert.ok(files.files.has(b.theirs))

    // The rest of her records stay; her name leaves the email subjects, her
    // address the book's order.
    assert.equal(one<EmailSendDocument>(collection('emailSends').docs).subject, '…, your magazine is ready')
    assert.equal(one<GuideOrderDocument>(collection('guideOrders').docs).email, deletedEmail(b.userId))
    assert.equal(one<GuideOrderDocument>(collection('guideOrders').docs).token, 'download_token_abc')
    assert.equal(collection('surveyAnswers').docs.length, 1)
    assert.equal(collection('usageCounters').docs.length, 1)
    const purchase = one<PurchaseDocument>(collection('purchases').docs)
    assert.ok(purchase.accountDeletedAt)
    assert.ok(purchase.userId.equals(b.userId))
    assert.deepEqual(purchase.colorRead, { season: 'Soft Autumn', readId: 'r1' })
    assert.equal(purchase.cardCountry, 'US')

    // No way back in: the access token still in her browser, her password,
    // her old email.
    assert.equal((await app.inject({ method: 'PATCH', url: '/me', headers, payload: { firstName: 'Ana' } })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@example.com', password: PASSWORD } })).statusCode, 401)

    // The same email signs up again as a brand-new account.
    const again = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'ana@example.com', password: PASSWORD, firstName: 'Ana' } })
    assert.equal(again.statusCode, 201)
    const fresh = collection('users').docs.find((doc) => doc.email === 'ana@example.com')!
    assert.ok(!(fresh._id as ObjectId).equals(b.userId))
    assert.equal(fresh.deletedAt, undefined)
    assert.equal(collection('users').docs.filter((doc) => doc.deletedAt).length, 1)
  })

  it('never emails it, nor hashes its alias for ads', async () => {
    const alias = deletedEmail(new ObjectId())
    const lines: unknown[] = []
    const log = { info: (obj: unknown) => lines.push(obj) } as never

    assert.equal(isPlaceholderEmail(alias), true)
    assert.equal(isPlaceholderEmail('ana@example.com'), false)
    // Even where production sends everything.
    const mode = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      assert.equal(await deliverEmail({ log, to: { email: alias }, content: { subject: 's', html: 'h', text: 't' } }), false)
    } finally {
      env.NODE_ENV = mode
    }
    assert.equal(customerEmail(alias), undefined)
    assert.equal(customerEmail('Ana@Example.com '), 'ana@example.com')

    // A buyer who never opened her report is reminded, unless she deleted
    // the account.
    const b = await buyer()
    const { app, collection } = fakeApp({
      ...b.seed,
      users: b.seed.users!.map((doc) => (doc._id === b.otherId ? { ...doc, colorReportAt: ago(DAY) } : doc)),
      avatars: [...b.seed.avatars!, { _id: new ObjectId(), userId: b.otherId, status: 'ready', selfieKey: 'x', avatarKey: null, colorAnalysis: { season: 'Cool Winter' } }],
    })
    await deleteAccount(app, b.userId)
    await collection('avatars').updateOne({ userId: b.userId }, { $set: { colorReport: null } })
    await sendReportReminders(app)

    const reminded = (id: ObjectId) => Boolean(byId<UserDocument>(collection('users').docs, id).lifecycleEmails?.report_unopened)
    assert.equal(reminded(b.otherId), true)
    assert.equal(reminded(b.userId), false)
  })

  it('still leaves an admin’s deleted test account out of the numbers', async () => {
    env.COMP_EMAILS = 'admin@example.test'
    const adminId = new ObjectId()
    const { app } = fakeApp({ users: [{ _id: adminId, email: 'admin@example.test', firstName: 'Admin', createdAt: ago(DAY) }] })

    await deleteAccount(app, adminId)

    const ids = await adminUserIds(app)
    assert.equal(ids.length, 1)
    assert.ok(ids[0]!.equals(adminId))
  })
})

describe('guests that never saved', () => {
  const guest = (extra: Doc = {}) => ({ _id: new ObjectId(), guest: true, email: `${new ObjectId().toString()}@guest.avarobe.invalid`, firstName: '', createdAt: ago(30 * DAY), ...extra })

  it('are deleted by the same rule after their days, and a guest who paid is never touched', async () => {
    const unsaved = guest()
    const recent = guest({ createdAt: ago(DAY) })
    const paid = guest({ paidAt: ago(20 * DAY) })
    const refunded = guest()
    const selfie = `users/${unsaved._id.toString()}/selfie-1.jpg`
    const paidSelfie = `users/${paid._id.toString()}/selfie-1.jpg`
    files.files.set(selfie, Buffer.from('a'))
    files.files.set(paidSelfie, Buffer.from('b'))
    const { app, collection } = fakeApp({
      users: [unsaved, recent, paid, refunded],
      avatars: [
        { _id: new ObjectId(), userId: unsaved._id, status: 'ready', selfieKey: selfie, avatarKey: null, colorAnalysis: { season: 'Deep Winter' } },
        { _id: new ObjectId(), userId: paid._id, status: 'ready', selfieKey: paidSelfie, avatarKey: null, colorAnalysis: { season: 'Light Spring' } },
      ],
      purchases: [
        { _id: new ObjectId(), userId: paid._id, product: 'color_report', amountTotal: 499, currency: 'usd', createdAt: ago(20 * DAY), refundedAt: null },
        { _id: new ObjectId(), userId: refunded._id, product: 'color_report', amountTotal: 499, currency: 'usd', createdAt: ago(20 * DAY), refundedAt: ago(19 * DAY) },
      ],
    })

    assert.equal(await deleteStaleGuests(app), 1)

    const users = new Map((collection('users').docs as unknown as UserDocument[]).map((doc) => [doc._id.toString(), doc]))
    assert.equal(users.size, 4)
    assert.ok(users.get(unsaved._id.toString())!.deletedAt)
    assert.equal(users.get(unsaved._id.toString())!.email, deletedEmail(unsaved._id))
    assert.equal(users.get(unsaved._id.toString())!.emailHash, null)
    assert.equal(users.get(recent._id.toString())!.deletedAt, undefined)
    assert.equal(users.get(paid._id.toString())!.deletedAt, undefined)
    assert.equal(users.get(refunded._id.toString())!.deletedAt, undefined)

    const [gone, kept] = collection('avatars').docs as unknown as AvatarDocument[]
    assert.equal(gone!.selfieKey, '')
    assert.equal(gone!.colorAnalysis?.season, 'Deep Winter')
    assert.equal(kept!.selfieKey, paidSelfie)
    assert.equal(files.files.has(selfie), false)
    assert.equal(files.files.has(paidSelfie), true)

    // Once deleted, never again.
    assert.equal(await deleteStaleGuests(app), 0)
  })
})
