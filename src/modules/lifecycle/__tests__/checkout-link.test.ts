import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shortProductName } from '../checkout-link.js'

describe('shortProductName', () => {
  it('drops the brand in front and the note in brackets, in each language', () => {
    assert.equal(shortProductName('color_report'), 'Color Advisor')
    assert.equal(shortProductName('color_addon'), 'Color Advisor')
    assert.equal(shortProductName('advisors_bundle'), 'Color, Style and Hair & Grooming Advisors')
    assert.equal(shortProductName('pro_monthly'), 'Avarobe Pro')
    assert.equal(shortProductName('color_report', 'es'), 'Asesor de Color')
    assert.equal(shortProductName('style_addon', 'es'), 'Asesor de Estilo')
    assert.equal(shortProductName('pro_annual', 'pt-BR'), 'Avarobe Pro')
    assert.equal(shortProductName('reports_bundle', 'pt-BR'), 'Consultores de Cores e Estilo')
  })
})
