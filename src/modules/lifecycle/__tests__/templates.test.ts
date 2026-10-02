import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { env } from '../../../config/env.js'
import { emailImageUrl, emailImageUser, unsubscribeToken, userIdFromUnsubscribeToken } from '../service.js'
import {
  appLink,
  avatarNudgeEmail,
  checkoutRescueEmail,
  looksNudgeEmail,
  priceDropEmail,
  trialEndingEmail,
  trialStartedEmail,
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

describe('colors first', () => {
  it('welcomes people who came for their colors with their colors, not the measurements', () => {
    const fresh = welcomeEmail({ ...recipient, stage: 'new', season: null, focus: 'colors' })
    assert.ok(fresh.html.includes('mode=colors'))
    assert.ok(!fresh.text.includes('height and build'))
    const read = welcomeEmail({ ...recipient, stage: 'new', season: 'Light Spring', focus: 'colors' })
    assert.ok(read.text.includes('You’re a Light Spring'))
    // Once there's an avatar, the usual welcome.
    assert.ok(welcomeEmail({ ...recipient, stage: 'avatar', season: 'Light Spring', focus: 'colors' }).text.includes('first occasion'))
  })

  it('asks them for the selfie their colors come from', () => {
    const nudge = avatarNudgeEmail({ ...recipient, focus: 'colors' })
    assert.ok(nudge.subject.includes('colors'))
    assert.ok(nudge.html.includes('mode=colors'))
    assert.ok(!nudge.text.includes('height and build'))
  })
})

// Runs a test with the trial on or off (PRO_TRIAL), whatever the default.
function withTrial(on: boolean, run: () => void) {
  return () => {
    const before = env.PRO_TRIAL
    env.PRO_TRIAL = on

    try {
      run()
    } finally {
      env.PRO_TRIAL = before
    }
  }
}

const COLORS = [
  { name: 'Peach', hex: '#F4B183' },
  { name: 'Warm coral', hex: '#F08070' },
  { name: 'Light aqua', hex: '#7FD1C7' },
]

describe('offer emails, trial off: the Color Advisor leads', () => {
  it(
    'lead the palette offer with the report, once, and Pro monthly after it, with no trial',
    withTrial(false, () => {
      const offer = upgradeOfferEmail({ ...recipient, palette: { season: 'Light Spring', colors: COLORS } })
      assert.ok(offer.subject.includes('Light Spring'))
      assert.ok(offer.html.includes('upgrade=palette'))
      assert.ok(offer.text.includes('$4.99, once'))
      assert.ok(offer.html.indexOf('$4.99') < offer.html.indexOf('$7.99/mo'))
      assert.ok(!offer.text.includes('$1.00'))
      assert.ok(!/trial/i.test(offer.text))
      assert.ok(offer.text.includes('Pro renews monthly until you cancel'))
    }),
  )

  it(
    'keep Pro first for people who came for looks, with the report as the one-time option',
    withTrial(false, () => {
      const offer = upgradeOfferEmail(recipient)
      assert.ok(offer.text.includes('$7.99 a month'))
      assert.ok(offer.text.includes('$4.99'))
      assert.ok(!/trial|\$1\.00/i.test(offer.text))
    }),
  )

  it(
    'put the report first in the reminder and the last call',
    withTrial(false, () => {
      const reminder = upgradeReminderEmail({ ...recipient, season: 'Soft Summer', colors: [{ name: 'Dusty teal', hex: '#5B8A8A' }] })
      assert.ok(reminder.text.indexOf('Color Advisor') < reminder.text.indexOf('Avarobe Pro'))
      assert.ok(!/trial|\$1\.00/i.test(reminder.text))
      const last = upgradeLastCallEmail(recipient)
      assert.ok(last.html.includes('upgrade=palette'))
      assert.ok(last.text.includes('$4.99, once'))
      assert.ok(!/trial|\$1\.00/i.test(last.text))
    }),
  )
})

describe('price drop email', () => {
  const photo = 'https://api.avarobe.com/api/v1/email/i/abc.jpg?e=1&s=sig'
  const url = 'https://www.avarobe.com/continue?token=t&utm_source=email&utm_medium=lifecycle&utm_campaign=price_drop'

  it('lead with their own photo and the new price, once, without an old price to compare', () => {
    const email = priceDropEmail({ ...recipient, season: 'Light Spring', colors: COLORS, heroUrl: photo, url })
    assert.equal(email.subject, `Your Color Advisor is now $${(env.PRICE_COLOR_REPORT_CENTS / 100).toFixed(2)}`)
    assert.ok(email.html.includes(photo.replace(/&/g, '&amp;')))
    assert.ok(email.text.includes('blurred half of your photo'))
    assert.ok(email.text.includes('$4.99, once'))
    assert.ok(email.text.includes('no subscription'))
    assert.ok(email.html.includes('Light Spring'))
    assert.ok(email.html.includes(url.replace(/&/g, '&amp;')))
    assert.ok(!email.text.includes('$14.90'))
  })

  it('fall back to the report picture when there is no photo', () => {
    const email = priceDropEmail({ ...recipient, season: null, colors: [], heroUrl: null, url })
    assert.ok(email.html.includes('/email/color-report.jpg'))
    assert.ok(!email.text.includes('blurred half'))
    assert.ok(!email.text.includes('Your season'))
  })
})

describe('email photo links', () => {
  it('work for two weeks, and only for the account they were signed for', () => {
    const id = new ObjectId()
    const now = new Date('2026-10-02T12:00:00Z')
    const link = new URL(emailImageUrl(id, now))
    const file = link.pathname.split('/').pop() ?? ''
    const expires = link.searchParams.get('e') ?? ''
    const signature = link.searchParams.get('s') ?? ''

    assert.equal(emailImageUser(file, expires, signature, now)?.toString(), id.toString())
    assert.equal(emailImageUser(file, expires, signature, new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)), null)
    assert.equal(emailImageUser(`${new ObjectId().toString()}.jpg`, expires, signature, now), null)
    assert.equal(emailImageUser(file, String(Number(expires) + 60), signature, now), null)
  })
})

describe('checkout rescue email', () => {
  it('names what they were buying and links to finish in their own browser', () => {
    const url = 'https://www.avarobe.com/continue?token=abc'
    const report = checkoutRescueEmail({ ...recipient, product: 'color_report', url })
    assert.equal(report.subject, 'Your Color Advisor is one step away')
    assert.ok(report.html.includes(url))
    assert.ok(report.text.includes('Apple Pay'))
    assert.ok(report.text.includes('expires in 3 days'))
    assert.equal(checkoutRescueEmail({ ...recipient, product: 'look_pack', url }).subject, 'Your looks are one step away')
    assert.equal(checkoutRescueEmail({ ...recipient, product: 'pro_monthly', url }).subject, 'Your Avarobe Pro is one step away')
    assert.equal(checkoutRescueEmail({ ...recipient, product: 'color_mirror', url }).subject, 'Your color mirror is one step away')
  })
})

describe('offer emails, trial on', () => {
  it('lead with the trial, say how it renews, and keep the one-time options', withTrial(true, () => {
    const offer = upgradeOfferEmail(recipient)
    assert.ok(offer.subject.includes('7 days for $1.00'))
    // The trial first, then what to pay once.
    for (const price of ['$1.00', '$7.99 a month', '$4.99']) {
      assert.ok(offer.html.includes(price), price)
    }
    assert.ok(offer.html.indexOf('7 days for $1.00') < offer.html.indexOf('Color Advisor'))
    assert.ok(offer.text.includes("you won't be charged again"))
    const reminder = upgradeReminderEmail({ ...recipient, season: 'Soft Summer', colors: [{ name: 'Dusty teal', hex: '#5B8A8A' }] })
    assert.ok(reminder.subject.includes('Soft Summer'))
    assert.ok(reminder.html.includes('$4.99'))
    assert.ok(reminder.html.includes('$1.00'))
  }))

  it('say the trial price once, with how to cancel', withTrial(true, () => {
    const text = upgradeOfferEmail(recipient).text

    assert.equal(text.split('$1.00 today').length - 1, 0)
    assert.ok(text.includes("you won't be charged again"))
  }))

  it('lead with their palette for people who came for their colors and made no look', withTrial(true, () => {
    const colors = COLORS
    const offer = upgradeOfferEmail({ ...recipient, palette: { season: 'Light Spring', colors } })

    assert.ok(offer.subject.includes('Light Spring'))
    assert.ok(offer.html.includes('#F08070'))
    assert.ok(offer.text.includes('Peach'))
    assert.ok(!offer.text.includes('free look'))
    assert.ok(offer.html.includes('upgrade=palette'))
    for (const price of ['$1.00', '$7.99 a month', '$4.99']) {
      assert.ok(offer.html.includes(price), price)
    }
  }))

  it('carry the postal address only when it is set', () => {
    // No EMAIL_POSTAL_ADDRESS in tests: the footer has no address line.
    assert.ok(!upgradeOfferEmail(recipient).text.includes('undefined'))
  })
})

describe('trial notices', () => {
  const trialEnd = new Date('2026-10-07T15:00:00Z')

  it('state what was paid, when it renews, for how much and how to cancel', () => {
    const started = trialStartedEmail({ ...recipient, trialEnd })
    assert.ok(started.text.includes('Today you paid $1.00'))
    assert.ok(started.text.includes('Wednesday, October 7'))
    assert.ok(started.text.includes('$7.99 a month'))
    assert.ok(started.text.includes('/studio/account#plan'))
    const ending = trialEndingEmail({ ...recipient, trialEnd, looksLeft: 1 })
    assert.ok(ending.subject.includes('Wednesday, October 7'))
    assert.ok(ending.text.includes("you won't be charged"))
    assert.ok(ending.text.includes('You still have 1 look to use.'))
  })

  it('are transactional: no postal address, even when it is set', () => {
    assert.ok(!trialStartedEmail({ ...recipient, trialEnd }).text.includes('Baggot'))
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
