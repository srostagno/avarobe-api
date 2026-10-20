import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { UserDocument } from '../../../types/mongo.js'
import { grantColorsProOffer } from '../../feedback/wow-offer.js'
import { proRescueEmail, trialStartedEmail } from '../../lifecycle/templates.js'
import { billingState, serializeBilling } from '../entitlements.js'
import { firstChargeAfterTrial, grantSession, submitMessage } from '../stripe.js'

// The colors_pro campaigns' free trial (Oct 20, 2026, Silvio: "3 días gratis"
// instead of $3.99 up front): 3 days of Pro, the card asked, nothing charged
// today, then Pro monthly. Once per account, only for who came from a
// colors_pro campaign.

const DAY = 24 * 60 * 60 * 1000
const saved = { days: env.PRO_FIRST_TRIAL_DAYS, trial: env.PRO_TRIAL, stripe: env.STRIPE_SECRET_KEY }

before(() => {
  env.PRO_FIRST_TRIAL_DAYS = 3
  env.PRO_TRIAL = false
  // Never a request to Stripe from a test (the trial's end falls back to its days).
  env.STRIPE_SECRET_KEY = undefined
})

after(() => {
  env.PRO_FIRST_TRIAL_DAYS = saved.days
  env.PRO_TRIAL = saved.trial
  env.STRIPE_SECRET_KEY = saved.stripe
})

function account(campaign: string | null, extra: Partial<UserDocument> = {}) {
  const userId = new ObjectId()
  const acquisition = campaign
    ? { visitorId: 'v1', channel: 'meta' as const, source: 'meta', medium: 'paid_social', campaign, content: 'colors_grey_e', term: null, landing: '/color-analysis' }
    : null
  const fake = fakeApp({ users: [{ _id: userId, email: 'mia@example.com', credits: 0, createdAt: new Date(), acquisition, ...extra }] })
  const user = () => fake.collection('users').docs[0] as unknown as UserDocument

  return { ...fake, userId, user }
}

describe('the colors_pro free trial', () => {
  it('is hers when she came from a colors_pro campaign and never had Pro or a trial', () => {
    const { user } = account('colors_pro_au_ca')

    assert.equal(billingState(user()).freeTrialDays, 3)
    assert.equal(serializeBilling(user()).trialEligible, true)
    assert.equal(serializeBilling(user()).freeTrialDays, 3)
  })

  it('is nobody else’s, never twice, and off at 0 days', () => {
    for (const campaign of ['launch_us', 'faceage_au_ca', null]) {
      const { user } = account(campaign)
      assert.equal(serializeBilling(user()).freeTrialDays, null)
      assert.equal(serializeBilling(user()).trialEligible, false)
    }

    const used = account('colors_pro_au_ca', { proTrialAt: new Date(Date.now() - 10 * DAY) })
    assert.equal(serializeBilling(used.user()).freeTrialDays, null)
    assert.equal(serializeBilling(used.user()).trialEligible, false)

    env.PRO_FIRST_TRIAL_DAYS = 0
    try {
      const { user } = account('colors_pro_au_ca')
      assert.equal(serializeBilling(user()).freeTrialDays, null)
      assert.equal(serializeBilling(user()).trialEligible, false)
    } finally {
      env.PRO_FIRST_TRIAL_DAYS = 3
    }
  })

  it('replaces the half-price month on her colors, so one offer shows', async () => {
    const trial = account('colors_pro_au_ca')
    assert.equal(await grantColorsProOffer(trial.app, trial.userId), false)
    assert.equal(trial.user().proHalfOffer, undefined)

    env.PRO_FIRST_TRIAL_DAYS = 0
    try {
      const half = account('colors_pro_au_ca')
      assert.equal(await grantColorsProOffer(half.app, half.userId), true)
      assert.equal(half.user().proHalfOffer?.from, 'colors')
    } finally {
      env.PRO_FIRST_TRIAL_DAYS = 3
    }
  })

  it('says beside Pay that nothing is charged today, then the monthly price and how to cancel', () => {
    assert.match(submitMessage('pro_trial', 'us', 'en', undefined, 3), /^\$0\.00 today: 3 days of Pro free\. Then \$\d+\.\d\d per month starting .+, until you cancel\. Cancel anytime before then/)
    assert.match(submitMessage('pro_trial', 'br', 'pt-BR', undefined, 3), /^R\$\s?0,00 hoje: 3 dias de Pro grátis\. Depois, R\$/)
    assert.match(submitMessage('pro_trial', 'mx', 'es', undefined, 3), /hoy: 3 días de Pro gratis\. Después, /)
    // The paid trial keeps its fee.
    assert.doesNotMatch(submitMessage('pro_trial', 'us', 'en'), /free/)
  })

  it('starts on a $0 checkout: Pro trialing for 3 days, a $0 purchase, marked free', async () => {
    const { app, userId, user, collection } = account('colors_pro_au_ca')
    const session = {
      id: 'cs_trial',
      mode: 'subscription',
      payment_status: 'no_payment_required',
      subscription: 'sub_trial',
      invoice: 'in_trial',
      customer: 'cus_trial',
      amount_total: 0,
      currency: 'aud',
      metadata: { app: 'avarobe', userId: userId.toString(), product: 'pro_trial', offer: 'free_trial', trial_days: '3', placement: 'colors_pro_first' },
    } as unknown as Stripe.Checkout.Session

    await grantSession(app, session)
    await grantSession(app, session)

    const pro = user().pro
    assert.equal(pro?.status, 'trialing')
    assert.ok(pro?.trialEnd && Math.abs(pro.trialEnd.getTime() - (Date.now() + 3 * DAY)) < 60_000)
    assert.equal(user().proTrialFree, true)
    assert.ok(user().proTrialAt)
    const purchases = collection('purchases').docs as Array<{ product: string; amountTotal: number }>
    assert.deepEqual(
      purchases.map((purchase) => [purchase.product, purchase.amountTotal]),
      [['pro_trial', 0]],
    )
    assert.equal(serializeBilling(user()).freeTrialDays, null)
  })

  it('reports only the charge for the period that starts when the trial ends', () => {
    const trialEnd = new Date('2026-10-23T15:00:00Z')
    const lines = (start: Date) => ({ data: [{ period: { start: Math.floor(start.getTime() / 1000), end: Math.floor(start.getTime() / 1000) + 30 * 86400 } }] })

    assert.equal(firstChargeAfterTrial({ lines: lines(trialEnd) } as unknown as Stripe.Invoice, trialEnd), true)
    assert.equal(firstChargeAfterTrial({ lines: lines(new Date(trialEnd.getTime() + 30 * DAY)) } as unknown as Stripe.Invoice, trialEnd), false)
    assert.equal(firstChargeAfterTrial({ lines: lines(trialEnd) } as unknown as Stripe.Invoice, null), false)
  })

  it('emails her that nothing was charged, and rescues an unfinished one with its free days', () => {
    const recipient = { firstName: 'Mia', email: 'mia@example.com', unsubscribeUrl: 'https://example.test/u', locale: 'en' as const, region: 'us' as const }
    const started = trialStartedEmail({ ...recipient, trialEnd: new Date('2026-10-23T15:00:00Z'), days: 3, free: true })

    assert.equal(started.subject, 'Your 3 days of Avarobe Pro start now')
    assert.match(started.html, /Nothing was charged today\. Cancel anytime before Friday, October 23 in your account settings/)
    assert.doesNotMatch(started.html, /Today you paid/)

    const rescue = proRescueEmail({ ...recipient, half: null, photoUrl: null, url: 'https://example.test/studio?buy=pro_trial', trialDays: 3 })
    assert.equal(rescue.subject, 'Your 3 free days of Pro are still waiting')
    assert.match(rescue.html, /Start my 3 free days/)
    assert.match(rescue.html, /nothing is charged today/)
  })
})
