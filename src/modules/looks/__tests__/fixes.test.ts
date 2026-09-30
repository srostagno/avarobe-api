import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { FREE_FIXES_IN_A_ROW, fixIsFree } from '../fixes.js'

const disliked = {
  status: 'ready' as const,
  feedback: { rating: 'down' as const, aspects: [], pieces: [], note: null, at: new Date() },
}

describe('fixIsFree', () => {
  it('makes the first fix of a look rated down free', () => {
    assert.equal(fixIsFree(disliked), true)
  })

  it('charges for fixing a look they liked, or never rated', () => {
    assert.equal(fixIsFree({ ...disliked, feedback: { ...disliked.feedback, rating: 'up' } }), false)
    assert.equal(fixIsFree({ ...disliked, feedback: null }), false)
  })

  it('gives each look one free fix', () => {
    assert.equal(fixIsFree({ ...disliked, freeFixAt: new Date() }), false)
  })

  it('lets a free fix that missed be fixed for free, up to the limit in a row', () => {
    assert.equal(fixIsFree({ ...disliked, freeFixes: FREE_FIXES_IN_A_ROW - 1 }), true)
    assert.equal(fixIsFree({ ...disliked, freeFixes: FREE_FIXES_IN_A_ROW }), false)
  })

  it('never for a look that is not drawn', () => {
    assert.equal(fixIsFree({ ...disliked, status: 'failed' }), false)
    assert.equal(fixIsFree({ ...disliked, status: 'locked' }), false)
  })
})
