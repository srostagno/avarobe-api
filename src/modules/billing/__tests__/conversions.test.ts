import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { attributionMetadata, storedAdIds, storedMetaClick } from '../conversions.js'

const request = { ip: '203.0.113.7', headers: { 'user-agent': 'Instagram 300.0 (iPhone)' } }

describe('checkout attribution kept in Stripe metadata', () => {
  it('keeps the click id without the _fbp cookie, with IP and user agent for Meta', () => {
    const metadata = attributionMetadata({ fbc: 'fb.1.1790000000000.IwAR0abc' }, request)

    assert.deepEqual(metadata, { fbc: 'fb.1.1790000000000.IwAR0abc', ip: request.ip, ua: 'Instagram 300.0 (iPhone)' })
  })

  it('drops an id longer than a Stripe metadata value instead of failing the checkout', () => {
    const metadata = attributionMetadata({ fbp: 'fb.1.1790000000000.123', fbc: `fb.1.1790000000000.${'x'.repeat(600)}` }, request)

    assert.equal(metadata.fbc, undefined)
    assert.equal(metadata.fbp, 'fb.1.1790000000000.123')
  })

  it('keeps nothing when the browser sent no ids (the visitor opted out)', () => {
    assert.deepEqual(attributionMetadata(undefined, request), {})
    assert.deepEqual(attributionMetadata({}, request), {})
  })
})

describe("the account's own Meta click, for a browser that lost it", () => {
  const user = { acquisition: { fbclid: 'IwZXh0bgNhZW0BMAABHRx_aem_Q1' }, createdAt: new Date(1791000000000) }
  const stored = storedMetaClick(user)

  it('spells it like the _fbc cookie, timed at the account', () => {
    assert.equal(stored, 'fb.1.1791000000000.IwZXh0bgNhZW0BMAABHRx_aem_Q1')
    assert.deepEqual(storedAdIds(user), { fbc: stored })
    assert.equal(storedMetaClick({ acquisition: { fbclid: null }, createdAt: new Date() }), undefined)
    assert.equal(storedMetaClick({ acquisition: { fbclid: 'bad id!' }, createdAt: new Date() }), undefined)
    assert.equal(storedAdIds(null), undefined)
  })

  it('fills in for a browser that sent its ids without a click id (Safari after the jump)', () => {
    const metadata = attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request, stored)
    assert.deepEqual(metadata, { fbp: 'fb.1.1791000000000.456', fbc: stored, ip: request.ip, ua: 'Instagram 300.0 (iPhone)' })
    assert.equal(attributionMetadata({}, request, stored).fbc, stored)
  })

  it("never replaces the browser's own click, and never goes for a browser that opted out", () => {
    assert.equal(attributionMetadata({ fbc: 'fb.1.1791000500000.newer' }, request, stored).fbc, 'fb.1.1791000500000.newer')
    assert.deepEqual(attributionMetadata(undefined, request, stored), {})
  })
})

