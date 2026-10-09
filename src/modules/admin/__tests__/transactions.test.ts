import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { buildTransactions, type Payment } from '../transactions.js'

const nora = new ObjectId()
const lia = new ObjectId()

const payment = (overrides: Partial<Payment>): Payment => ({
  id: new ObjectId().toString(),
  userId: nora,
  product: 'color_report',
  amount: 1490,
  currency: 'brl',
  usd: 268,
  at: new Date('2026-10-08T15:00:00Z'),
  refundedAt: null,
  refundSource: null,
  guestEmail: null,
  ...overrides,
})

const users = [
  {
    _id: nora,
    email: 'nora@example.com',
    createdAt: new Date('2026-10-08T14:30:00Z'),
    location: { country: 'BR', region: 'SP', source: 'edge' as const, at: new Date() },
    locale: 'pt-BR' as const,
    acquisition: { visitorId: null, channel: 'meta' as const, source: 'facebook', medium: 'paid', campaign: 'launch_br', content: 'colors_grey_e_pt', term: null, landing: '/pt-br' },
  },
  {
    _id: lia,
    email: 'x1@guest.avarobe.invalid',
    createdAt: new Date('2026-10-07T10:00:00Z'),
    location: null,
    locale: 'en' as const,
    acquisition: null,
  },
]

function report(payments: Payment[], extra: Partial<Parameters<typeof buildTransactions>[0]> = {}) {
  return buildTransactions({
    range: { from: '2026-10-07', to: '2026-10-09' },
    truncated: false,
    payments,
    users,
    paid: payments.flatMap((p) => (p.userId ? [{ userId: p.userId, at: p.at, usd: p.usd, refunded: Boolean(p.refundedAt) }] : [])),
    checkouts: [],
    seasons: [{ userId: nora, season: 'Soft Autumn' }],
    ...extra,
  })
}

describe('transactions report', () => {
  it('gives each payment its buyer: country, source, minutes from sign-up, nth payment and lifetime total', () => {
    const first = payment({})
    const addon = payment({ product: 'style_addon', amount: 1500, usd: 270, at: new Date('2026-10-08T15:10:00Z') })
    const { rows } = report([addon, first])
    const row = rows.find((r) => r.product === 'style_addon')!

    assert.equal(row.country, 'BR')
    assert.equal(row.region, 'SP')
    assert.equal(row.campaign, 'launch_br')
    assert.equal(row.content, 'colors_grey_e_pt')
    assert.equal(row.minutesToBuy, 40)
    assert.equal(row.order, 2)
    assert.equal(row.buyerTotalUsd, 538)
    assert.equal(row.season, 'Soft Autumn')
    assert.equal(rows.find((r) => r.product === 'color_report')!.order, 1)
  })

  it('names the button and the checkout they paid from: the last checkout for that product before paying', () => {
    const paid = payment({ at: new Date('2026-10-08T15:00:00Z') })
    const { rows } = report([paid], {
      checkouts: [
        { userId: nora, name: 'checkout_started', at: new Date('2026-10-08T14:40:00Z'), props: { product: 'color_report', placement: 'colors_card' }, mobile: true, inApp: true },
        { userId: nora, name: 'checkout_started', at: new Date('2026-10-08T14:58:00Z'), props: { product: 'color_report', placement: 'colors_sheet' }, mobile: true, inApp: false },
        { userId: nora, name: 'checkout_created', at: new Date('2026-10-08T14:58:30Z'), props: { product: 'color_report', ui: 'hosted' }, mobile: true, inApp: false },
        // Another product, and one after the payment: neither counts.
        { userId: nora, name: 'checkout_started', at: new Date('2026-10-08T14:59:00Z'), props: { product: 'style_addon', placement: 'purchase_success' }, mobile: true, inApp: false },
        { userId: nora, name: 'checkout_started', at: new Date('2026-10-08T15:30:00Z'), props: { product: 'color_report', placement: 'later' }, mobile: true, inApp: false },
      ],
    })

    assert.equal(rows[0]!.placement, 'colors_sheet')
    assert.equal(rows[0]!.ui, 'hosted')
    assert.equal(rows[0]!.mobile, true)
    assert.equal(rows[0]!.inApp, false)
  })

  it('takes the device from the last visit before paying (checkout events have none)', () => {
    const { rows } = report([payment({})], {
      checkouts: [
        { userId: nora, name: 'page_view', at: new Date('2026-10-08T14:50:00Z'), props: {}, mobile: false, inApp: false },
        { userId: nora, name: 'checkout_started', at: new Date('2026-10-08T14:58:00Z'), props: { product: 'color_report', placement: 'colors_sheet' }, mobile: null, inApp: null },
      ],
    })

    assert.equal(rows[0]!.placement, 'colors_sheet')
    assert.equal(rows[0]!.mobile, false)
    assert.equal(rows[0]!.inApp, false)
  })

  it('leaves refunds out of revenue and the splits, and counts buyers and new buyers', () => {
    const kept = payment({})
    const refunded = payment({ userId: lia, currency: 'usd', amount: 499, usd: 499, refundedAt: new Date(), refundSource: 'app' })
    const { summary, byProduct, byCountry } = report([kept, refunded])

    assert.equal(summary.revenueUsd, 268)
    assert.equal(summary.payments, 1)
    assert.equal(summary.buyers, 1)
    assert.equal(summary.newBuyers, 1)
    assert.equal(summary.refunds, 1)
    assert.equal(summary.refundedUsd, 499)
    assert.deepEqual(byProduct, [{ key: 'color_report', count: 1, usd: 268 }])
    assert.deepEqual(byCountry, [{ key: 'BR', count: 1, usd: 268 }])
  })

  it('never shows a guest placeholder email, and keeps a book order bought without an account', () => {
    const guest = payment({ userId: lia, currency: 'usd', amount: 499, usd: 499 })
    const book = payment({ userId: null, product: 'outfit_guide', currency: 'usd', amount: 1490, usd: 1490, guestEmail: 'buyer@example.com' })
    const { rows } = report([guest, book])

    assert.equal(rows.find((r) => r.account === lia.toString().slice(-6))!.email, null)
    assert.equal(rows.find((r) => r.product === 'outfit_guide')!.email, 'buyer@example.com')
    assert.equal(rows.find((r) => r.product === 'outfit_guide')!.account, null)
  })

  it('adds up every Pacific day of the range, quiet days included', () => {
    const { daily } = report([
      // Oct 7, 23:30 in California.
      payment({ at: new Date('2026-10-08T06:30:00Z'), usd: 100 }),
      payment({ at: new Date('2026-10-08T18:00:00Z'), usd: 200 }),
      payment({ at: new Date('2026-10-08T19:00:00Z'), usd: 50, refundedAt: new Date() }),
    ])

    assert.deepEqual(
      daily.map((d) => [d.day, d.usd, d.count, d.refundedUsd]),
      [
        ['2026-10-07', 100, 1, 0],
        ['2026-10-08', 200, 1, 50],
        ['2026-10-09', 0, 0, 0],
      ],
    )
  })
})
