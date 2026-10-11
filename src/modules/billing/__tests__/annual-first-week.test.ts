import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { annualFirstWeek } from '../entitlements.js'
import { handleInvoicePaid, refillAnnualCredits } from '../stripe.js'

const DAY = 24 * 60 * 60 * 1000

type Stored = { credits?: number; pro?: ProSubscription }

// An Avarobe Pro invoice as Stripe sends it to invoice.paid.
function invoice(userId: ObjectId, fields: { id: string; reason: string; product?: string; total?: number; placement?: string }) {
  return {
    id: fields.id,
    billing_reason: fields.reason,
    total: fields.total ?? 2999,
    amount_paid: fields.total ?? 2999,
    currency: 'usd',
    customer: 'cus_1',
    lines: { data: [{ period: { end: Math.floor((Date.now() + 365 * DAY) / 1000) } }] },
    parent: {
      subscription_details: {
        subscription: 'sub_1',
        metadata: { app: 'avarobe', userId: userId.toString(), product: fields.product ?? 'pro_annual', ...(fields.placement ? { placement: fields.placement } : {}) },
      },
    },
  } as unknown as Stripe.Invoice
}

function setup(credits = 1) {
  const userId = new ObjectId()
  const { app, collection } = fakeApp({ users: [{ _id: userId, email: 'customer@example.com', credits }] })
  const user = () => collection('users').docs[0] as Stored
  const purchases = () => collection('purchases').docs as { credits: number; placement?: string; product: string }[]

  return { app, userId, user, purchases, events: () => collection('analyticsEvents').docs as { name: string; props: Record<string, unknown> }[] }
}

describe('annual Pro’s first month', () => {
  const before = { first: env.PRO_ANNUAL_FIRST_WEEK_CREDITS, days: env.PRO_ANNUAL_FIRST_WEEK_DAYS, monthly: env.PRO_MONTHLY_CREDITS }

  beforeEach(() => {
    env.PRO_ANNUAL_FIRST_WEEK_CREDITS = 10
    env.PRO_ANNUAL_FIRST_WEEK_DAYS = 7
    env.PRO_MONTHLY_CREDITS = 30
  })

  afterEach(() => {
    Object.assign(env, {
      PRO_ANNUAL_FIRST_WEEK_CREDITS: before.first,
      PRO_ANNUAL_FIRST_WEEK_DAYS: before.days,
      PRO_MONTHLY_CREDITS: before.monthly,
    })
  })

  it('gives 10 looks with the first payment and holds the other 20 for a week, with the offer it came from', async () => {
    const { app, userId, user, purchases, events } = setup(1)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_1', reason: 'subscription_create', placement: 'purchase_success_pro_credit' }))

    assert.equal(user().credits, 11)
    assert.equal(user().pro?.heldCredits?.amount, 20)
    const days = ((user().pro?.heldCredits?.at.getTime() ?? 0) - Date.now()) / DAY
    assert.ok(days > 6.99 && days <= 7, String(days))
    assert.equal(user().pro?.avatarCap, true)
    // The purchase records what it gave, and where it was sold.
    assert.equal(purchases()[0]?.credits, 10)
    assert.equal(purchases()[0]?.placement, 'purchase_success_pro_credit')
    assert.equal(events().find((event) => event.name === 'purchase_completed')?.props.placement, 'purchase_success_pro_credit')
  })

  it('releases the 20 after the week, once, and only while Pro is live', async () => {
    const { app, userId, user } = setup(1)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_1', reason: 'subscription_create' }))
    const at = user().pro!.heldCredits!.at

    assert.equal(await refillAnnualCredits(app, new Date(at.getTime() - 60_000)), 0)
    assert.equal(user().credits, 11)
    assert.equal(await refillAnnualCredits(app, new Date(at.getTime() + 60_000)), 1)
    assert.equal(user().credits, 31)
    assert.equal(user().pro?.heldCredits, undefined)
    assert.equal(await refillAnnualCredits(app, new Date(at.getTime() + 120_000)), 0)
    assert.equal(user().credits, 31)

    // Refunded or cancelled within the week: dropped, no looks.
    const ended = setup(1)
    await handleInvoicePaid(ended.app, invoice(ended.userId, { id: 'in_2', reason: 'subscription_create' }))
    ended.user().pro!.status = 'canceled'
    await refillAnnualCredits(ended.app, new Date(Date.now() + 8 * DAY))
    assert.equal(ended.user().credits, 11)
    assert.equal(ended.user().pro?.heldCredits, undefined)
  })

  it('then adds the month’s 30 a month on, with a new month of avatar changes', async () => {
    const { app, userId, user } = setup(0)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_1', reason: 'subscription_create' }))
    user().pro!.avatarRuns = 20
    const next = user().pro!.nextCreditsAt!

    await refillAnnualCredits(app, new Date(next.getTime() + 60_000))
    assert.equal(user().credits, 60)
    assert.equal(user().pro?.avatarRuns, 0)
  })

  it('gives renewals and the switch from monthly the whole month at once', async () => {
    const renewal = setup(0)
    await handleInvoicePaid(renewal.app, invoice(renewal.userId, { id: 'in_r', reason: 'subscription_cycle' }))
    assert.equal(renewal.user().credits, 30)
    assert.equal(renewal.user().pro?.heldCredits, undefined)
    assert.equal(renewal.purchases()[0]?.placement, undefined)

    const switched = setup(5)
    await handleInvoicePaid(switched.app, invoice(switched.userId, { id: 'in_s', reason: 'subscription_update' }))
    assert.equal(switched.user().credits, 35)
    assert.equal(switched.user().pro?.heldCredits, undefined)
  })

  it('gives monthly plans their 30 at once, and holds nothing when the setting covers the month', async () => {
    const monthly = setup(0)
    await handleInvoicePaid(monthly.app, invoice(monthly.userId, { id: 'in_m', reason: 'subscription_create', product: 'pro_monthly', total: 799 }))
    assert.equal(monthly.user().credits, 30)
    assert.equal(monthly.user().pro?.heldCredits, undefined)

    env.PRO_ANNUAL_FIRST_WEEK_CREDITS = 30
    assert.equal(annualFirstWeek(), null)
    const whole = setup(0)
    await handleInvoicePaid(whole.app, invoice(whole.userId, { id: 'in_w', reason: 'subscription_create' }))
    assert.equal(whole.user().credits, 30)
  })

  it('starts the avatar changes over with every payment', async () => {
    const { app, userId, user } = setup(0)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_1', reason: 'subscription_create', product: 'pro_monthly', total: 799 }))
    user().pro!.avatarRuns = 20
    await handleInvoicePaid(app, invoice(userId, { id: 'in_2', reason: 'subscription_cycle', product: 'pro_monthly', total: 799 }))
    assert.equal(user().pro?.avatarRuns, undefined)
  })
})
