import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { attributionMetadata } from '../conversions.js'

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
