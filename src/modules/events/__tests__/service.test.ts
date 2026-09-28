import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import { fbclidFromFbc, hashClick } from '../service.js'

describe('ad click ids', () => {
  it('reads the fbclid out of the _fbc cookie', () => {
    assert.equal(fbclidFromFbc('fb.1.1790000000000.IwAR3abc_DEF-123'), 'IwAR3abc_DEF-123')
    assert.equal(fbclidFromFbc('fb.1.1790000000000.IwY2.with.dots'), 'IwY2.with.dots')
    assert.equal(fbclidFromFbc('garbage'), null)
    assert.equal(fbclidFromFbc(undefined), null)
  })

  it('hashes the click the same way the web does (SHA-256, 32 hex)', () => {
    const expected = createHash('sha256').update('IwAR3abc').digest('hex').slice(0, 32)
    assert.equal(hashClick('IwAR3abc'), expected)
    assert.match(hashClick('IwAR3abc'), /^[a-f0-9]{32}$/)
  })
})
