import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { EmailSendDocument, UserDocument } from '../../../types/mongo.js'
import { emailImageKey, sendTeaserEmails } from '../service.js'
import { halfLastCallEmail, teaserReadyEmail } from '../templates.js'

// The teaser emails (Oct 18, 2026): her best version, still locked an hour
// after it was drawn, and her half-price month a few hours before it ends.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const now = new Date('2026-10-18T15:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const later = (ms: number) => new Date(now.getTime() + ms)
const saved = { postal: env.EMAIL_POSTAL_ADDRESS, comp: env.COMP_EMAILS }

before(() => {
  env.EMAIL_POSTAL_ADDRESS = 'Avarobe, 1 Example Street, Dublin'
  env.COMP_EMAILS = 'admin@example.test'
})

after(() => {
  env.EMAIL_POSTAL_ADDRESS = saved.postal
  env.COMP_EMAILS = saved.comp
})

// A saved account whose Hair Score drew her perfect haircut 90 minutes ago,
// with her half-price month open.
function account(options: { user?: Doc; teaser?: Doc } = {}) {
  const userId = new ObjectId()
  const checkId = new ObjectId()
  const teaserId = new ObjectId()
  const user: Doc = {
    _id: userId,
    email: 'nora@example.com',
    firstName: 'Nora',
    createdAt: ago(2 * HOUR),
    updatedAt: ago(2 * HOUR),
    claimedAt: ago(2 * HOUR),
    proHalfOffer: { from: 'hair_score', at: ago(90 * MINUTE), until: later(46 * HOUR), usedAt: null },
    ...options.user,
  }
  const teaser: Doc = {
    _id: teaserId,
    userId,
    kind: 'perfect_haircut',
    sourceId: checkId,
    status: 'ready',
    error: null,
    key: `users/${userId.toString()}/teaser-${teaserId.toString()}-1.webp`,
    lockedKey: `users/${userId.toString()}/teaser-${teaserId.toString()}-1-locked.webp`,
    plan: { name: 'Soft collarbone layers', render: 'x' },
    avatarId: null,
    selfieKey: null,
    unlockedAt: null,
    resultId: null,
    createdAt: ago(92 * MINUTE),
    updatedAt: ago(90 * MINUTE),
    ...options.teaser,
  }
  const fake = fakeApp({ users: [user], teasers: [teaser], scoreChecks: [{ _id: checkId, userId, kind: 'hair' }] })
  const sends = () => fake.collection('emailSends').docs as EmailSendDocument[]
  const emails = () => (fake.collection('users').docs[0] as UserDocument).lifecycleEmails ?? {}

  return { ...fake, userId, teaserId, sends, emails }
}

describe('the teaser emails', () => {
  it('sends her perfect haircut, blurred, an hour after it was drawn, with the half-price month', async () => {
    const { app, sends, logs, teaserId, userId } = account()

    await sendTeaserEmails(app, now)

    assert.deepEqual(
      sends().map((send) => [send.kind, send.subject]),
      [['teaser_ready', 'Your perfect haircut is ready ✂️']],
    )
    assert.ok(logs.some((entry) => entry.msg === 'Dev email (not sent)'))
    // The picture in it is the blurred copy.
    assert.match((await emailImageKey(app, userId, `teaser-${teaserId.toString()}`)) ?? '', /-locked\.webp$/)
  })

  it('says what it is, the price, and links to it', () => {
    const content = teaserReadyEmail({
      firstName: 'Nora',
      email: 'nora@example.com',
      unsubscribeUrl: 'https://example.test/u',
      locale: 'en',
      region: 'us',
      kind: 'perfect_haircut',
      name: 'Soft collarbone layers',
      fromPurchase: false,
      photoUrl: 'https://example.test/i.jpg',
      half: { price: 399, amount: 799, currency: 'usd', hours: 46 },
      url: 'https://example.test/studio/teasers/1',
    })

    assert.match(content.html, /Soft collarbone layers/)
    assert.match(content.html, /\$3\.99 instead of \$7\.99 for the next 46 hours/)
    assert.doesNotMatch(content.html, /\bAI\b|free/i)
  })

  it('waits the hour, goes once, and never to Pro, a guest or anyone who opted out', async () => {
    const early = account({ teaser: { updatedAt: ago(20 * MINUTE) } })
    await sendTeaserEmails(early.app, now)
    assert.equal(early.sends().length, 0)

    const once = account()
    await sendTeaserEmails(once.app, now)
    await sendTeaserEmails(once.app, later(DAY))
    assert.equal(once.sends().filter((send) => send.kind === 'teaser_ready').length, 1)

    const pro = { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'active', interval: 'month', periodEnd: later(20 * DAY), cancelAtPeriodEnd: false }
    for (const user of [{ pro }, { guest: true }, { emailTipsOptOutAt: ago(DAY) }]) {
      const skipped = account({ user })
      await sendTeaserEmails(skipped.app, now)
      assert.equal(skipped.sends().length, 0, JSON.stringify(Object.keys(user)))
    }

    const unlocked = account({ teaser: { unlockedAt: ago(HOUR) } })
    await sendTeaserEmails(unlocked.app, now)
    assert.equal(unlocked.sends().length, 0)
  })

  it('sends the last call a few hours before her half price ends, unused, once', async () => {
    const { app, sends, emails } = account({
      user: { proHalfOffer: { from: 'face_age', at: ago(43 * HOUR), until: later(5 * HOUR), usedAt: null }, lifecycleEmails: { teaser_ready: ago(DAY) } },
    })

    await sendTeaserEmails(app, now)
    await sendTeaserEmails(app, later(HOUR))

    assert.deepEqual(
      sends().map((send) => send.kind),
      ['half_offer_last_call'],
    )
    assert.match(sends()[0]!.subject, /\$3\.99/)
    assert.ok(emails().half_offer_last_call)

    const used = account({ user: { proHalfOffer: { from: 'face_age', at: ago(43 * HOUR), until: later(5 * HOUR), usedAt: ago(HOUR) }, lifecycleEmails: { teaser_ready: ago(DAY) } } })
    await sendTeaserEmails(used.app, now)
    assert.equal(used.sends().length, 0)
  })

  it('opens checkout from the last call', () => {
    const content = halfLastCallEmail({
      firstName: 'Ana',
      email: 'nora@example.com',
      unsubscribeUrl: 'https://example.test/u',
      locale: 'es',
      region: 'mx',
      price: 4950,
      amount: 9900,
      currency: 'mxn',
      photoUrl: null,
      url: 'https://example.test/studio?buy=pro_monthly',
    })

    assert.match(content.subject, /termina pronto/)
    assert.match(content.html, /buy=pro_monthly/)
  })
})
