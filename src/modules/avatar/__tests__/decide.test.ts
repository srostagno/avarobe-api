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

  it('never changes an existing season by itself in classic: another season is theirs to choose', () => {
    for (const locked of [false, true]) {
      const other = decideColors({ current: 'Deep Winter', locked, measure: { method: 'classic', season: 'Soft Autumn' } })
      const same = decideColors({ current: 'Deep Winter', locked, measure: { method: 'classic', season: 'Deep Winter' } })

      assert.equal(other.outcome, 'candidate')
      assert.equal(other.read, 'Soft Autumn')
      assert.equal(other.shown, 'Deep Winter')
      assert.equal(other.from, 'Deep Winter')
      assert.equal(other.palette, true)
      assert.equal(same.outcome, 'confirmed')
      assert.equal(same.palette, false)
    }

    const first = decideColors({ current: null, locked: false, measure: { method: 'classic', season: 'Soft Autumn' } })
    assert.equal(first.outcome, 'first')
    assert.equal(first.shown, 'Soft Autumn')
  })

  it('holds the season of someone whose report couldn’t be written again', () => {
    const classic = decideColors({ current: 'Deep Winter', locked: true, switchable: false, measure: { method: 'classic', season: 'Soft Autumn' } })
    const clear = decideColors({ current: 'Deep Winter', locked: true, switchable: false, measure: scored(3, 4, -1) })

    for (const decision of [classic, clear]) {
      assert.equal(decision.outcome, 'anchored')
      assert.equal(decision.shown, 'Deep Winter')
      assert.equal(decision.palette, false)
    }
  })

  it('offers a choice when the colors were read in poor light and a good-light photo leans elsewhere', () => {
    // A lead of 1: not clear, but her colors came from a photo in poor light.
    const weak = decideColors({ current: 'Deep Winter', locked: false, currentLighting: 'poor', measure: scored(1, 4, -1) })
    const stillPoor = decideColors({ current: 'Deep Winter', locked: false, currentLighting: 'poor', measure: scored(1, 4, -1, 'poor') })
    const goodBefore = decideColors({ current: 'Deep Winter', locked: false, currentLighting: 'good', measure: scored(1, 4, -1) })

    assert.equal(weak.outcome, 'candidate')
    assert.equal(weak.shown, 'Deep Winter')
    assert.equal(weak.palette, true)
    assert.equal(stillPoor.outcome, 'anchored')
    assert.equal(goodBefore.outcome, 'anchored')
  })
})
