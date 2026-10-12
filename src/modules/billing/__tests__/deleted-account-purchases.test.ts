import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { memoryStorage, routeApp } from '../../../__tests__/color-reads.js'
import { fakeApp } from '../../../__tests__/fake-app.js'
import type { PurchaseDocument } from '../../../types/mongo.js'
import { deletedEmail, emailHash } from '../../../utils/deleted-accounts.js'
import meRoutes from '../../me/routes.js'
import { refundHistory } from '../refund-requests.js'
import { handleChargeRefunded, refundsReport } from '../refunds.js'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const ago = (ms: number) => new Date(Date.now() - ms)
const files = memoryStorage()

after(() => files.restore())

// The Oct 12, 2026 case: the three advisors for US$19.90, the account
// deleted a quarter of an hour later.
const bundle = (userId: ObjectId, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  userId,
  product: 'advisors_bundle',
  stripeSessionId: `cs_${Math.random()}`,
  stripePaymentIntentId: 'pi_bundle',
  amountTotal: 1990,
  currency: 'usd',
  amountUsd: 1990,
  credits: 0,
  createdAt: ago(15 * MINUTE),
  refundedAt: null,
  refund: null,
  colorRead: { season: 'Soft Autumn', readId: 'read_1' },
  placement: 'colors_sticky',
  terms: 'accepted',
  cardCountry: 'US',
  ...extra,
})

// A deleted account's row, as me/delete-account.ts leaves it.
const deletedUser = (userId: ObjectId, email = 'buyer@example.com') => ({
  _id: userId,
  email: deletedEmail(userId),
  emailHash: emailHash(email),
  firstName: '',
  createdAt: ago(DAY),
  deletedAt: ago(MINUTE),
})

describe('deleting an account', () => {
  it('keeps its purchases exactly as they were, marked', async () => {
    const userId = new ObjectId()
    const otherId = new ObjectId()
    const paid = bundle(userId)
    const refundedAt = ago(DAY)
    const oneTap = bundle(userId, {
      product: 'color_report',
      stripePaymentIntentId: 'pi_color',
      amountTotal: 499,
      amountUsd: 499,
      createdAt: ago(3 * DAY),
      refundedAt,
      refund: { source: 'app', reason: 'not_expected', note: 'In my own words', amount: 499, stripeRefundId: 're_color', flags: ['repeat'], priorRefunds: 1 },
    })
    const theirs = bundle(otherId)
    const { app, collection, auth } = await routeApp(
      { '/me': meRoutes },
      {
        users: [
          { _id: userId, email: 'buyer@example.com', firstName: 'Ana', createdAt: ago(DAY), colorReportAt: ago(15 * MINUTE) },
          { _id: otherId, email: 'other@example.com', firstName: 'Lia', createdAt: ago(DAY) },
        ],
        purchases: [paid, oneTap, theirs],
      },
    )

    const response = await app.inject({ method: 'DELETE', url: '/me', headers: auth(userId) })

    assert.equal(response.statusCode, 200)

    const purchases = collection('purchases').docs as unknown as PurchaseDocument[]
    const find = (id: ObjectId) => purchases.find((purchase) => purchase._id.equals(id))!
    const kept = find(paid._id)
    const { accountDeletedAt, ...rest } = kept

    assert.equal(purchases.length, 3)
    assert.ok(accountDeletedAt instanceof Date)
    assert.deepEqual(rest, paid)

    const tapped = find(oneTap._id)
    assert.ok(tapped.accountDeletedAt)
    assert.deepEqual(tapped.refund, oneTap.refund)
    assert.equal(tapped.refundedAt?.getTime(), refundedAt.getTime())

    // Someone else's purchase is left alone.
    assert.equal(find(theirs._id).accountDeletedAt, undefined)
  })
})

describe('a deleted account’s purchase', () => {
  it('is marked when it’s refunded in Stripe later', async () => {
    const userId = new ObjectId()
    const cancelled: string[] = []
    const { app, collection } = fakeApp({
      users: [deletedUser(userId)],
      purchases: [bundle(userId, { accountDeletedAt: ago(MINUTE) })],
    })

    await handleChargeRefunded(app, { payment_intent: 'pi_bundle', refunded: true, amount_refunded: 1990 }, async () => null, {
      cancelProNow: async (id) => {
        cancelled.push(id)
      },
    })

    const [purchase] = collection('purchases').docs as unknown as PurchaseDocument[]
    assert.ok(purchase?.refundedAt)
    assert.equal(purchase?.refund?.source, 'stripe')
    assert.equal(purchase?.refund?.amount, 1990)
    assert.ok(purchase?.accountDeletedAt)
    assert.deepEqual(cancelled, [])
  })

  it('shows in Admin → Refunds as from a deleted account, never with its alias', async () => {
    const goneId = new ObjectId()
    const oldId = new ObjectId()
    const liveId = new ObjectId()
    const refund = { source: 'stripe', reason: null, note: null, amount: 1990, stripeRefundId: null }
    const { app } = fakeApp({
      users: [deletedUser(goneId), { _id: liveId, email: 'live@example.com', createdAt: ago(DAY) }],
      purchases: [
        bundle(goneId, { accountDeletedAt: ago(MINUTE), refundedAt: ago(MINUTE), refund }),
        // An account deleted before its row was kept (before Oct 2026).
        bundle(oldId, { stripePaymentIntentId: 'pi_old', refundedAt: ago(MINUTE), refund }),
        bundle(liveId, { stripePaymentIntentId: 'pi_live', refundedAt: ago(MINUTE), refund }),
      ],
    })

    const report = await refundsReport(app, 7)
    const byUser = new Map(report.rows.map((row) => [row.userId, row]))

    assert.equal(report.refunds, 3)
    assert.equal(byUser.get(goneId.toString())?.accountDeleted, true)
    assert.equal(byUser.get(goneId.toString())?.email, null)
    assert.equal(byUser.get(oldId.toString())?.accountDeleted, true)
    assert.equal(byUser.get(liveId.toString())?.accountDeleted, false)
    assert.equal(byUser.get(liveId.toString())?.email, 'live@example.com')
  })

  it('counts in the refund history of the same person coming back with a new account', async () => {
    const goneId = new ObjectId()
    const newId = new ObjectId()
    const strangerId = new ObjectId()
    const refund = { source: 'app', reason: 'not_expected', note: null, amount: 1990, stripeRefundId: 're_1' }
    const { app } = fakeApp({
      users: [
        deletedUser(goneId, 'Buyer@Example.com'),
        deletedUser(strangerId, 'someone@example.com'),
        { _id: newId, email: 'buyer@example.com', firstName: 'Ana', createdAt: ago(MINUTE) },
      ],
      purchases: [
        bundle(goneId, { accountDeletedAt: ago(DAY), refundedAt: ago(2 * DAY), refund }),
        bundle(strangerId, { accountDeletedAt: ago(DAY), refundedAt: ago(2 * DAY), refund }),
        bundle(newId, { product: 'color_report', amountTotal: 499, amountUsd: 499 }),
      ],
    })

    const history = await refundHistory(app, { userId: newId, email: 'buyer@example.com', emailHash: emailHash('buyer@example.com'), fingerprint: null })

    assert.equal(history.refundsBefore, 1)
    assert.equal(history.purchases, 2)
    assert.equal(history.paidUsd, 1990 + 499)
  })
})
