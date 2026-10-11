import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { submitMessage, termsAcceptance } from '../stripe.js'

describe('what checkout says', () => {
  it('asks to accept our own terms and privacy policy, linked in their language', () => {
    assert.match(termsAcceptance('en'), /^I agree to Avarobe’s \[Terms\]\((https?:\/\/[^)]+)\/terms\) and \[Privacy Policy\]\(\1\/privacy\)\.$/)
    assert.match(termsAcceptance('pt-BR'), /^Concordo com os \[Termos\]\(.+\/pt-br\/terms\) e a \[Política de Privacidade\]\(.+\/pt-br\/privacy\) do Avarobe\.$/)
    assert.match(termsAcceptance('es'), /^Acepto los \[Términos\]\(.+\/es\/terms\) y la \[Política de Privacidad\]\(.+\/es\/privacy\) de Avarobe\.$/)
    // One-time payments: only the terms.
    assert.doesNotMatch(termsAcceptance('en', 'color_report', 'us'), /renews/)
  })

  it('has a subscription’s box take the renewal too, at its price, in their language', () => {
    assert.match(termsAcceptance('en', 'pro_annual', 'us'), /, and that Pro renews automatically at \$29\.99 per year until I cancel\.$/)
    assert.match(termsAcceptance('pt-BR', 'pro_annual', 'br'), /, e que o Pro renova automaticamente por R\$\s?99,90 por ano até eu cancelar\.$/)
    assert.match(termsAcceptance('es', 'pro_monthly', 'mx'), /, y que Pro se renueva automáticamente por .+ al mes hasta que lo cancele\.$/)
    assert.match(termsAcceptance('en', 'pro_trial', 'us'), /and that after the trial Pro renews automatically at \$\d+\.\d\d per month until I cancel\.$/)
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
