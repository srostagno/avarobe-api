import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  averageScores,
  changeDirection,
  confidenceOf,
  contrastOf,
  metalsOf,
  rankSeasons,
  undertoneOf,
} from '../seasons.js'

const x = (warmth: number, depth: number, chroma: number) => ({ warmth, depth, chroma })

describe('the season from the scores', () => {
  it('gives the 10 reads of 11-Oct-2026 the seasons they had', () => {
    const evidence: [ReturnType<typeof x>, string][] = [
      // Her five reads: Deep Autumn every time.
      [x(2, 4, -1), 'Deep Autumn'],
      [x(3, 4, -1), 'Deep Autumn'],
      [x(2, 4, -1), 'Deep Autumn'],
      [x(2, 4, -1), 'Deep Autumn'],
      [x(2, 3, -1), 'Deep Autumn'],
      // His: Deep Autumn four times, Warm Autumn once (depth 1).
      [x(2, 2, 0), 'Deep Autumn'],
      [x(2, 1, 0), 'Warm Autumn'],
      [x(2, 2, 0), 'Deep Autumn'],
      [x(2, 2, 0), 'Deep Autumn'],
      [x(2, 2, 0), 'Deep Autumn'],
    ]

    for (const [scores, season] of evidence) {
      assert.equal(rankSeasons(scores).season, season, JSON.stringify(scores))
    }
  })

  it('measures the margin between the best two', () => {
    // Deep Autumn 5, Warm Autumn 3.25.
    assert.equal(rankSeasons(x(2, 4, -1)).margin, 1.75)
    // Warm Autumn 2.25, Deep Autumn 2: a close call.
    assert.equal(rankSeasons(x(2, 1, 0)).margin, 0.25)
  })

  it('breaks an exact tie for the season they have', () => {
    // Deep Autumn and Deep Winter tie at 4 (no warmth either way).
    assert.equal(rankSeasons(x(0, 4, 0), 'Deep Winter').season, 'Deep Winter')
    assert.equal(rankSeasons(x(0, 4, 0), 'Deep Autumn').season, 'Deep Autumn')
    assert.equal(rankSeasons(x(0, 4, 0)).margin, 0)
  })

  it('then by depth, then chroma, then warmth', () => {
    // Deep and Bright tie at 3: depth first, chroma clear makes it Winter.
    assert.equal(rankSeasons(x(0, 3, 3)).season, 'Deep Winter')
    // Bright Spring and Warm Spring tie at 3.5: chroma before warmth.
    assert.equal(rankSeasons(x(3, 0, 2)).season, 'Bright Spring')
  })

  it('then by the third trait within the family', () => {
    const cases: [ReturnType<typeof x>, string][] = [
      [x(0, 4, 0), 'Deep Autumn'],
      [x(0, 4, 1), 'Deep Winter'],
      [x(0, -4, 1), 'Light Spring'],
      [x(0, -4, -1), 'Light Summer'],
      [x(0, -1, 4), 'Bright Spring'],
      [x(0, 1, 4), 'Bright Winter'],
      [x(0, 1, -4), 'Soft Autumn'],
      [x(0, -1, -4), 'Soft Summer'],
      [x(4, 1, 1), 'Warm Autumn'],
      [x(4, -1, -1), 'Warm Spring'],
      [x(-4, 1, -1), 'Cool Winter'],
      [x(-4, -1, 1), 'Cool Summer'],
    ]

    for (const [scores, season] of cases) {
      assert.equal(rankSeasons(scores).season, season, JSON.stringify(scores))
    }
  })

  it('gives all-zero scores the same season every time', () => {
    assert.equal(rankSeasons(x(0, 0, 0)).season, 'Deep Autumn')
    assert.equal(rankSeasons(x(0, 0, 0)).season, rankSeasons(x(0, 0, 0)).season)
    // Unless it's theirs already.
    assert.equal(rankSeasons(x(0, 0, 0), 'Soft Summer').season, 'Soft Summer')
  })

  it('averages two measurements, halves included', () => {
    assert.deepEqual(averageScores({ warmth: 2, depth: 4, chroma: -1, contrast: 2 }, { warmth: 3, depth: 3, chroma: -1, contrast: 1 }), {
      warmth: 2.5,
      depth: 3.5,
      chroma: -1,
      contrast: 1.5,
    })
  })
})

describe('the rest of the read, in code', () => {
  it('reads the undertone from warmth, olive only near neutral', () => {
    assert.equal(undertoneOf({ warmth: 2 }, true), 'olive')
    assert.equal(undertoneOf({ warmth: -2 }, true), 'olive')
    assert.equal(undertoneOf({ warmth: 3 }, true), 'warm')
    assert.equal(undertoneOf({ warmth: 2 }, false), 'warm')
    assert.equal(undertoneOf({ warmth: 1.5 }, false), 'neutral')
    assert.equal(undertoneOf({ warmth: -1 }, false), 'neutral')
    assert.equal(undertoneOf({ warmth: -2 }, false), 'cool')
  })

  it('reads contrast and metals at ±2', () => {
    assert.equal(contrastOf({ contrast: 2 }), 'high')
    assert.equal(contrastOf({ contrast: 1.5 }), 'medium')
    assert.equal(contrastOf({ contrast: -2 }), 'low')
    assert.equal(metalsOf({ warmth: 2 }), 'gold')
    assert.equal(metalsOf({ warmth: 1 }), 'both')
    assert.equal(metalsOf({ warmth: -2 }), 'silver')
  })

  it('is confident only with a clear margin and fair light', () => {
    assert.equal(confidenceOf('good', 2), 'high')
    assert.equal(confidenceOf('tinted', 1), 'medium')
    assert.equal(confidenceOf('good', 0.5), 'low')
    assert.equal(confidenceOf('poor', 5), 'low')
  })
})

describe('which way a season moved', () => {
  it('within a family, the side of the new secondary trait', () => {
    assert.equal(changeDirection('Deep Winter', 'Deep Autumn'), 'warmer')
    assert.equal(changeDirection('Deep Autumn', 'Deep Winter'), 'cooler')
    assert.equal(changeDirection('Bright Spring', 'Bright Winter'), 'cooler')
    assert.equal(changeDirection('Soft Summer', 'Soft Autumn'), 'warmer')
    assert.equal(changeDirection('Light Summer', 'Light Spring'), 'warmer')
    assert.equal(changeDirection('Warm Spring', 'Warm Autumn'), 'softer')
    assert.equal(changeDirection('Warm Autumn', 'Warm Spring'), 'brighter')
    assert.equal(changeDirection('Cool Summer', 'Cool Winter'), 'brighter')
    assert.equal(changeDirection('Cool Winter', 'Cool Summer'), 'softer')
  })

  it('across families, the new main trait', () => {
    assert.equal(changeDirection('Light Spring', 'Deep Autumn'), 'deeper')
    assert.equal(changeDirection('Deep Autumn', 'Light Spring'), 'lighter')
    assert.equal(changeDirection('Deep Winter', 'Bright Winter'), 'brighter')
    assert.equal(changeDirection('Deep Autumn', 'Soft Autumn'), 'softer')
    assert.equal(changeDirection('Soft Autumn', 'Warm Autumn'), 'warmer')
    assert.equal(changeDirection('Warm Autumn', 'Cool Summer'), 'cooler')
  })
})
