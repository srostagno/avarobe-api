import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { unsubscribeToken, userIdFromUnsubscribeToken } from '../service.js'
import {
  appLink,
  looksNudgeEmail,
  upgradeLastCallEmail,
  upgradeOfferEmail,
  upgradeReminderEmail,
  welcomeEmail,
} from '../templates.js'

const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=x' }

describe('lifecycle templates', () => {
  it('escapes what people typed', () => {
    const email = welcomeEmail({ ...recipient, firstName: '<b>Nora</b>', stage: 'new', season: null })
    assert.ok(!email.html.includes('<b>Nora</b>'))
    assert.ok(email.html.includes('&lt;b&gt;Nora&lt;/b&gt;'))
  })

  it('adapts the welcome to where the person is', () => {
    const fresh = welcomeEmail({ ...recipient, stage: 'new', season: null })
    const styled = welcomeEmail({ ...recipient, stage: 'looks', season: 'Warm Autumn' })
    assert.ok(fresh.html.includes('Create my avatar'))
    assert.ok(styled.html.includes('Open my looks'))
    assert.ok(styled.text.includes('Warm Autumn'))
  })

  it('tags links for analytics', () => {
    const url = new URL(appLink('/studio/new', 'looks_nudge', { occasion: 'Date night' }))
    assert.equal(url.searchParams.get('utm_source'), 'email')
    assert.equal(url.searchParams.get('utm_campaign'), 'looks_nudge')
    assert.equal(url.searchParams.get('occasion'), 'Date night')
  })

  it('shows only the colors it was given', () => {
    const colors = [
      { name: 'Olive', hex: '#5B5A2C' },
      { name: 'Rust', hex: '#A0482A' },
      { name: 'Teal', hex: '#1F5C5B' },
    ]
    const email = looksNudgeEmail({ ...recipient, season: 'Warm Autumn', colors })
    assert.ok(email.subject.includes('Warm Autumn'))
    assert.ok(email.html.includes('#A0482A'))
    assert.ok(!email.html.includes('#C9A227'))
  })

  it('always carries an unsubscribe link and a text part', () => {
    for (const email of [
      welcomeEmail({ ...recipient, stage: 'avatar', season: null }),
      upgradeOfferEmail(recipient),
      upgradeReminderEmail({ ...recipient, season: 'Soft Summer', colors: [] }),
      upgradeLastCallEmail(recipient),
    ]) {
      assert.ok(email.html.includes(recipient.unsubscribeUrl))
      assert.ok(email.text.includes(recipient.unsubscribeUrl))
      assert.ok(email.text.length > 200)
    }
  })
})

describe('offer emails', () => {
  it('show the current prices and say how Pro renews', () => {
    const offer = upgradeOfferEmail(recipient)
    assert.ok(offer.html.includes('$59.90/yr'))
    assert.ok(offer.html.includes('$10.90/mo'))
    assert.ok(offer.html.includes('$4.99 a month'))
    assert.ok(offer.text.includes('renews automatically'))
    const reminder = upgradeReminderEmail({ ...recipient, season: 'Soft Summer', colors: [{ name: 'Dusty teal', hex: '#5B8A8A' }] })
    assert.ok(reminder.subject.includes('Soft Summer'))
    assert.ok(reminder.html.includes('$14.90'))
    assert.ok(reminder.html.includes('save $4.90'))
  })

  it('carry the postal address only when it is set', () => {
    // No EMAIL_POSTAL_ADDRESS in tests: the footer has no address line.
    assert.ok(!upgradeOfferEmail(recipient).text.includes('undefined'))
  })
})

describe('unsubscribe tokens', () => {
  it('round-trips and rejects tampering', () => {
    const id = new ObjectId()
    const token = unsubscribeToken(id)
    assert.equal(userIdFromUnsubscribeToken(token)?.toString(), id.toString())
    assert.equal(userIdFromUnsubscribeToken(`${new ObjectId().toString()}.${token.split('.')[1]}`), null)
    assert.equal(userIdFromUnsubscribeToken('garbage'), null)
  })
})
