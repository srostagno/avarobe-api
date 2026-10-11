import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { env } from '../../../config/env.js'
import type { UserDocument } from '../../../types/mongo.js'
import { crossSellContentFor, crossSellOffer, proCreditOffer } from '../service.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = new Date('2026-10-14T15:00:00Z')

// A buyer in Brazil who bought the Color Advisor `daysAgo` days ago.
function buyer(daysAgo: number, fields: Partial<UserDocument> = {}): UserDocument {
  return {
    _id: new ObjectId(),
    email: 'nora@example.com',
    firstName: 'Nora',
    createdAt: new Date(now.getTime() - 20 * DAY),
    updatedAt: now,
    lastLoginAt: null,
    emailVerifiedAt: now,
    locale: 'pt-BR',
    location: { country: 'BR', region: null, source: 'edge', at: now },
    colorReportAt: new Date(now.getTime() - daysAgo * DAY),
    ...fields,
  }
}

describe('the Pro credit offer in emails', () => {
  it('prices Pro annual as checkout does where they pay: R$ 85,00 after the Color Advisor', () => {
    const credit = proCreditOffer(buyer(1), now)

    assert.deepEqual(
      credit && { price: credit.price, regular: credit.regular, credit: credit.credit, currency: credit.currency, from: credit.from },
      { price: 8500, regular: 9990, credit: 1490, currency: 'brl', from: 'color' },
    )
    assert.equal(credit?.until.getTime(), now.getTime() - DAY + env.REPORT_CREDIT_WINDOW_DAYS * DAY)
  })

  it('sells annual with it in the Pro email, monthly once it has less than a day left or on Pro', () => {
    const annual = crossSellOffer('xsell_pro', buyer(10), now)
    assert.deepEqual([annual.product, annual.price, annual.regular, annual.currency], ['pro_annual', 8500, 9990, 'brl'])

    const ending = crossSellOffer('xsell_pro', buyer(env.REPORT_CREDIT_WINDOW_DAYS - 0.5), now)
    assert.deepEqual([ending.product, ending.price], ['pro_monthly', 2490])

    const pro = { subscriptionId: 'sub_1', customerId: null, status: 'active', interval: 'month' as const, periodEnd: new Date(now.getTime() + 20 * DAY), cancelAtPeriodEnd: false }
    assert.equal(proCreditOffer(buyer(1, { pro }), now), null)
    // Left out by the send (the three advisors' buyers): monthly.
    assert.equal(crossSellOffer('xsell_pro', buyer(10), now, null, null).product, 'pro_monthly')
  })

  it('carries the block in a cross-sell only when the send says so, with its own checkout', () => {
    const user = buyer(1)
    const credit = proCreditOffer(user, now)
    const link = { url: 'https://x/style', side: null, heroUrl: null, gift: null, cut: null, edit: null, occasionUrls: [], credit }
    const block = crossSellContentFor('xsell_style', user, undefined, { ...link, proCreditUrl: 'https://x/pro' }, now).proCredit

    assert.deepEqual(block && [block.price, block.regular, block.url], [8500, 9990, 'https://x/pro'])
    assert.equal(crossSellContentFor('xsell_style', user, undefined, link, now).proCredit, null)
    // The Pro email: the offer itself, on its main button.
    const pro = crossSellContentFor('xsell_pro', buyer(10), undefined, { ...link, url: 'https://x/annual', credit: proCreditOffer(buyer(10), now) }, now)
    assert.equal(pro.proCredit?.url, 'https://x/annual')
    assert.equal(pro.price, 8500)
  })
})
