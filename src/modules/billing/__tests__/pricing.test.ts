import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { env } from '../../../config/env.js'
import { regionalAmount, regionalPrice, regionForCountry, toUsdCents } from '../pricing.js'

describe('prices by region', () => {
  it('picks the region by country, not language', () => {
    assert.equal(regionForCountry('BR'), 'br')
    assert.equal(regionForCountry('mx'), 'mx')
    assert.equal(regionForCountry('CO'), 'co')
    assert.equal(regionForCountry('PE'), 'latam')
    assert.equal(regionForCountry('US'), 'us')
    assert.equal(regionForCountry('ES'), 'us')
    assert.equal(regionForCountry(null), 'us')
  })

  it('charges reais in Brazil and pesos in Mexico', () => {
    assert.deepEqual(regionalPrice('color_report', 'br'), { amount: 1490, currency: 'brl' })
    assert.deepEqual(regionalPrice('pro_monthly', 'mx'), { amount: 12900, currency: 'mxn' })
    assert.deepEqual(regionalPrice('color_report', 'latam'), { amount: 299, currency: 'usd' })
    // Colombia: the same prices in pesos (COP 11.900).
    assert.deepEqual(regionalPrice('color_report', 'co'), { amount: 1190000, currency: 'cop' })
    assert.equal(regionalAmount('style_addon', 'co'), 2390000 - 1190000)
    assert.equal(regionalAmount('color_report', 'us'), env.PRICE_COLOR_REPORT_CENTS)
  })

  it('completes the pair at the bundle price of the same region', () => {
    assert.equal(regionalAmount('style_addon', 'br'), 2990 - 1490)
    assert.equal(regionalAmount('color_addon', 'mx'), 14900 - 9900)
  })

  it('keeps revenue comparable in dollars', () => {
    assert.equal(toUsdCents(499, 'usd'), 499)
    assert.equal(toUsdCents(1490, 'brl'), Math.round(1490 * env.FX_USD_PER_BRL))
    assert.equal(toUsdCents(1190000, 'cop'), Math.round(1190000 * env.FX_USD_PER_COP))
  })
})
