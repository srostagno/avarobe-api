import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { memoryStorage, routeApp } from '../../../__tests__/color-reads.js'
import { fakeApp } from '../../../__tests__/fake-app.js'
import type { PurchaseDocument } from '../../../types/mongo.js'
import { deleteStaleGuests } from '../../auth/guests.js'
import meRoutes from '../../me/routes.js'
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

describe('deleting an account', () => {
  it('keeps its purchases for the books, without what was personal', async () => {
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
      refund: { source: 'app', reason: 'not_expected', note: 'In my own words, about me', amount: 499, stripeRefundId: 're_color', flags: ['repeat'], priorRefunds: 1 },
    })
    const approved = bundle(userId, {
      product: 'magazine',
      stripePaymentIntentId: 'pi_magazine',
      amountTotal: 990,
      amountUsd: 990,
      refundedAt,
      refund: { source: 'admin', requestId: new ObjectId(), reason: 'quality', note: 'Blurry pages, approved', amount: 990, stripeRefundId: 're_magazine', revokedAt: refundedAt },
    })
    const theirs = bundle(otherId)
    const { app, collection, auth } = await routeApp(
      { '/me': meRoutes },
      {
        users: [
          { _id: userId, email: 'buyer@example.com', firstName: 'Ana', createdAt: ago(DAY), colorReportAt: ago(15 * MINUTE) },
          { _id: otherId, email: 'other@example.com', firstName: 'Lia', createdAt: ago(DAY) },
        ],
        purchases: [paid, oneTap, approved, theirs],
      },
    )

    const response = await app.inject({ method: 'DELETE', url: '/me', headers: auth(userId) })

    assert.equal(response.statusCode, 200)
    assert.equal(collection('users').docs.some((user) => (user._id as ObjectId).equals(userId)), false)

    const purchases = collection('purchases').docs as unknown as PurchaseDocument[]
    const find = (id: ObjectId) => purchases.find((purchase) => purchase._id.equals(id))!
    const kept = find(paid._id)

    assert.equal(purchases.length, 4)
    // The sale, as it was.
    assert.ok(kept.userId.equals(userId))
    assert.equal(kept.product, 'advisors_bundle')
    assert.equal(kept.amountTotal, 1990)
    assert.equal(kept.currency, 'usd')
    assert.equal(kept.amountUsd, 1990)
    assert.equal(kept.createdAt.getTime(), paid.createdAt.getTime())
    assert.equal(kept.stripeSessionId, paid.stripeSessionId)
    assert.equal(kept.stripePaymentIntentId, 'pi_bundle')
    assert.equal(kept.placement, 'colors_sticky')
    assert.equal(kept.terms, 'accepted')
    assert.equal(kept.refundedAt, null)
    // Marked, and nothing personal left.
    assert.ok(kept.accountDeletedAt instanceof Date)
    assert.equal(kept.colorRead, null)
    assert.equal(kept.cardCountry, null)

    // Refunds stay, but what she wrote in a one-tap refund goes; an admin's
    // note stays, as on her refund requests.
    const tapped = find(oneTap._id)
    assert.equal(tapped.refundedAt?.getTime(), refundedAt.getTime())
    assert.deepEqual(
      tapped.refund,
      { source: 'app', reason: 'not_expected', note: null, amount: 499, stripeRefundId: 're_color', flags: ['repeat'], priorRefunds: 1 },
    )
    const decided = find(approved._id)
    assert.equal(decided.refund?.note, 'Blurry pages, approved')
    assert.equal(decided.refund?.stripeRefundId, 're_magazine')
    assert.ok(decided.accountDeletedAt)

    // Someone else's purchase is left alone.
    const other = find(theirs._id)
    assert.equal(other.accountDeletedAt, undefined)
    assert.deepEqual(other.colorRead, { season: 'Soft Autumn', readId: 'read_1' })
    assert.equal(other.cardCountry, 'US')
  })

  it('does the same for a guest deleted after its days, whose checkout’s email had an account', async () => {
    const guestId = new ObjectId()
    const { app, collection } = fakeApp({
      users: [{ _id: guestId, guest: true, email: 'x1@guest.avarobe.invalid', createdAt: ago(30 * DAY) }],
      purchases: [bundle(guestId)],
    })

    assert.equal(await deleteStaleGuests(app), 1)

    const [kept] = collection('purchases').docs as unknown as PurchaseDocument[]
    assert.equal(collection('users').docs.length, 0)
    assert.equal(kept?.amountTotal, 1990)
    assert.ok(kept?.accountDeletedAt)
    assert.equal(kept?.colorRead, null)
    assert.equal(kept?.cardCountry, null)
  })
})

describe('a deleted account’s purchase', () => {
  it('is marked when it’s refunded in Stripe later, with no account to take anything from', async () => {
    const userId = new ObjectId()
    const cancelled: string[] = []
    const { app, collection } = fakeApp({ purchases: [bundle(userId, { accountDeletedAt: ago(MINUTE), colorRead: null, cardCountry: null })] })

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
    assert.equal(collection('users').docs.length, 0)
  })

  it('shows in Admin → Refunds as from a deleted account', async () => {
    const goneId = new ObjectId()
    const liveId = new ObjectId()
    const refund = { source: 'stripe', reason: null, note: null, amount: 1990, stripeRefundId: null }
    const { app } = fakeApp({
      users: [{ _id: liveId, email: 'live@example.com', createdAt: ago(DAY) }],
      purchases: [
        bundle(goneId, { accountDeletedAt: ago(MINUTE), colorRead: null, cardCountry: null, refundedAt: ago(MINUTE), refund }),
        bundle(liveId, { stripePaymentIntentId: 'pi_live', refundedAt: ago(MINUTE), refund }),
      ],
    })

    const report = await refundsReport(app, 7)
    const byUser = new Map(report.rows.map((row) => [row.userId, row]))

    assert.equal(report.refunds, 2)
    assert.equal(report.purchases, 2)
    assert.equal(byUser.get(goneId.toString())?.accountDeleted, true)
    assert.equal(byUser.get(goneId.toString())?.email, null)
    assert.equal(byUser.get(liveId.toString())?.accountDeleted, false)
    assert.equal(byUser.get(liveId.toString())?.email, 'live@example.com')
  })
})
