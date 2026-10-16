import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { purchaseInAccountEmail } from '../../lifecycle/templates.js'
import { firstNameFrom, ownerPage, ownerUnlocks } from '../guest-checkout.js'

describe('guest checkout', () => {
  it('takes a first name from the name on the card', () => {
    assert.equal(firstNameFrom('MARIA DA SILVA'), 'Maria')
    assert.equal(firstNameFrom('  josé  pérez '), 'José')
    assert.equal(firstNameFrom(''), '')
    assert.equal(firstNameFrom(null), '')
  })
})

describe('a guest who paid with an email that has an account', () => {
  const now = new Date('2026-10-16T14:00:00Z')
  const before = new Date('2026-10-01T10:00:00Z')

  it('unlocks the same advisors in that account, keeping what it had', () => {
    assert.deepEqual(ownerUnlocks('color_report', {}, now), { colorReportAt: now })
    assert.deepEqual(ownerUnlocks('color_report', { colorReportAt: before }, now), { colorReportAt: before })
    assert.deepEqual(ownerUnlocks('advisors_bundle', {}, now), { colorReportAt: now, styleReportAt: now, hairAdvisorAt: now, colorMirrorAt: now })
    assert.deepEqual(ownerUnlocks('hair_advisor', { styleReportAt: before }, now), { hairAdvisorAt: now })
  })

  it('leaves what can be used up on the guest, so nothing counts twice', () => {
    assert.equal(ownerUnlocks('look_pack', {}, now), null)
    assert.equal(ownerUnlocks('event_pass', {}, now), null)
    assert.equal(ownerUnlocks('magazine', {}, now), null)
  })

  it('signs them in on what they bought', () => {
    assert.equal(ownerPage('color_report'), '/studio/report')
    assert.equal(ownerPage('style_addon'), '/studio/report')
    assert.equal(ownerPage('hair_advisor'), '/studio/hair')
    assert.equal(ownerPage('color_mirror'), '/studio/mirror')
  })

  it('emails them that it’s in their account, in their language', () => {
    const base = { firstName: 'Julia', email: 'julia@example.com', unsubscribeUrl: 'https://avarobe.com/u', url: 'https://avarobe.com/l' }
    assert.equal(purchaseInAccountEmail({ ...base, locale: 'en', name: 'Color Advisor' }).subject, 'Your Color Advisor is in your account')
    assert.equal(purchaseInAccountEmail({ ...base, locale: 'es', name: 'Asesor de Color' }).subject, 'Tu Asesor de Color está en tu cuenta')
    assert.match(purchaseInAccountEmail({ ...base, locale: 'pt-BR', name: 'Consultor de Cores' }).html, /sem precisar pagar de novo/)
  })
})
