import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { submitMessage, termsAcceptance } from '../stripe.js'

describe('what checkout says', () => {
  it('asks to accept our own terms and privacy policy, linked in their language', () => {
    assert.match(termsAcceptance('en'), /^I agree to Avarobe’s \[Terms\]\((https?:\/\/[^)]+)\/terms\) and \[Privacy Policy\]\(\1\/privacy\)\.$/)
    assert.match(termsAcceptance('pt-BR'), /^Concordo com os \[Termos\]\(.+\/pt-br\/terms\) e a \[Política de Privacidade\]\(.+\/pt-br\/privacy\) do Avarobe\.$/)
    assert.match(termsAcceptance('es'), /^Acepto los \[Términos\]\(.+\/es\/terms\) y la \[Política de Privacidad\]\(.+\/es\/privacy\) de Avarobe\.$/)
  })

  it('states how annual renews, and that its first month comes in two parts', () => {
    assert.match(submitMessage('pro_annual', 'br', 'pt-BR'), /Renova automaticamente por R\$\s?99,90 por ano/)
    assert.match(submitMessage('pro_annual', 'br', 'pt-BR'), /Seus primeiros 10 looks chegam na hora; o restante dos 30 do mês chega 7 dias depois da assinatura\./)
    assert.match(submitMessage('pro_annual', 'us', 'en'), /Your first 10 looks come right away; the rest of the month’s 30 arrive 7 days after you subscribe\./)
    assert.match(submitMessage('pro_annual', 'mx', 'es'), /Tus primeros 10 looks llegan al instante/)
    assert.doesNotMatch(submitMessage('pro_monthly', 'us', 'en'), /first 10 looks/)
    assert.equal(submitMessage('color_report', 'us', 'en'), 'One-time payment. No subscription.')
  })
})
