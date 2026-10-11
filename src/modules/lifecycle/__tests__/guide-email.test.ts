import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { guideRefundUrl } from '../../guide/service.js'
import { outfitGuideEmail } from '../templates.js'

describe('the Outfit Formula Book email', () => {
  const order = { token: 'tok_abcdefghijklmnopqrstuvwxyz' }
  const base = { email: 'nora@example.com', firstName: 'Nora', downloadUrl: 'https://api.avarobe.com/api/v1/guide/download/tok' }

  it('links to the 7-day refund in their language, with no account needed', () => {
    const words = { en: 'Changed your mind? Get a refund within 7 days', 'pt-BR': 'Mudou de ideia? Peça o reembolso em até 7 dias', es: '¿Cambiaste de opinión? Pide tu reembolso dentro de los 7 días' } as const

    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      const url = guideRefundUrl(order, locale)
      const mail = outfitGuideEmail({ ...base, locale, refundUrl: url })

      assert.ok(url.includes('/guide/thanks?refund=tok_abcdefghijklmnopqrstuvwxyz'), url)
      assert.ok(mail.text.includes(`${words[locale]}: ${url}`), locale)
    }

    assert.ok(guideRefundUrl(order, 'pt-BR').includes('/pt-br/'))
    assert.ok(!outfitGuideEmail(base).text.includes('refund'))
  })
})
