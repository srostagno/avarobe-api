import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Acquisition, AvatarBody } from '../../../types/mongo.js'
import { focusOf } from '../../../utils/serializers.js'
import { buildDrapePreviewPrompt, buildSelfieDrapePreviewPrompt } from '../../report/prompts.js'
import { bodyOf } from '../body.js'
import { failureFor } from '../service.js'

const acquisition = (fields: Partial<Acquisition>): { acquisition: Acquisition } => ({
  acquisition: {
    visitorId: null,
    channel: 'meta',
    source: 'meta',
    medium: 'paid_social',
    campaign: 'launch_us',
    content: null,
    term: null,
    landing: '/',
    ...fields,
  },
})

describe('colors first: who starts with their colors', () => {
  it('starts people from a color guide with their colors', () => {
    assert.equal(focusOf(acquisition({ landing: '/color-analysis' })), 'colors')
    assert.equal(focusOf(acquisition({ landing: '/color-analysis/deep-winter' })), 'colors')
    // The translated addresses in Portuguese and Spanish.
    assert.equal(focusOf(acquisition({ landing: '/pt-br/coloracao-pessoal/outono-suave' })), 'colors')
    assert.equal(focusOf(acquisition({ landing: '/es/colorimetria' })), 'colors')
    assert.equal(focusOf(acquisition({ landing: '/es/colores/mejores-colores-para-piel-morena' })), null)
  })

  it('starts people from any Colors ad with their colors, wherever it landed', () => {
    assert.equal(focusOf(acquisition({ landing: '/', content: 'colors_beige_d' })), 'colors')
  })

  it('leaves everyone else on the avatar first', () => {
    assert.equal(focusOf(acquisition({ landing: '/', content: 'glowup_a' })), null)
    assert.equal(focusOf({ acquisition: null }), null)
    assert.equal(focusOf({}), null)
  })
})

describe('colors first: the avatar body', () => {
  it('is required for anything drawn on the avatar', () => {
    assert.throws(() => bodyOf({ body: null }), /avatar/)
  })

  it('passes through when there is one', () => {
    const body: AvatarBody = { heightCm: 165, weightKg: 60, build: 'average', presentation: 'womenswear' }

    assert.equal(bodyOf({ body }), body)
  })
})

describe('colors first: a failed color read', () => {
  it('leaves the read failed with a message that says what to do', () => {
    const failure = failureFor('colors')

    assert.equal(failure.status, 'failed')
    assert.match(failure.error, /selfie/)
  })
})

describe('colors first: the free best-vs-worst preview', () => {
  const best = { name: 'Emerald', hex: '#00785A' }
  const worst = { name: 'Beige', hex: '#D8C3A5' }

  it('is drawn from the selfie alone when there is no avatar yet', () => {
    const prompt = buildSelfieDrapePreviewPrompt(best, worst)

    assert.match(prompt, /^Image 1 is a selfie/)
    assert.doesNotMatch(prompt, /Image 2/)
    assert.match(prompt, /left emerald/i)
    assert.match(prompt, /right beige/i)
  })

  it('keeps the avatar version for everyone else', () => {
    assert.match(buildDrapePreviewPrompt(best, worst), /Image 2 is a close-up/)
  })
})
