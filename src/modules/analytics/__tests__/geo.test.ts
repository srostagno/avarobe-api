import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { geoCode, parseGeo } from '../geo.js'

describe('the visitor’s state', () => {
  it('reads a state or a country from the cookie and ignores anything else', () => {
    assert.deepEqual(parseGeo('US-TX'), { country: 'US', region: 'TX' })
    assert.deepEqual(parseGeo(' cl '), { country: 'CL', region: null })
    assert.equal(parseGeo('US-TX; drop'), null)
    assert.equal(parseGeo('Texas'), null)
    assert.equal(parseGeo(undefined), null)
  })

  it('writes it back as one code', () => {
    assert.equal(geoCode({ country: 'US', region: 'CA' }), 'US-CA')
    assert.equal(geoCode({ country: 'MX', region: null }), 'MX')
    assert.equal(geoCode(null), null)
  })
})
