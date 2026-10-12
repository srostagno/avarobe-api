import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import type { ProSubscription, PurchaseDocument, RefundCover } from '../../../types/mongo.js'
import { creditUsed, handleChargeRefunded, refundCovers, refundGuideCover, type RefundDeps } from '../refunds.js'

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
    paymentOf: async () => 'pi_from_session',
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
  const bought = () => collection('purchases').docs as unknown as PurchaseDocument[]

  return { app, userId, user: doc, purchases: bought, guide: () => collection('guideOrders').docs as Record<string, unknown>[] }
}

const cover = (purchase: PurchaseDocument): RefundCover => ({
  purchaseId: purchase._id,
  guideOrderId: null,
  product: purchase.product as RefundCover['product'],
  amount: purchase.amountTotal,
  currency: purchase.currency,
  paidAt: purchase.createdAt,
  stripePaymentIntentId: purchase.stripePaymentIntentId,
  stripeInvoiceId: purchase.stripeSessionId.startsWith('in_') ? purchase.stripeSessionId : null,
})

const approve = (userId: ObjectId | null, covers: RefundCover[]) => ({
  userId,
  covers,
  reason: 'not_expected' as const,
  note: null,
  requestId: new ObjectId(),
  flags: [],
  attempt: 'a1',
})

describe('an approved refund, paid back', () => {
  it('refunds each payment once, marks it as the admin’s, and flags earlier refunds of any kind', async () => {
    const { deps, refunded } = stripe()
    const { app, userId, purchases } = buyer({ colorReportAt: ago(DAY), hairAdvisorAt: ago(HOUR) }, [
      { product: 'color_report', stripePaymentIntentId: 'pi_color' },
      { product: 'hair_advisor', stripePaymentIntentId: 'pi_hair', amountTotal: 790, createdAt: ago(HOUR) },
      // Refunded in Stripe's dashboard before: counts too.
      { product: 'magazine', stripePaymentIntentId: 'pi_mag', refundedAt: ago(DAY), refund: { source: 'stripe' } },
    ])
    const first = approve(userId, [cover(purchases()[0]!)])

    const result = await refundCovers(app, first, deps)
    await refundCovers(app, approve(userId, [cover(purchases()[1]!)]), deps)

    assert.deepEqual(refunded, ['pi_color', 'pi_hair'])
    assert.equal(result.refunded[0]?.stripeRefundId, 're_pi_color')
    const [color, hair] = purchases()
    assert.equal(color?.refund?.source, 'admin')
    assert.ok(color?.refund?.requestId?.equals(first.requestId))
    assert.deepEqual(color?.refund?.flags, ['repeat'])
    assert.equal(color?.refund?.priorRefunds, 1)
    assert.equal(hair?.refund?.priorRefunds, 2)
    // Not twice: a second approval of the same payment does nothing.
    const again = await refundCovers(app, approve(userId, [cover(purchases()[0]!)]), deps)
    assert.equal(again.skipped.length, 1)
    assert.deepEqual(refunded, ['pi_color', 'pi_hair'])
  })

  it('takes back a look pack’s looks that are left', async () => {
    const { deps } = stripe()
    const { app, userId, user, purchases } = buyer({ credits: 4 }, [{ product: 'look_pack', credits: 10 }])

    await refundCovers(app, approve(userId, [cover(purchases()[0]!)]), deps)

    assert.equal(user().credits, 0)
  })

  it('knows a report whose credit paid part of a Pro annual they keep', async () => {
    const { app, purchases } = buyer({ colorReportAt: ago(3 * DAY) }, [
      { product: 'color_report', createdAt: ago(3 * DAY) },
      { product: 'pro_annual', amountTotal: 2500, createdAt: ago(2 * DAY), stripePaymentIntentId: null, stripeSessionId: 'in_annual' },
    ])

    assert.equal(await creditUsed(app, purchases()[0]!), true)
    // Pro is what the credit paid for, not a report whose credit was used.
    assert.equal(await creditUsed(app, purchases()[1]!), false)
  })

  it('ends Pro at once with its first week, by its invoice, with the looks and held looks it gave', async () => {
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

    await refundCovers(app, approve(userId, [cover(purchases()[1]!)]), deps)

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
  })

  it('works on any day: the request was made within the 7 days', async () => {
    const { deps, refunded } = stripe()
    const { app, userId, purchases } = buyer({ colorReportAt: ago(9 * DAY) }, [{ product: 'color_report', createdAt: ago(9 * DAY), stripePaymentIntentId: 'pi_late' }])

    await refundCovers(app, approve(userId, [cover(purchases()[0]!)]), deps)

    assert.deepEqual(refunded, ['pi_late'])
  })

  it('keeps the purchase as it was when Stripe refuses, and counts one refunded in Stripe already', async () => {
    const { deps } = stripe()
    const failing = { ...deps, refundPayment: async () => Promise.reject(new Error('Stripe is down')) }
    const { app, userId, user, purchases } = buyer({ colorReportAt: ago(DAY) }, [{ product: 'color_report' }])

    const failed = await refundCovers(app, approve(userId, [cover(purchases()[0]!)]), failing)

    assert.equal(failed.failed[0]?.error, 'Stripe is down')
    assert.equal(purchases()[0]?.refundedAt, null)
    assert.ok(user().colorReportAt)

    const done = { ...deps, refundPayment: async () => Promise.reject(Object.assign(new Error('Charge already refunded.'), { code: 'charge_already_refunded' })) }
    const reconciled = await refundCovers(app, approve(userId, [cover(purchases()[0]!)]), done)

    assert.equal(reconciled.refunded[0]?.inStripe, true)
    assert.ok(purchases()[0]?.refundedAt)
    assert.equal(user().colorReportAt, undefined)
  })

  it('refunds a deleted account’s payment by what the request kept', async () => {
    const { deps, refunded } = stripe()
    const { app } = buyer({}, [])
    const gone: RefundCover = {
      purchaseId: new ObjectId(),
      guideOrderId: null,
      product: 'pro_monthly',
      amount: 799,
      currency: 'usd',
      paidAt: ago(2 * DAY),
      stripePaymentIntentId: null,
      stripeInvoiceId: 'in_gone',
    }

    const result = await refundCovers(app, approve(new ObjectId(), [gone]), deps)

    assert.deepEqual(refunded, ['in_gone'])
    assert.equal(result.refunded.length, 1)
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

describe('Pro refunded in Stripe’s dashboard', () => {
  const live = (fields: Partial<ProSubscription> = {}): ProSubscription => ({
    subscriptionId: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    interval: 'year',
    periodEnd: new Date(Date.now() + 360 * DAY),
    cancelAtPeriodEnd: false,
    ...fields,
  })

  it('ends Pro when its latest payment is refunded, with its held looks', async () => {
    const { deps, cancelled } = stripe()
    const { app, user, purchases } = buyer({ credits: 10, pro: live({ heldCredits: { amount: 20, at: new Date(Date.now() + 5 * DAY) } }) }, [
      { product: 'pro_annual', amountTotal: 2999, credits: 10, stripePaymentIntentId: 'pi_annual', createdAt: ago(2 * DAY) },
    ])

    await handleChargeRefunded(app, { payment_intent: 'pi_annual', refunded: true, amount_refunded: 2999 }, async () => null, deps)

    assert.ok(purchases()[0]?.refundedAt)
    assert.deepEqual(cancelled, ['sub_1'])
    assert.equal(user().pro?.status, 'canceled')
    assert.equal(user().pro?.heldCredits, undefined)
    assert.equal(user().credits, 0)
  })

  it('leaves the paid period alone when an older payment is refunded', async () => {
    const { deps, cancelled } = stripe()
    const { app, user, purchases } = buyer({ credits: 30, pro: live({ interval: 'month', periodEnd: new Date(Date.now() + 20 * DAY) }) }, [
      { product: 'pro_monthly', amountTotal: 799, credits: 30, stripePaymentIntentId: 'pi_old', createdAt: ago(40 * DAY) },
      { product: 'pro_monthly', amountTotal: 799, credits: 30, stripePaymentIntentId: 'pi_now', createdAt: ago(10 * DAY) },
    ])

    await handleChargeRefunded(app, { payment_intent: 'pi_old', refunded: true, amount_refunded: 799 }, async () => null, deps)

    assert.ok(purchases()[0]?.refundedAt)
    assert.deepEqual(cancelled, [])
    assert.equal(user().pro?.status, 'active')
  })
})

describe('a guest’s book, refunded after an approved request', () => {
  it('refunds once by its payment (or its checkout’s), marks the signed-in purchase, and the link stops', async () => {
    const { deps, refunded } = stripe()
    const { app, purchases, guide } = buyer(
      {},
      [{ product: 'outfit_guide', amountTotal: 1490, stripeSessionId: 'cs_book', stripePaymentIntentId: 'pi_book' }],
      [
        { sessionId: 'cs_book', token: 'tok_new', refundToken: 'ref_new', amount: 1490, currency: 'usd', paymentIntentId: 'pi_book', createdAt: ago(DAY), refundedAt: null },
        { sessionId: 'cs_before', token: 'tok_before', refundToken: 'ref_before', amount: 1490, currency: 'usd', createdAt: ago(9 * DAY) },
      ],
    )
    const requestId = new ObjectId()
    const [order, older] = guide() as { _id: ObjectId }[]

    assert.deepEqual(await refundGuideCover(app, { orderId: order!._id, reason: 'mistake', requestId, attempt: 'a1' }, deps), {
      stripeRefundId: 're_pi_book',
      amount: 1490,
      inStripe: false,
    })
    assert.ok(guide()[0]?.refundedAt)
    assert.equal((guide()[0]?.refund as { source: string }).source, 'admin')
    assert.ok(purchases()[0]?.refundedAt)
    // Another request: refunded already. The same one (an approval finished
    // later): its refund, without asking Stripe again.
    assert.equal(await refundGuideCover(app, { orderId: order!._id, reason: 'mistake', requestId: new ObjectId(), attempt: 'a2' }, deps), null)
    assert.deepEqual(await refundGuideCover(app, { orderId: order!._id, reason: 'mistake', requestId, attempt: 'a2' }, deps), {
      stripeRefundId: 're_pi_book',
      amount: 1490,
      inStripe: false,
    })
    // An order from before orders kept their payment: its checkout's, after the 7 days too.
    await refundGuideCover(app, { orderId: older!._id, reason: null, requestId, attempt: 'a1' }, deps)
    assert.deepEqual(refunded, ['pi_book', 'pi_from_session'])
  })
})
