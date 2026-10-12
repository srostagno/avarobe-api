import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { PurchaseDocument, UserDocument } from '../../../types/mongo.js'
import { brazilWithdrawalUntil, guideRefundableUntil, refundableUntil, revokePurchase } from '../refunds.js'

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

describe('the 7 days to request a refund', () => {
  it('covers every purchase for 7 days after paying', () => {
    for (const product of ['color_report', 'advisors_bundle', 'look_pack', 'outfit_guide', 'event_pass', 'magazine', 'pro_monthly', 'pro_annual', 'pro_trial'] as const) {
      assert.ok(refundableUntil(purchase({ product, createdAt: new Date(now - 6 * DAY) }), {}, now), product)
      assert.equal(refundableUntil(purchase({ product, createdAt: new Date(now - 8 * DAY) }), {}, now), null, product)
    }
  })

  it('leaves out free purchases, ones already refunded and ones with no payment to give back', () => {
    assert.equal(refundableUntil(purchase({ amountTotal: 0 }), {}, now), null)
    assert.equal(refundableUntil(purchase({ refundedAt: new Date(now) }), {}, now), null)
    assert.equal(refundableUntil(purchase({ stripePaymentIntentId: null }), {}, now), null)
    // Pro payments from before purchases kept the payment go back through their invoice.
    assert.ok(refundableUntil(purchase({ product: 'pro_annual', stripePaymentIntentId: null, stripeSessionId: 'in_123' }), {}, now))
    assert.equal(refundableUntil(purchase({ product: 'pro_annual', stripePaymentIntentId: null, stripeSessionId: 'cs_123' }), {}, now), null)
  })

  it('covers Pro only in the first week of their first Pro, never a renewal', () => {
    const firstProAt = new Date(now - 40 * DAY)
    // The monthly renewal from 2 days ago is past the first week.
    assert.equal(refundableUntil(purchase({ product: 'pro_monthly', createdAt: new Date(now - 2 * DAY) }), { firstProAt }, now), null)
    // A switch to annual 3 days into the first week of Pro.
    const first = new Date(now - 5 * DAY)
    assert.ok(refundableUntil(purchase({ product: 'pro_annual', createdAt: new Date(now - 2 * DAY) }), { firstProAt: first }, now))
  })

  it('in Brazil, count calendar days: the purchase day is left out, to midnight in São Paulo', () => {
    // Monday Oct 5 at 09:00 in São Paulo.
    const paidAt = new Date('2026-10-05T12:00:00Z')

    assert.equal(brazilWithdrawalUntil(paidAt).toISOString(), '2026-10-13T02:59:59.999Z')
    // Monday Oct 12 at 22:00 in São Paulo: past 7 × 24 h, within Brazil's 7 days.
    const evening = Date.parse('2026-10-13T01:00:00Z')
    assert.equal(refundableUntil(purchase({ createdAt: paidAt }), {}, evening), null)
    assert.ok(refundableUntil(purchase({ createdAt: paidAt }), { brazil: true }, evening))
    assert.equal(refundableUntil(purchase({ createdAt: paidAt }), { brazil: true }, Date.parse('2026-10-13T03:00:00Z')), null)
    // A purchase just after midnight there still gets its whole 7th day.
    assert.equal(brazilWithdrawalUntil(new Date('2026-10-05T03:05:00Z')).toISOString(), '2026-10-13T02:59:59.999Z')
  })

  it('give the book the same days, from its link', () => {
    const order = { amount: 1490, createdAt: new Date('2026-10-05T12:00:00Z'), refundedAt: null }
    const evening = Date.parse('2026-10-13T01:00:00Z')

    assert.equal(guideRefundableUntil(order, evening), null)
    assert.ok(guideRefundableUntil(order, evening, true))
    assert.equal(guideRefundableUntil({ ...order, refundedAt: new Date() }, evening, true), null)
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
