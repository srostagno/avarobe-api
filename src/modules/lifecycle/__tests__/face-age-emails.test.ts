import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { faceAgeLaunchEmail, proWelcomeEmail } from '../templates.js'

const base = { firstName: 'Julia', email: 'julia@example.com', unsubscribeUrl: 'https://www.avarobe.com/u/x' }

describe('the Pro welcome email', () => {
  it('starts with her colors, then a look, a haircut and Face Age, in her language', () => {
    const en = proWelcomeEmail({ ...base, locale: 'en', hasColors: true })
    assert.equal(en.subject, 'Welcome to Avarobe Pro')
    const order = ['/studio/report', '/studio/new', '/studio/hair', '/studio/face-age'].map((path) => en.html.indexOf(path))
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!)))
    assert.match(en.html, /utm_campaign=pro_welcome/)
    assert.equal(proWelcomeEmail({ ...base, locale: 'es', hasColors: true }).subject, 'Bienvenida a Avarobe Pro')
    assert.equal(proWelcomeEmail({ ...base, locale: 'pt-BR', hasColors: true }).subject, 'Boas-vindas ao Avarobe Pro')
  })

  it('sends someone without colors yet to find them first', () => {
    const html = proWelcomeEmail({ ...base, locale: 'en', hasColors: false }).html
    assert.match(html, /\/studio\/avatar\?mode=colors/)
    assert.doesNotMatch(html, /\/studio\/report/)
  })
})

describe('the Face Age launch email', () => {
  it('opens Face Age in her language, with its picture and a way to unsubscribe', () => {
    const en = faceAgeLaunchEmail({ ...base, locale: 'en' })
    assert.equal(en.subject, 'New: how old does your face look?')
    assert.match(en.html, /\/email\/face-age\.jpg/)
    assert.match(en.html, /\/studio\/face-age\?utm_source=email&amp;utm_medium=lifecycle&amp;utm_campaign=face_age_launch/)
    assert.match(en.html, /\/u\/x/)
    assert.match(faceAgeLaunchEmail({ ...base, locale: 'es' }).html, /\/es\/studio\/face-age/)
    assert.equal(faceAgeLaunchEmail({ ...base, locale: 'pt-BR' }).subject, 'Novo: que idade seu rosto aparenta?')
    assert.doesNotMatch(en.text, /\bfree\b/i)
    assert.doesNotMatch(en.text, /\bAI\b/)
  })
})
