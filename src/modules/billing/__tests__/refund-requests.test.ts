import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { RefundError, handleChargeRefunded, purchasesFor, refundGuideOrder, requestRefund, type RefundDeps } from '../refunds.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms)

// Stripe, as far as refunds go: what was refunded and cancelled.
function stripe() {
  const refunded: string[] = []
  const cancelled: string[] = []
  const deps: RefundDeps = {
    refundPayment: async (paymentIntentId) => {
      refunded.push(paymentIntentId)
      return `re_${paymentIntentId}`
    },
    refundInvoice: async (invoiceId) => {
      refunded.push(invoiceId)
      return { refundId: `re_${invoiceId}`, paymentIntentId: `pi_of_${invoiceId}` }
    },
    cancelProNow: async (subscriptionId) => {
      cancelled.push(subscriptionId)
    },
  }

  return { deps, refunded, cancelled }
}

function buyer(user: Record<string, unknown>, purchases: Record<string, unknown>[], guideOrders: Record<string, unknown>[] = []) {
  const userId = new ObjectId()
  const { app, collection } = fakeApp({
    users: [{ _id: userId, email: 'customer@example.com', ...user }],
    purchases: purchases.map((purchase) => ({
      _id: new ObjectId(),
      userId,
      stripeSessionId: `cs_${Math.random()}`,
      stripePaymentIntentId: `pi_${Math.random()}`,
      amountTotal: 499,
      currency: 'usd',
      credits: 0,
      createdAt: ago(DAY),
      refundedAt: null,
      ...purchase,
    })),
    guideOrders: guideOrders.map((order) => ({ _id: new ObjectId(), userId, ...order })),
  })
  const doc = () => collection('users').docs[0] as Record<string, unknown> & { pro?: ProSubscription; credits?: number }
  const bought = () => collection('purchases').docs as Record<string, unknown>[]

  return { app, userId, user: doc, purchases: bought, guide: () => collection('guideOrders').docs as Record<string, unknown>[] }
}

const ask = (userId: ObjectId, purchaseId: unknown) => ({ userId, purchaseId: purchaseId as ObjectId, reason: 'not_expected' as const, note: null })

describe('asking for a refund in the app', () => {
  it('refunds as often as they ask, flagging repeats for review instead of refusing them', async () => {
    const { deps, refunded } = stripe()
    const { app, userId, purchases } = buyer({ colorReportAt: ago(DAY), hairAdvisorAt: ago(HOUR) }, [
      { product: 'color_report', stripePaymentIntentId: 'pi_color' },
      { product: 'hair_advisor', stripePaymentIntentId: 'pi_hair', amountTotal: 790, createdAt: ago(HOUR) },
    ])

    await requestRefund(app, ask(userId, purchases()[0]!._id), deps)
    await requestRefund(app, ask(userId, purchases()[1]!._id), deps)

    assert.deepEqual(refunded, ['pi_color', 'pi_hair'])
    const [first, second] = purchases() as { refund: { flags: string[]; priorRefunds: number; stripeRefundId: string } }[]
    assert.deepEqual(first?.refund.flags, [])
    assert.deepEqual(second?.refund.flags, ['repeat'])
    assert.equal(second?.refund.priorRefunds, 1)
    assert.equal(second?.refund.stripeRefundId, 're_pi_hair')
    // Not twice.
    await assert.rejects(requestRefund(app, ask(userId, purchases()[0]!._id), deps), RefundError)
  })

  it('takes back a look pack’s looks that are left', async () => {
    const { deps } = stripe()
    const { app, userId, user, purchases } = buyer({ credits: 4 }, [{ product: 'look_pack', credits: 10 }])

    await requestRefund(app, ask(userId, purchases()[0]!._id), deps)

    assert.equal(user().credits, 0)
  })

  it('flags a report whose credit paid part of a Pro annual they keep', async () => {
    const { deps } = stripe()
    const { app, userId, purchases } = buyer({ colorReportAt: ago(3 * DAY) }, [
      { product: 'color_report', createdAt: ago(3 * DAY) },
      { product: 'pro_annual', amountTotal: 2500, createdAt: ago(2 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_annual' },
    ])

    await requestRefund(app, ask(userId, purchases()[0]!._id), deps)

    assert.deepEqual((purchases()[0] as { refund: { flags: string[] } }).refund.flags, ['credit_used'])
  })

  it('ends Pro at once on its first payment, by its invoice, with the looks and held looks it gave', async () => {
    const { deps, refunded, cancelled } = stripe()
    const pro: ProSubscription = {
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      interval: 'year',
      periodEnd: new Date(Date.now() + 360 * DAY),
      cancelAtPeriodEnd: false,
      heldCredits: { amount: 20, at: new Date(Date.now() + 5 * DAY) },
    }
    const { app, userId, user, purchases } = buyer({ credits: 7, pro, colorReportAt: ago(2 * DAY), styleReportAt: ago(2 * DAY), hairAdvisorAt: ago(2 * DAY) }, [
      { product: 'color_report', createdAt: ago(10 * DAY) },
      { product: 'pro_annual', amountTotal: 2999, credits: 10, createdAt: ago(2 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_annual' },
    ])

    await requestRefund(app, ask(userId, purchases()[1]!._id), deps)

    assert.deepEqual(refunded, ['in_annual'])
    assert.deepEqual(cancelled, ['sub_1'])
    assert.equal(user().pro?.status, 'canceled')
    assert.equal(user().pro?.heldCredits, undefined)
    assert.equal(user().credits, 0)
    // The Color Advisor bought on its own stays; what only annual gave goes.
    assert.ok(user().colorReportAt)
    assert.equal(user().styleReportAt, undefined)
    assert.equal(user().hairAdvisorAt, undefined)
    // The payment is noted for Stripe's own refund event.
    assert.equal(purchases()[1]?.stripePaymentIntentId, 'pi_of_in_annual')
    // Pro is what a credit paid for, not a report whose credit was used.
    assert.deepEqual((purchases()[1] as { refund: { flags: string[] } }).refund.flags, [])
  })

  it('shows the refund on Pro’s first week only, never on a renewal', async () => {
    const { app, userId } = buyer({}, [
      { product: 'pro_monthly', amountTotal: 799, createdAt: ago(32 * DAY) },
      { product: 'pro_monthly', amountTotal: 799, createdAt: ago(2 * DAY) },
      { product: 'magazine', amountTotal: 990, createdAt: ago(2 * DAY) },
    ])
    const listed = await purchasesFor(app, userId)
    const refundable = listed.filter((item) => item.refundableUntil).map((item) => item.product)

    assert.equal(listed.length, 3)
    assert.deepEqual(refundable, ['magazine'])
  })

  it('keeps the purchase as it was when Stripe refuses', async () => {
    const { deps } = stripe()
    const failing = { ...deps, refundPayment: async () => Promise.reject(new Error('Stripe is down')) }
    const { app, userId, purchases } = buyer({ colorReportAt: ago(DAY) }, [{ product: 'color_report' }])

    await assert.rejects(requestRefund(app, ask(userId, purchases()[0]!._id), failing), /Stripe is down/)
    assert.equal(purchases()[0]?.refundedAt, null)
  })
})

describe('refunds made in Stripe', () => {
  it('find a Pro payment by its invoice, and a guest’s book by its payment', async () => {
    const { app, purchases, guide } = buyer(
      { credits: 30 },
      [{ product: 'pro_monthly', amountTotal: 799, credits: 30, stripePaymentIntentId: null, stripeSessionId: 'in_pro' }],
      [{ sessionId: 'cs_book', token: 'tok', amount: 1490, currency: 'usd', paymentIntentId: 'pi_book', createdAt: ago(DAY), refundedAt: null }],
    )

    await handleChargeRefunded(app, { payment_intent: 'pi_pro', refunded: true, amount_refunded: 799 }, async (paymentIntentId) =>
      paymentIntentId === 'pi_pro' ? 'in_pro' : null,
    )
    await handleChargeRefunded(app, { payment_intent: 'pi_book', refunded: true, amount_refunded: 1490 }, async () => null)

    assert.ok(purchases()[0]?.refundedAt)
    assert.equal(purchases()[0]?.stripePaymentIntentId, 'pi_pro')
    assert.ok(guide()[0]?.refundedAt)
  })
})

describe('a guest’s book, refunded from its link', () => {
  it('refunds once within 7 days, and the signed-in purchase with it', async () => {
    const refunded: string[] = []
    const deps = {
      refundPayment: async (paymentIntentId: string) => {
        refunded.push(paymentIntentId)
        return 're_book'
      },
      paymentOf: async () => 'pi_from_session',
    }
    const { app, purchases, guide } = buyer(
      {},
      [{ product: 'outfit_guide', amountTotal: 1490, stripeSessionId: 'cs_book', stripePaymentIntentId: 'pi_book' }],
      [
        { sessionId: 'cs_book', token: 'tok_new', amount: 1490, currency: 'usd', paymentIntentId: 'pi_book', createdAt: ago(DAY), refundedAt: null },
        { sessionId: 'cs_old', token: 'tok_old', amount: 1490, currency: 'usd', createdAt: ago(8 * DAY), refundedAt: null },
        { sessionId: 'cs_before', token: 'tok_before', amount: 1490, currency: 'usd', createdAt: ago(2 * DAY) },
      ],
    )

    assert.deepEqual(await refundGuideOrder(app, { token: 'tok_new', reason: 'mistake' }, deps), { amount: 1490, currency: 'usd' })
    assert.ok(guide()[0]?.refundedAt)
    assert.ok(purchases()[0]?.refundedAt)
    await assert.rejects(refundGuideOrder(app, { token: 'tok_new', reason: null }, deps), RefundError)
    await assert.rejects(refundGuideOrder(app, { token: 'tok_old', reason: null }, deps), RefundError)
    // An order from before orders kept their payment: its checkout's.
    await refundGuideOrder(app, { token: 'tok_before', reason: null }, deps)
    assert.deepEqual(refunded, ['pi_book', 'pi_from_session'])
  })
})
