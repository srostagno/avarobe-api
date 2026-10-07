import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import type { Acquisition } from '../../../types/mongo.js'
import { fbclidFromFbc, hashClick, recoveredAcquisition } from '../service.js'

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

describe('a sign-up from a Meta ad click the browser lost', () => {
  const click = { fbclid: 'IwAR3abc', path: '/color-analysis', campaign: 'launch_us', content: 'colors_grey_e' }
  const direct: Acquisition = {
    visitorId: 'v1',
    channel: 'direct',
    source: null,
    medium: null,
    campaign: null,
    content: null,
    term: null,
    landing: '/login',
  }

  it('counts as Meta, with the ad it came from and what the browser had said', () => {
    assert.deepEqual(recoveredAcquisition(direct, click), {
      visitorId: 'v1',
      channel: 'meta',
      source: 'meta',
      medium: 'paid_social',
      campaign: 'launch_us',
      content: 'colors_grey_e',
      term: null,
      landing: '/color-analysis',
      fbclid: 'IwAR3abc',
      recovered: 'meta_click',
      recoveredFrom: 'direct',
    })
    assert.equal(recoveredAcquisition(null, click)?.recoveredFrom, null)
    assert.equal(recoveredAcquisition({ ...direct, channel: 'social' }, click)?.channel, 'meta')
  })

  it('leaves Meta, Google, email and already recovered accounts as they are', () => {
    for (const channel of ['meta', 'google', 'email'] as const) {
      assert.equal(recoveredAcquisition({ ...direct, channel }, click), null)
    }
    assert.equal(recoveredAcquisition({ ...direct, recovered: 'meta_click' }, click), null)
  })
})
