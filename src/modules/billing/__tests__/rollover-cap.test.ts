import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { rolloverCredits } from '../entitlements.js'
import { addMonths, grantSession, handleInvoicePaid, refillAnnualCredits } from '../stripe.js'

const DAY = 24 * 60 * 60 * 1000

type Stored = { credits?: number; pro?: ProSubscription }
type Purchase = { credits: number; creditsOverCap?: number; product: string }

// An Avarobe Pro invoice as Stripe sends it to invoice.paid.
function invoice(userId: ObjectId, fields: { id: string; reason: string; product?: string }) {
  return {
    id: fields.id,
    billing_reason: fields.reason,
    total: 2999,
    amount_paid: 2999,
    currency: 'usd',
    customer: 'cus_1',
    lines: { data: [{ period: { end: Math.floor((Date.now() + 365 * DAY) / 1000) } }] },
    parent: {
      subscription_details: {
        subscription: 'sub_1',
        metadata: { app: 'avarobe', userId: userId.toString(), product: fields.product ?? 'pro_monthly' },
      },
    },
  } as unknown as Stripe.Invoice
}

function setup(credits: number | undefined, pro?: Partial<ProSubscription>) {
  const userId = new ObjectId()
  const { app, collection, logs } = fakeApp({
    users: [{ _id: userId, email: 'customer@example.com', ...(credits === undefined ? {} : { credits }), ...(pro ? { pro } : {}) }],
  })

  return {
    app,
    userId,
    logs,
    user: () => collection('users').docs[0] as Stored,
    purchases: () => collection('purchases').docs as Purchase[],
  }
}

// A live annual plan whose next monthly drop is due.
function annual(next: Date): Partial<ProSubscription> {
  return {
    subscriptionId: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    interval: 'year',
    periodEnd: new Date(next.getTime() + 200 * DAY),
    cancelAtPeriodEnd: false,
    nextCreditsAt: next,
    avatarRuns: 12,
    avatarCap: true,
  }
}

describe('unused looks roll over up to 60', () => {
  const before = { cap: env.PRO_ROLLOVER_CAP, monthly: env.PRO_MONTHLY_CREDITS, first: env.PRO_ANNUAL_FIRST_WEEK_CREDITS, pack: env.LOOK_PACK_CREDITS }

  beforeEach(() => {
    env.PRO_ROLLOVER_CAP = 60
    env.PRO_MONTHLY_CREDITS = 30
    env.PRO_ANNUAL_FIRST_WEEK_CREDITS = 10
    env.LOOK_PACK_CREDITS = 10
  })

  afterEach(() => {
    Object.assign(env, {
      PRO_ROLLOVER_CAP: before.cap,
      PRO_MONTHLY_CREDITS: before.monthly,
      PRO_ANNUAL_FIRST_WEEK_CREDITS: before.first,
      LOOK_PACK_CREDITS: before.pack,
    })
  })

  it('adds only what fits under the cap, and never takes any away', () => {
    assert.equal(rolloverCredits(0, 30), 30)
    assert.equal(rolloverCredits(30, 30), 30)
    assert.equal(rolloverCredits(45, 30), 15)
    assert.equal(rolloverCredits(60, 30), 0)
    assert.equal(rolloverCredits(75, 30), 0)
    assert.equal(rolloverCredits(50, 30, 40), 0)
  })

  it('gives a renewal its whole month while she has room, and stops at 60', async () => {
    const roomy = setup(10)
    await handleInvoicePaid(roomy.app, invoice(roomy.userId, { id: 'in_1', reason: 'subscription_cycle' }))
    assert.equal(roomy.user().credits, 40)
    assert.equal(roomy.purchases()[0]?.credits, 30)
    assert.equal(roomy.purchases()[0]?.creditsOverCap, undefined)

    const near = setup(45)
    await handleInvoicePaid(near.app, invoice(near.userId, { id: 'in_2', reason: 'subscription_cycle' }))
    assert.equal(near.user().credits, 60)
    // The purchase records what it added (a refund takes back no more).
    assert.equal(near.purchases()[0]?.credits, 15)
    assert.equal(near.purchases()[0]?.creditsOverCap, 15)
    // Pro is renewed all the same.
    assert.equal(near.user().pro?.status, 'active')
  })

  it('keeps a balance already above 60 as it is', async () => {
    const { app, userId, user, purchases } = setup(75)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_1', reason: 'subscription_cycle' }))
    assert.equal(user().credits, 75)
    assert.equal(purchases()[0]?.credits, 0)
    assert.equal(purchases()[0]?.creditsOverCap, 30)
  })

  it('caps the switch from monthly to annual like a renewal', async () => {
    const { app, userId, user } = setup(50)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_s', reason: 'subscription_update', product: 'pro_annual' }))
    assert.equal(user().credits, 60)
    assert.equal(user().pro?.interval, 'year')
  })

  it('gives a first payment, and the rest of annual’s first month, in full', async () => {
    // Look packs she bought before: nothing has rolled over yet.
    const monthly = setup(55)
    await handleInvoicePaid(monthly.app, invoice(monthly.userId, { id: 'in_m', reason: 'subscription_create' }))
    assert.equal(monthly.user().credits, 85)
    assert.equal(monthly.purchases()[0]?.credits, 30)

    const yearly = setup(55)
    await handleInvoicePaid(yearly.app, invoice(yearly.userId, { id: 'in_a', reason: 'subscription_create', product: 'pro_annual' }))
    assert.equal(yearly.user().credits, 65)
    const at = yearly.user().pro!.heldCredits!.at
    await refillAnnualCredits(yearly.app, new Date(at.getTime() + 60_000))
    assert.equal(yearly.user().credits, 85)
    assert.equal(yearly.purchases()[0]?.credits, 30)
  })

  it('stops annual’s monthly drops at 60, still starting the month over', async () => {
    const next = new Date(Date.now() - 60_000)

    const near = setup(40, annual(next))
    assert.equal(await refillAnnualCredits(near.app), 1)
    assert.equal(near.user().credits, 60)
    assert.equal(near.user().pro?.avatarRuns, 0)
    assert.equal(near.user().pro?.nextCreditsAt?.getTime(), addMonths(next, 1).getTime())
    assert.ok(near.logs.some((line) => line.msg === 'Annual Pro looks held at the rollover cap'))

    const over = setup(70, annual(next))
    assert.equal(await refillAnnualCredits(over.app), 1)
    assert.equal(over.user().credits, 70)
    assert.equal(over.user().pro?.avatarRuns, 0)
    // Once a month: a second run adds nothing.
    assert.equal(await refillAnnualCredits(over.app), 0)

    const roomy = setup(5, annual(next))
    await refillAnnualCredits(roomy.app)
    assert.equal(roomy.user().credits, 35)
    assert.ok(!roomy.logs.some((line) => line.msg === 'Annual Pro looks held at the rollover cap'))

    // A balance never stored counts as FREE_CREDITS, as everywhere.
    const unset = setup(undefined, annual(next))
    await refillAnnualCredits(unset.app)
    assert.equal(unset.user().credits, Math.min(60, env.FREE_CREDITS + 30))
  })

  it('follows the setting', async () => {
    env.PRO_ROLLOVER_CAP = 40
    const { app, userId, user } = setup(25)

    await handleInvoicePaid(app, invoice(userId, { id: 'in_1', reason: 'subscription_cycle' }))
    assert.equal(user().credits, 40)
  })

  it('never caps a look pack', async () => {
    const { app, userId, user, purchases } = setup(70)
    const session = {
      id: 'cs_test_pack',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 499,
      currency: 'usd',
      payment_intent: 'pi_1',
      metadata: { app: 'avarobe', userId: userId.toString(), product: 'look_pack' },
    } as unknown as Stripe.Checkout.Session

    await grantSession(app, session)
    assert.equal(user().credits, 80)
    assert.equal(purchases()[0]?.credits, 10)
    assert.equal(purchases()[0]?.creditsOverCap, undefined)
  })
})
