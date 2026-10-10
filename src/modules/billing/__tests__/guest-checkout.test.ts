import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { firstNameFrom } from '../guest-checkout.js'

describe('guest checkout', () => {
  it('takes a first name from the name on the card', () => {
    assert.equal(firstNameFrom('MARIA DA SILVA'), 'Maria')
    assert.equal(firstNameFrom('  josé  pérez '), 'José')
    assert.equal(firstNameFrom(''), '')
    assert.equal(firstNameFrom(null), '')
  })
})
