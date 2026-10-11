import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { fakeApp } from '../../../__tests__/fake-app.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { handleSubscriptionChange } from '../stripe.js'

const DAY = 24 * 60 * 60 * 1000

// customer.subscription.updated / deleted, as Stripe sends them.
function subscription(userId: ObjectId, id: string, status: string, endsInDays = 30) {
  return {
    id,
    status,
    customer: 'cus_1',
    cancel_at_period_end: false,
    trial_end: null,
    ended_at: status === 'canceled' ? Math.floor(Date.now() / 1000) : null,
    metadata: { app: 'avarobe', userId: userId.toString(), product: 'pro_annual' },
    items: { data: [{ current_period_end: Math.floor((Date.now() + endsInDays * DAY) / 1000), price: { recurring: { interval: 'year' } } }] },
  } as unknown as Stripe.Subscription
}

function setup(pro: Partial<ProSubscription> | null) {
  const userId = new ObjectId()
  const { app, collection } = fakeApp({ users: [{ _id: userId, email: 'customer@example.com', ...(pro ? { pro } : {}) }] })

  return { app, userId, pro: () => (collection('users').docs[0] as { pro?: ProSubscription }).pro }
}

describe('subscription events', () => {
  it('update the subscription they describe', async () => {
    const { app, userId, pro } = setup({ subscriptionId: 'sub_new', status: 'active', interval: 'year', periodEnd: new Date(Date.now() + 300 * DAY) })

    await handleSubscriptionChange(app, { ...subscription(userId, 'sub_new', 'active'), cancel_at_period_end: true })

    assert.equal(pro()?.cancelAtPeriodEnd, true)
    assert.equal(pro()?.status, 'active')
  })

  it('never let a late event about an older subscription end a newer live one (refunded, then bought again)', async () => {
    const { app, userId, pro } = setup({ subscriptionId: 'sub_new', status: 'active', interval: 'year', periodEnd: new Date(Date.now() + 300 * DAY) })

    await handleSubscriptionChange(app, subscription(userId, 'sub_old', 'canceled'))

    assert.equal(pro()?.subscriptionId, 'sub_new')
    assert.equal(pro()?.status, 'active')
  })

  it('still record a new subscription over an ended one, or a first one', async () => {
    const ended = setup({ subscriptionId: 'sub_old', status: 'canceled', interval: 'year', periodEnd: new Date(Date.now() - DAY) })
    await handleSubscriptionChange(ended.app, subscription(ended.userId, 'sub_new', 'active'))
    assert.equal(ended.pro()?.subscriptionId, 'sub_new')
    assert.equal(ended.pro()?.status, 'active')

    const first = setup(null)
    await handleSubscriptionChange(first.app, subscription(first.userId, 'sub_first', 'active'))
    assert.equal(first.pro()?.subscriptionId, 'sub_first')
  })
})
