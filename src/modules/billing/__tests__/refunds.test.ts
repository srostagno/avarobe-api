import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { PurchaseDocument, UserDocument } from '../../../types/mongo.js'
import { refundableUntil, revokePurchase } from '../refunds.js'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-10-08T12:00:00Z')

function purchase(fields: Partial<PurchaseDocument>): PurchaseDocument {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    product: 'color_report',
    stripeSessionId: `cs_${Math.random()}`,
    stripePaymentIntentId: 'pi_123',
    amountTotal: 499,
    currency: 'usd',
    credits: 0,
    createdAt: new Date(now - DAY),
    ...fields,
  }
}

// Just enough of the app for revokePurchase: one user, their purchases, and
// the update it makes.
function fakeApp(user: Partial<UserDocument>, purchases: PurchaseDocument[]) {
  const updates: Record<string, unknown>[] = []
  const app = {
    collections: {
      users: {
        findOne: async () => user,
        updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
          updates.push(update)
          return { modifiedCount: 1 }
        },
      },
      purchases: {
        find: (filter: { _id: { $ne: ObjectId } }) => ({
          toArray: async () => purchases.filter((item) => !item._id.equals(filter._id.$ne) && !item.refundedAt),
        }),
      },
    },
  } as unknown as FastifyInstance

  return { app, updates }
}

describe('the 7-day money-back guarantee', () => {
  it('covers a one-time advisor for 7 days after paying', () => {
    assert.ok(refundableUntil(purchase({ createdAt: new Date(now - 6 * DAY) }), now))
    assert.equal(refundableUntil(purchase({ createdAt: new Date(now - 8 * DAY) }), now), null)
  })

  it('leaves out Pro, look packs, free purchases and ones already refunded', () => {
    assert.equal(refundableUntil(purchase({ product: 'pro_monthly' }), now), null)
    assert.equal(refundableUntil(purchase({ product: 'look_pack' }), now), null)
    assert.equal(refundableUntil(purchase({ amountTotal: 0 }), now), null)
    assert.equal(refundableUntil(purchase({ refundedAt: new Date(now) }), now), null)
    assert.equal(refundableUntil(purchase({ stripePaymentIntentId: null }), now), null)
  })

  it('takes the Color Advisor back, and the paid mark when nothing else was bought', async () => {
    const refunded = purchase({})
    const { app, updates } = fakeApp({ colorReportAt: new Date(), paidAt: new Date() }, [refunded])

    await revokePurchase(app, refunded)

    assert.deepEqual(Object.keys(updates[0]?.$unset ?? {}).sort(), ['colorReportAt', 'paidAt'])
  })

  it('keeps colors unlocked by another purchase that stays (the bundle)', async () => {
    const userId = new ObjectId()
    const refunded = purchase({ userId, product: 'color_report' })
    const bundle = purchase({ userId, product: 'advisors_bundle', amountTotal: 1990 })
    const { app, updates } = fakeApp({ colorReportAt: new Date(), paidAt: new Date() }, [refunded, bundle])

    await revokePurchase(app, refunded)

    assert.equal(updates[0]?.$unset, undefined)
  })

  it('takes back an unused event pass without going below zero', async () => {
    const refunded = purchase({ product: 'event_pass', amountTotal: 490 })
    const { app, updates } = fakeApp({ eventCredits: 0, paidAt: new Date() }, [refunded])

    await revokePurchase(app, refunded)

    assert.equal((updates[0]?.$set as Partial<UserDocument>).eventCredits, 0)
  })
})
