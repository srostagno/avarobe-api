import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { UserDocument } from '../../../types/mongo.js'
import { trialStartedEmail } from '../../lifecycle/templates.js'
import { billingState, serializeBilling } from '../entitlements.js'
import { regionalAmount } from '../pricing.js'
import { PRO_PRODUCTS } from '../refunds.js'
import { grantSession, handleInvoicePaid, pixSubscription, submitMessage, termsAcceptance } from '../stripe.js'

// The Color Advisor with Pro's first days (Oct 23, 2026, Silvio: one-time
// sales alone don't pay for the ads, recurrence does): the report's price
// today, the report for good, 7 days of Pro, then Pro monthly until she
// cancels. Brazil can pay it with Pix Automático.

const DAY = 24 * 60 * 60 * 1000
const saved = {
  days: env.COLOR_PRO_TRIAL_DAYS,
  freeDays: env.PRO_FIRST_TRIAL_DAYS,
  pix: env.PIX_SUBSCRIPTIONS,
  stripe: env.STRIPE_SECRET_KEY,
}

before(() => {
  env.COLOR_PRO_TRIAL_DAYS = 7
  env.PRO_FIRST_TRIAL_DAYS = 3
  env.PIX_SUBSCRIPTIONS = true
  // Never a request to Stripe from a test (the trial's end falls back to its days).
  env.STRIPE_SECRET_KEY = undefined
})

after(() => {
  env.COLOR_PRO_TRIAL_DAYS = saved.days
  env.PRO_FIRST_TRIAL_DAYS = saved.freeDays
  env.PIX_SUBSCRIPTIONS = saved.pix
  env.STRIPE_SECRET_KEY = saved.stripe
})

function account(extra: Partial<UserDocument> = {}) {
  const userId = new ObjectId()
  const acquisition = { visitorId: 'v1', channel: 'meta' as const, source: 'meta', medium: 'paid_social', campaign: 'launch_br', content: 'colors_nora_a', term: null, landing: '/pt-br/color-analysis' }
  const fake = fakeApp({ users: [{ _id: userId, email: 'nora@example.com', credits: 0, createdAt: new Date(), acquisition, location: { country: 'BR' }, ...extra }] })
  const user = () => fake.collection('users').docs[0] as unknown as UserDocument

  return { ...fake, userId, user }
}

const purchasesOf = (collection: ReturnType<typeof account>['collection']) =>
  (collection('purchases').docs as Array<{ product: string; amountTotal: number; credits: number }>).map((p) => [p.product, p.amountTotal, p.credits])

describe('the Color Advisor with Pro’s first days', () => {
  it('is offered to who has no Color Advisor and never had Pro or a trial', () => {
    const { user } = account()

    assert.equal(billingState(user()).colorProDays, 7)
    assert.equal(serializeBilling(user()).colorProDays, 7)
  })

  it('is nobody else’s: the report owned, Pro or a trial before, a colors_pro visitor, or off at 0 days', () => {
    const cases: Partial<UserDocument>[] = [
      { colorReportAt: new Date() },
      { colorMirrorAt: new Date() },
      { proTrialAt: new Date(Date.now() - 30 * DAY) },
      { pro: { subscriptionId: 'sub_old', customerId: null, status: 'canceled', interval: 'month', periodEnd: new Date(Date.now() - 40 * DAY), cancelAtPeriodEnd: false } },
      // A colors_pro campaign's free days come first.
      { acquisition: { visitorId: 'v2', channel: 'meta', source: 'meta', medium: 'paid_social', campaign: 'colors_pro_au_ca', content: null, term: null, landing: '/color-analysis' } },
    ]

    for (const extra of cases) {
      const { user } = account(extra)
      assert.equal(serializeBilling(user()).colorProDays, null, JSON.stringify(Object.keys(extra)))
    }

    env.COLOR_PRO_TRIAL_DAYS = 0
    try {
      assert.equal(serializeBilling(account().user()).colorProDays, null)
    } finally {
      env.COLOR_PRO_TRIAL_DAYS = 7
    }
  })

  it('costs what the Color Advisor costs, in every region', () => {
    for (const region of ['us', 'br', 'mx', 'co', 'latam'] as const) {
      assert.equal(regionalAmount('color_pro', region), regionalAmount('color_report', region), region)
    }
  })

  it('says beside Pay what she pays today, that the report is hers, and when Pro starts charging', () => {
    assert.match(submitMessage('color_pro', 'us', 'en'), /^\$\d+\.\d\d today for your Color Advisor, yours to keep, with 7 days of Pro\. Then \$\d+\.\d\d per month starting .+, until you cancel\. Cancel anytime before then/)
    assert.match(submitMessage('color_pro', 'br', 'pt-BR'), /^R\$\s?27,90 hoje pelo seu Consultor de Cores, seu para sempre, com 7 dias de Pro\. Depois, R\$\s?24,90 por mês/)
    assert.match(submitMessage('color_pro', 'mx', 'es'), /hoy por tu Asesor de Color, tuyo para siempre, con 7 días de Pro\. Después, /)
    // Her consent at checkout is to the renewal after the trial.
    assert.match(termsAcceptance('en', 'color_pro', 'us'), /after the trial Pro renews automatically at \$\d+\.\d\d per month until I cancel/)
    assert.match(termsAcceptance('pt-BR', 'color_pro', 'br'), /depois do teste o Pro renova automaticamente por R\$\s?24,90 por mês/)
  })

  it('lets Brazil pay Pro with Pix Automático, with room in the mandate, and nobody else', () => {
    const monthly = pixSubscription('br', 'pro_monthly', regionalAmount('color_pro', 'br'))
    assert.deepEqual(monthly.payment_method_types, ['card', 'pix'])
    const mandate = (monthly.payment_method_options as { pix: { mandate_options: { amount: number; payment_schedule: string } } }).pix.mandate_options
    assert.equal(mandate.payment_schedule, 'monthly')
    assert.ok(mandate.amount >= 2 * regionalAmount('pro_monthly', 'br'))
    assert.ok(mandate.amount >= regionalAmount('color_pro', 'br'))

    const annual = pixSubscription('br', 'pro_annual')
    assert.equal((annual.payment_method_options as { pix: { mandate_options: { payment_schedule: string } } }).pix.mandate_options.payment_schedule, 'yearly')

    assert.deepEqual(pixSubscription('us', 'pro_monthly'), {})
    assert.deepEqual(pixSubscription('mx', 'pro_monthly'), {})

    env.PIX_SUBSCRIPTIONS = false
    try {
      assert.deepEqual(pixSubscription('br', 'pro_monthly'), {})
    } finally {
      env.PIX_SUBSCRIPTIONS = true
    }
  })

  it('grants her report for good and 7 days of Pro on the success page, once', async () => {
    const { app, userId, user, collection } = account()
    const session = {
      id: 'cs_color_pro',
      mode: 'subscription',
      payment_status: 'paid',
      subscription: 'sub_color_pro',
      invoice: 'in_color_pro',
      customer: 'cus_color_pro',
      amount_total: 2790,
      currency: 'brl',
      metadata: { app: 'avarobe', userId: userId.toString(), product: 'color_pro', placement: 'colors_offer' },
    } as unknown as Stripe.Checkout.Session

    await grantSession(app, session)
    await grantSession(app, session)

    assert.ok(user().colorReportAt)
    const pro = user().pro
    assert.equal(pro?.status, 'trialing')
    assert.equal(pro?.interval, 'month')
    assert.ok(pro?.trialEnd && Math.abs(pro.trialEnd.getTime() - (Date.now() + 7 * DAY)) < 60_000)
    assert.equal(user().proTrialColor, true)
    assert.equal(user().proTrialFree, false)
    assert.ok(user().proTrialAt)
    assert.deepEqual(purchasesOf(collection), [['color_pro', 2790, env.PRO_TRIAL_CREDITS]])
    assert.equal(billingState(user()).proActive, true)
    assert.equal(serializeBilling(user()).colorProDays, null)
  })

  it('grants the same from the first invoice when the webhook gets there first', async () => {
    const { app, userId, user, collection } = account()
    const invoice = {
      id: 'in_color_pro_hook',
      billing_reason: 'subscription_create',
      amount_paid: 890,
      currency: 'usd',
      customer: 'cus_hook',
      lines: { data: [] },
      parent: {
        subscription_details: {
          subscription: 'sub_hook',
          metadata: { app: 'avarobe', userId: userId.toString(), product: 'pro_monthly', trial: 'color_pro', placement: 'colors_sticky' },
        },
      },
    } as unknown as Stripe.Invoice

    await handleInvoicePaid(app, invoice)
    await handleInvoicePaid(app, invoice)

    assert.ok(user().colorReportAt)
    assert.equal(user().pro?.status, 'trialing')
    assert.equal(user().proTrialColor, true)
    assert.deepEqual(purchasesOf(collection), [['color_pro', 890, env.PRO_TRIAL_CREDITS]])
  })

  it('is refunded as Pro: the refund ends the trial it started', () => {
    assert.ok(PRO_PRODUCTS.has('color_pro'))
  })

  it('emails her that she paid for her report, hers to keep, and when Pro would charge', () => {
    const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: 'https://example.test/u', locale: 'en' as const, region: 'us' as const }
    const started = trialStartedEmail({ ...recipient, trialEnd: new Date('2026-10-30T15:00:00Z'), days: 7, color: true })

    assert.equal(started.subject, 'Your 7 days of Avarobe Pro start now')
    assert.match(started.html, /Today you paid \$\d+\.\d\d for your Color Advisor, which is yours to keep\. Pro came with it: cancel anytime before Friday, October 30/)
    assert.doesNotMatch(started.html, /Nothing was charged today/)
  })
})
