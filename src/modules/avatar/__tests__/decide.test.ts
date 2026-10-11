import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ColorLighting } from '../../../types/mongo.js'
import { SWITCH_MARGIN, decideColors, type ScoredMeasure } from '../decide.js'

const scored = (warmth: number, depth: number, chroma: number, lighting: ColorLighting = 'good'): ScoredMeasure => ({
  method: 'scored',
  scores: { warmth, depth, chroma, contrast: 2 },
  lighting,
  samples: 1,
})

describe('decideColors', () => {
  it('takes the first read as it is, with its palette', () => {
    const decision = decideColors({ current: null, locked: false, measure: scored(2, 4, -1) })

    assert.equal(decision.outcome, 'first')
    assert.equal(decision.shown, 'Deep Autumn')
    assert.equal(decision.palette, true)
    assert.equal(decision.lead, null)
  })

  it('confirms the same season without writing a palette', () => {
    const decision = decideColors({ current: 'Deep Autumn', locked: false, measure: scored(2, 4, -1) })

    assert.equal(decision.outcome, 'confirmed')
    assert.equal(decision.shown, 'Deep Autumn')
    assert.equal(decision.palette, false)
  })

  it('holds the season when the new one leads by less than the margin (the complaint)', () => {
    // Deep Autumn 4.5 against Deep Winter 3.5 on the new photo: a lead of 1.
    const decision = decideColors({ current: 'Deep Winter', locked: false, measure: scored(1, 4, -1) })

    assert.equal(SWITCH_MARGIN, 2)
    assert.equal(decision.outcome, 'anchored')
    assert.equal(decision.read, 'Deep Autumn')
    assert.equal(decision.shown, 'Deep Winter')
    assert.equal(decision.lead, 1)
    assert.equal(decision.palette, false)
  })

  it('holds the season in poor light, whatever the lead', () => {
    const decision = decideColors({ current: 'Deep Winter', locked: false, measure: scored(3, 4, -1, 'poor') })

    assert.equal(decision.outcome, 'anchored')
    assert.equal(decision.lead, 3)
  })

  it('changes it when the new season clearly leads, and says which way', () => {
    for (const warmth of [2, 3]) {
      const decision = decideColors({ current: 'Deep Winter', locked: false, measure: scored(warmth, 4, -1) })

      assert.equal(decision.outcome, 'changed', `warmth ${warmth}`)
      assert.equal(decision.shown, 'Deep Autumn')
      assert.equal(decision.from, 'Deep Winter')
      assert.equal(decision.direction, 'warmer')
      assert.equal(decision.lead, warmth)
      assert.equal(decision.palette, true)
    }
  })

  it('makes a buyer’s clear difference a candidate, keeping what she paid for', () => {
    const decision = decideColors({ current: 'Deep Winter', locked: true, measure: scored(3, 4, -1) })

    assert.equal(decision.outcome, 'candidate')
    assert.equal(decision.read, 'Deep Autumn')
    assert.equal(decision.shown, 'Deep Winter')
    assert.equal(decision.palette, true)
  })

  it('never changes an existing season in classic', () => {
    for (const locked of [false, true]) {
      const other = decideColors({ current: 'Deep Winter', locked, measure: { method: 'classic', season: 'Soft Autumn' } })
      const same = decideColors({ current: 'Deep Winter', locked, measure: { method: 'classic', season: 'Deep Winter' } })

      assert.equal(other.outcome, 'anchored')
      assert.equal(other.shown, 'Deep Winter')
      assert.equal(other.palette, false)
      assert.equal(same.outcome, 'confirmed')
    }

    const first = decideColors({ current: null, locked: false, measure: { method: 'classic', season: 'Soft Autumn' } })
    assert.equal(first.outcome, 'first')
    assert.equal(first.shown, 'Soft Autumn')
  })
})
