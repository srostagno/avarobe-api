import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { regionalAmount } from '../../billing/pricing.js'
import { submitMessage } from '../../billing/stripe.js'
import { earnsOffer, halfPrice, npsGroup, npsScore, offerOpen, offerView } from '../rules.js'

const HOUR = 60 * 60 * 1000

describe('advisor ratings (NPS)', () => {
  it('scores promoters minus detractors, from −100 to 100', () => {
    assert.equal(npsScore([]), null)
    assert.equal(npsScore([10, 9, 8, 7, 6, 0]), 0)
    assert.equal(npsScore([10, 10, 9, 8]), 75)
    assert.equal(npsScore([3, 6]), -100)
    assert.deepEqual([10, 9, 8, 7, 6, 0].map(npsGroup), ['promoter', 'promoter', 'passive', 'passive', 'detractor', 'detractor'])
  })

  it('brings Pro’s half-price first month once, at 7 or more, to whoever never had Pro', () => {
    const fresh = { pro: null, proTrialAt: null, proHalfOffer: null }
    assert.equal(earnsOffer(fresh, 7, false), true)
    assert.equal(earnsOffer(fresh, 10, false), true)
    assert.equal(earnsOffer(fresh, 6, false), false)
    // An admin's free access, a trial, Pro (even ended) or the offer already.
    assert.equal(earnsOffer(fresh, 10, true), false)
    assert.equal(earnsOffer({ ...fresh, proTrialAt: new Date() }, 10, false), false)
    assert.equal(earnsOffer({ ...fresh, pro: { status: 'canceled' } as never }, 10, false), false)
    assert.equal(
      earnsOffer({ ...fresh, proHalfOffer: { from: 'color_advisor', at: new Date(), until: new Date(), usedAt: null } }, 10, false),
      false,
    )
  })

  it('keeps the offer open until it ends or is used', () => {
    const now = Date.now()
    const open = { from: 'color_advisor' as const, at: new Date(now), until: new Date(now + HOUR), usedAt: null }
    assert.equal(offerOpen(open, now), true)
    assert.equal(offerOpen({ ...open, until: new Date(now - 1) }, now), false)
    assert.equal(offerOpen({ ...open, usedAt: new Date(now) }, now), false)
    assert.equal(offerView({ ...open, usedAt: new Date(now) }, 'us', now), null)
  })

  it('halves Pro monthly in each region, rounded down to the cent', () => {
    for (const region of ['us', 'br', 'mx', 'co', 'latam'] as const) {
      const { amount, price, off } = halfPrice(region)
      assert.equal(amount, regionalAmount('pro_monthly', region))
      assert.equal(price + off, amount)
      assert.ok(price * 2 <= amount && (price + 1) * 2 > amount, region)
    }
  })

  it('says the first month’s price and then the renewal, in their language', () => {
    const us = halfPrice('us')
    const en = submitMessage('pro_monthly', 'us', 'en', us.price)
    assert.match(en, /^\$\d+\.\d\d today for your first month\. Then \$\d+\.\d\d per month from your second month, until you cancel\./)
    assert.match(submitMessage('pro_monthly', 'br', 'pt-BR', halfPrice('br').price), /^R\$\s?[\d,]+ hoje pelo seu primeiro mês\. Depois, R\$\s?[\d,]+ por mês a partir do segundo mês/)
    assert.match(submitMessage('pro_monthly', 'mx', 'es', halfPrice('mx').price), /hoy por tu primer mes\. Después, .+ al mes desde tu segundo mes, hasta que canceles\./)
    // Without the offer, as before.
    assert.match(submitMessage('pro_monthly', 'us', 'en'), /^Renews automatically at/)
  })
})
