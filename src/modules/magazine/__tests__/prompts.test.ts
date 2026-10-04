import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildMagazinePhotoPrompt, buildMagazineRequest, magazineMoments, magazineSchema } from '../prompts.js'

describe('personal magazine', () => {
  it('offers moments for how they dress, ten of them first', () => {
    assert.ok(magazineMoments('womenswear').length >= 10)
    assert.ok(magazineMoments('menswear').some((moment) => moment.id === 'game'))
    assert.deepEqual(magazineMoments('unisex'), magazineMoments('womenswear'))
  })

  it('asks the editor for one look per moment, from their colors', () => {
    const request = buildMagazineRequest({
      firstName: 'Julie',
      season: 'The Soft Autumn Issue',
      moments: ['Weekend brunch', 'A wedding', 'Date night'],
      avatar: {
        body: { heightCm: 165, weightKg: 62, build: 'average', presentation: 'womenswear' },
        presentation: 'womenswear',
        colorAnalysis: {
          season: 'Soft Autumn',
          undertone: 'warm',
          contrast: 'medium',
          summary: '',
          bestColors: [{ name: 'Sage', hex: '#9CAF88' }],
          neutrals: [{ name: 'Camel', hex: '#B89B72' }],
          avoidColors: [{ name: 'Black', hex: '#111111' }],
          metals: 'gold',
          confidence: 'high',
          photoNote: null,
        },
        styleProfile: null,
      },
    })
    assert.match(request, /First name: Julie/)
    assert.match(request, /Best colors: Sage/)
    assert.match(request, /Keep away from the face: Black/)
    assert.match(request, /1\. Weekend brunch 2\. A wedding 3\. Date night/)

    const schema = magazineSchema(3) as { properties: { looks: { minItems: number; maxItems: number } } }
    assert.equal(schema.properties.looks.minItems, 3)
    assert.equal(schema.properties.looks.maxItems, 3)
  })

  it('shoots them on location, keeping their face', () => {
    const prompt = buildMagazinePhotoPrompt({ location: 'a vineyard at golden hour', outfit: 'a sage linen dress', pose: 'walking' })
    assert.match(prompt, /image 2 is their face/)
    assert.match(prompt, /a vineyard at golden hour/)
    assert.match(prompt, /No text/)
  })
})
