import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { EmailSendDocument } from '../../../types/mongo.js'
import { sendCheckoutRescues, sendProRescues } from '../service.js'
import { proRescueEmail } from '../templates.js'

// The Pro rescue (Oct 19, 2026): 45 minutes after a Pro checkout she didn't
// pay, her best version blurred, her half-price month if it's open, and a
// link back into that checkout. Never to anyone who paid since, in this
// account or another one of hers.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const now = new Date('2026-10-19T15:00:00Z')
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

// Jen opened a Pro annual checkout an hour ago in Instagram's browser and
// didn't pay; her half-price month is open.
function account(options: { user?: Doc; checkout?: Doc; extra?: Record<string, Doc[]> } = {}) {
  const userId = new ObjectId()
  const visitorId = 'v-jen'
  const user: Doc = {
    _id: userId,
    email: 'jen@example.com',
    firstName: 'Jen',
    createdAt: ago(3 * HOUR),
    updatedAt: ago(3 * HOUR),
    claimedAt: ago(3 * HOUR),
    location: { country: 'AU', region: 'WA', source: 'edge', at: ago(3 * HOUR) },
    proHalfOffer: { from: 'face_age', at: ago(2 * HOUR), until: later(46 * HOUR), usedAt: null },
    ...options.user,
  }
  const events: Doc[] = [
    { _id: new ObjectId(), name: 'page_view', at: ago(2 * HOUR), userId, visitorId, props: {} },
    { _id: new ObjectId(), name: 'checkout_created', at: ago(HOUR), userId, visitorId, props: { product: 'pro_annual', amount: 2999, currency: 'usd' }, ...options.checkout },
  ]
  const fake = fakeApp({ users: [user], analyticsEvents: [...events, ...(options.extra?.analyticsEvents ?? [])], purchases: options.extra?.purchases ?? [], ...(options.extra?.users ? { users: [user, ...options.extra.users] } : {}) })
  const sends = () => fake.collection('emailSends').docs as EmailSendDocument[]

  return { ...fake, userId, visitorId, sends }
}

describe('the Pro rescue', () => {
  it('goes out an hour after an unpaid Pro checkout, once, with her half-price month', async () => {
    const { app, sends } = account()

    await sendProRescues(app, now)
    await sendProRescues(app, later(HOUR))

    assert.deepEqual(
      sends().map((send) => [send.kind, send.subject]),
      [['pro_rescue', 'Your Pro month at $3.99 is still waiting']],
    )
  })

  it('waits 45 minutes, and skips Pro, guests, opt-outs and anyone who paid since', async () => {
    const early = account({ checkout: { at: ago(20 * MINUTE) } })
    await sendProRescues(early.app, now)
    assert.equal(early.sends().length, 0)

    const pro = { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'active', interval: 'month', periodEnd: later(20 * DAY), cancelAtPeriodEnd: false }
    for (const user of [{ pro }, { guest: true }, { emailTipsOptOutAt: ago(DAY) }]) {
      const skipped = account({ user })
      await sendProRescues(skipped.app, now)
      assert.equal(skipped.sends().length, 0, JSON.stringify(Object.keys(user)))
    }

    const paid = account()
    paid.collection('purchases').docs.push({ _id: new ObjectId(), userId: paid.userId, product: 'pro_monthly', createdAt: ago(10 * MINUTE) })
    await sendProRescues(paid.app, now)
    assert.equal(paid.sends().length, 0)
  })

  it('stays quiet when she paid with another account in the same browser', async () => {
    const otherId = new ObjectId()
    const { app, sends } = account({
      extra: {
        users: [{ _id: otherId, email: 'jen.two@example.com', firstName: 'Jen', createdAt: ago(30 * MINUTE) }],
        analyticsEvents: [{ _id: new ObjectId(), name: 'page_view', at: ago(30 * MINUTE), userId: otherId, visitorId: 'v-jen', props: {} }],
        purchases: [{ _id: new ObjectId(), userId: otherId, product: 'pro_annual', createdAt: ago(20 * MINUTE) }],
      },
    })

    await sendProRescues(app, now)
    await sendCheckoutRescues(app, later(2 * HOUR))

    assert.equal(sends().length, 0)
  })

  it('brings back her free days, not a price, when she came from a colors_pro campaign', async () => {
    const days = env.PRO_FIRST_TRIAL_DAYS
    env.PRO_FIRST_TRIAL_DAYS = 3

    try {
      const { app, sends, collection } = account({
        user: { proHalfOffer: null, acquisition: { visitorId: 'v-jen', channel: 'meta', source: 'meta', medium: 'paid_social', campaign: 'colors_pro_au_ca', content: null, term: null, landing: '/color-analysis' } },
        checkout: { props: { product: 'pro_trial', amount: 0, currency: 'usd' } },
      })

      await sendProRescues(app, now)

      assert.deepEqual(
        sends().map((send) => send.subject),
        ['Your 3 free days of Pro are still waiting'],
      )
      assert.equal(collection('emailSends').docs.length, 1)
    } finally {
      env.PRO_FIRST_TRIAL_DAYS = days
    }
  })

  it('leaves Pro checkouts to its own rescue', async () => {
    const { app, sends } = account()

    await sendCheckoutRescues(app, now)

    assert.equal(sends().length, 0)
  })

  it('says it plainly, with the price and a link back into checkout', () => {
    const content = proRescueEmail({
      firstName: 'Jen',
      email: 'jen@example.com',
      unsubscribeUrl: 'https://example.test/u',
      locale: 'en',
      region: 'us',
      half: { price: 399, amount: 799, currency: 'usd', hours: 46 },
      photoUrl: 'https://example.test/i.jpg',
      url: 'https://example.test/studio?buy=pro_monthly',
    })

    assert.match(content.html, /\$3\.99 instead of \$7\.99, for the next 46 hours/)
    assert.match(content.html, /buy=pro_monthly/)
    assert.doesNotMatch(content.html, /\bAI\b|free/i)
    assert.equal(proRescueEmail({ firstName: 'Ana', email: 'a@b.c', unsubscribeUrl: 'u', locale: 'es', region: 'latam', half: null, photoUrl: null, url: 'x' }).subject, 'Tu Avarobe Pro te sigue esperando')
  })
})
