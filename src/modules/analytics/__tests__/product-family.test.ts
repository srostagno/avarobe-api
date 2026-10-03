import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { familyOf } from '../report.js'

describe('product interest', () => {
  it('counts every checkout under the product the shop and its page name', () => {
    assert.equal(familyOf('color_report'), 'color')
    assert.equal(familyOf('color_addon'), 'color')
    assert.equal(familyOf('style_addon'), 'style')
    assert.equal(familyOf('hair_advisor'), 'hair')
    assert.equal(familyOf('event_pass'), 'event')
    assert.equal(familyOf('advisors_bundle'), 'advisors')
    assert.equal(familyOf('pro_trial'), 'pro')
    assert.equal(familyOf('outfit_guide'), 'guide')
    assert.equal(familyOf('something_new'), 'something_new')
  })
})
