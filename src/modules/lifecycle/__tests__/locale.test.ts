import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { env } from '../../../config/env.js'
import { emailCopy, formatMoney, longDate } from '../../../i18n/emails.js'
import { passwordResetEmail, verificationEmail } from '../../../utils/email.js'
import { seasonName } from '../../../utils/seasons.js'
import {
  appLink,
  checkoutRescueEmail,
  crossSellEmail,
  outfitGuideEmail,
  trialEndingEmail,
  upgradeOfferEmail,
  welcomeEmail,
} from '../templates.js'

const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=x' }

describe('emails in the reader’s language', () => {
  it('write English unless the account says otherwise', () => {
    const plain = welcomeEmail({ ...recipient, stage: 'new', season: null })
    const english = welcomeEmail({ ...recipient, stage: 'new', season: null, locale: 'en' })
    assert.deepEqual(english, plain)
    assert.ok(plain.html.includes('<html lang="en"'))
  })

  it('write Brazilian Portuguese, with links, season and lang in it', () => {
    const email = welcomeEmail({ ...recipient, stage: 'looks', season: 'Soft Autumn', locale: 'pt-BR' })
    assert.equal(email.subject, 'Boas-vindas ao Avarobe, Nora')
    assert.ok(email.html.includes('<html lang="pt-BR"'))
    assert.ok(email.text.includes('Você é Outono Suave.'))
    assert.ok(!email.text.includes('Soft Autumn'))
    assert.ok(email.html.includes(`${env.APP_URL}/pt-br/studio?utm_source=email`))
    assert.ok(email.text.includes(`${env.APP_URL}/pt-br/studio/account`))
  })

  it('write Latin American Spanish with tú', () => {
    const email = welcomeEmail({ ...recipient, stage: 'new', season: null, locale: 'es' })
    assert.equal(email.subject, 'Te damos la bienvenida a Avarobe, Nora')
    assert.ok(email.text.includes('¡Hola, Nora!'))
    assert.ok(email.html.includes(`${env.APP_URL}/es/studio/avatar?utm_source=email`))
    assert.ok(email.text.includes('Recibes este correo porque creaste una cuenta de Avarobe'))
  })

  it('keep the analytics tags on links in another language', () => {
    const url = new URL(appLink('/studio/new', 'looks_nudge', { occasion: 'Ir a um casamento' }, 'pt-BR'))
    assert.equal(url.pathname, '/pt-br/studio/new')
    assert.equal(url.searchParams.get('utm_campaign'), 'looks_nudge')
    assert.equal(url.searchParams.get('occasion'), 'Ir a um casamento')
  })

  it('show prices where they pay, written the local way', () => {
    const brazil = upgradeOfferEmail({ ...recipient, locale: 'pt-BR', region: 'br', palette: { season: 'Warm Autumn', colors: [] } })
    assert.ok(brazil.text.includes('R$ 14,90'))
    assert.ok(!brazil.text.includes('$4.99'))
    const mexico = upgradeOfferEmail({ ...recipient, locale: 'es', region: 'mx', palette: { season: 'Warm Autumn', colors: [] } })
    assert.ok(mexico.text.includes('$79.00'))
    assert.equal(formatMoney(499, 'usd', 'en'), '$4.99')
    assert.equal(formatMoney(299, 'usd', 'es'), 'USD 2.99')
  })

  it('write dates in the reader’s language', () => {
    const trialEnd = new Date('2026-10-07T15:00:00Z')
    assert.equal(longDate(trialEnd, 'pt-BR'), 'quarta-feira, 7 de outubro')
    assert.equal(longDate(trialEnd, 'es'), 'miércoles 7 de octubre')
    const ending = trialEndingEmail({ ...recipient, trialEnd, looksLeft: 1, locale: 'es', region: 'mx' })
    assert.equal(ending.subject, 'Tu prueba de Pro termina el miércoles 7 de octubre')
    assert.ok(ending.text.includes('Todavía te queda 1 look por usar.'))
  })

  it('name products with their grammar', () => {
    const url = 'https://www.avarobe.com/continue?token=abc'
    assert.equal(checkoutRescueEmail({ ...recipient, product: 'magazine', url, locale: 'pt-BR' }).subject, 'Sua revista personalizada está a um passo')
    assert.equal(checkoutRescueEmail({ ...recipient, product: 'look_pack', url, locale: 'es' }).subject, 'Tus looks están a un paso')
  })

  it('sell cross-sells in their currency', () => {
    const email = crossSellEmail({
      ...recipient,
      locale: 'pt-BR',
      region: 'br',
      kind: 'xsell_style',
      price: 1500,
      regular: 1990,
      currency: 'brl',
      until: new Date('2026-10-17T20:00:00Z'),
      side: null,
      owns: { color: true, style: false },
      url: 'https://www.avarobe.com/continue?token=abc',
      season: 'Warm Autumn',
      colors: [],
      now: new Date('2026-10-04T18:00:00Z'),
    })
    assert.ok(email.text.includes('Em vez de R$ 19,90, porque você tem o Consultor de Cores. Vale até sábado, 17 de outubro.'))
  })

  it('deliver the guide and the account emails in the buyer’s language', () => {
    const guide = outfitGuideEmail({ email: 'a@b.co', firstName: '', downloadUrl: 'https://x/y', locale: 'es' })
    assert.equal(guide.subject, 'Tu Libro de Fórmulas de Outfits ya está aquí')
    assert.ok(guide.text.includes('Recibes este correo porque compraste El Libro de Fórmulas de Outfits'))
    assert.equal(verificationEmail({ firstName: 'Nora', url: 'https://x', forPasskey: false, locale: 'pt-BR' }).subject, 'Confirme seu e-mail no Avarobe')
    assert.ok(passwordResetEmail({ firstName: '', url: 'https://x', locale: 'es' }).text.startsWith('¡Hola!'))
  })

  it('translate the season names and leave unknown ones alone', () => {
    assert.equal(seasonName('Deep Winter', 'pt-BR'), 'Inverno Profundo')
    assert.equal(seasonName('Warm Spring', 'es'), 'Primavera Cálida')
    assert.equal(seasonName('Warm Spring', 'en'), 'Warm Spring')
    assert.equal(seasonName('Something else', 'es'), 'Something else')
  })

  it('have every language’s copy for every email', () => {
    const shape = (value: unknown): unknown =>
      typeof value === 'function'
        ? 'fn'
        : Array.isArray(value)
          ? value.length
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
            : typeof value
    assert.deepEqual(shape(emailCopy('pt-BR')), shape(emailCopy('en')))
    assert.deepEqual(shape(emailCopy('es')), shape(emailCopy('en')))
  })
})
