import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ColorAnalysis } from '../../../types/mongo.js'
import { analysisHasForeignScript, cleanColorAnalysis, hasForeignScript } from '../analysis.js'

function analysis(overrides: Partial<ColorAnalysis> = {}): ColorAnalysis {
  return {
    season: 'Soft Autumn',
    undertone: 'warm',
    contrast: 'medium',
    summary: 'Your coloring is warm and muted. Soft, earthy shades look best.',
    bestColors: [
      { name: 'Café au lait', hex: '#a67b5b' },
      { name: 'Olive', hex: '#5B5A2C' },
    ],
    neutrals: [{ name: 'Camel', hex: '#C19A6B' }],
    avoidColors: [{ name: 'Icy pink', hex: '#F4D6E4' }],
    metals: 'gold',
    confidence: 'medium',
    photoNote: 'Warm light may be warming the image—try daylight (about 5,500 K).',
    ...overrides,
  }
}

describe('foreign-script slips in the color analysis', () => {
  it('accepts English with accents, dashes, digits and emoji', () => {
    assert.equal(hasForeignScript('Café au lait – 100% “warm” 🌿'), false)
    assert.equal(hasForeignScript(null), false)
    assert.equal(analysisHasForeignScript(analysis()), false)
  })

  it('spots a word from another script', () => {
    assert.equal(hasForeignScript('Warm sunlight is сильнly warming the image'), true)
    assert.equal(hasForeignScript('A soft 暖 glow'), true)
    assert.equal(analysisHasForeignScript(analysis({ photoNote: 'Warm sunlight is сильнly warming it.' })), true)
    assert.equal(analysisHasForeignScript(analysis({ neutrals: [{ name: 'Тёмный navy', hex: '#1F2A44' }] })), true)
  })

  it('drops a garbled photo note and swatch but keeps the rest', () => {
    const clean = cleanColorAnalysis(
      analysis({
        photoNote: 'Warm sunlight is сильнly warming it.',
        bestColors: [
          { name: 'Olive', hex: '#5b5a2c' },
          { name: 'Тёмный navy', hex: '#1F2A44' },
          { name: 'Rust', hex: 'rust' },
        ],
      }),
    )
    assert.equal(clean.photoNote, null)
    assert.deepEqual(clean.bestColors, [{ name: 'Olive', hex: '#5B5A2C' }])
    assert.equal(clean.summary, analysis().summary)
  })
})
