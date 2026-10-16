import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { EmailSendDocument, UserDocument } from '../../../types/mongo.js'
import { clickDestination, clickTarget, countsAsClick, trackContent, trackedLink } from '../service.js'
import { upgradeOfferEmail } from '../templates.js'

const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: `${env.APP_URL}/email/unsubscribe?t=x` }

describe('email tracking', () => {
  it('wraps app links in a signed redirect and adds the open pixel', () => {
    const sendId = new ObjectId()
    const tracked = trackContent(upgradeOfferEmail(recipient), sendId)
    assert.ok(tracked.html.includes(`/api/v1/email/o/${sendId.toString()}.gif`))
    assert.ok(tracked.html.includes(`/api/v1/email/c/${sendId.toString()}?u=`))
    assert.ok(tracked.text.includes(`/api/v1/email/c/${sendId.toString()}?u=`))
    // The unsubscribe link stays direct.
    assert.ok(tracked.html.includes(recipient.unsubscribeUrl))
  })

  it('only follows links it signed, and only to the app', () => {
    const sendId = new ObjectId()
    const target = `${env.APP_URL}/studio?upgrade=look&utm_source=email`
    const link = new URL(trackedLink(sendId, target))
    const signature = link.searchParams.get('s') ?? ''
    assert.equal(clickTarget(sendId.toString(), target, signature), new URL(target).toString())
    assert.equal(clickTarget(sendId.toString(), 'https://evil.example.com/', signature), null)
    assert.equal(clickTarget(new ObjectId().toString(), target, signature), null)
    assert.equal(clickTarget('not-an-id', target, signature), null)
  })
})

// Since Oct 16, 2026 a studio link signs its recipient in when clicked: the
// sign-in token is made then (from Oct 14 they were made at sending, which
// left their clicks uncounted and put some tokens in the redirect's logged
// address).
describe('tracked studio links', () => {
  const saved = env.COMP_EMAILS

  before(() => {
    env.COMP_EMAILS = 'owner@avarobe.test'
  })

  after(() => {
    env.COMP_EMAILS = saved
  })

  const DAY = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 9, 16, 18)

  function flow(user: Partial<UserDocument> = {}, send: Partial<EmailSendDocument> = {}) {
    const rosa = { _id: new ObjectId(), email: 'rosa@example.com', locale: 'pt-BR', createdAt: new Date(now - 30 * DAY), ...user } as UserDocument
    const sendDoc = { _id: new ObjectId(), userId: rosa._id, kind: 'face_age_launch', subject: 'x', sentAt: new Date(now - DAY), opens: 0, clicks: 0, ...send }
    const fake = fakeApp({ users: [rosa], emailSends: [sendDoc] })
    const signed: Doc[] = []
    ;(fake.app as unknown as { jwt: { sign: (payload: Doc) => Promise<string> } }).jwt.sign = async (payload) => {
      signed.push(payload)
      return `token-${signed.length}`
    }
    const click = (target: string) => clickDestination(fake.app, sendDoc._id.toString(), target, now)
    return { click, signed }
  }

  const button = `${env.APP_URL}/pt-br/studio/face-age?utm_source=email&utm_medium=lifecycle&utm_campaign=face_age_launch`

  it('wraps every studio link and tagged link, never one with a token or the unsubscribe link', () => {
    const sendId = new ObjectId()
    const html = [
      `<a href="${env.APP_URL}/studio/report">Untagged studio page</a>`,
      `<a href="${env.APP_URL}/pt-br/color-analysis">Guide</a>`,
      `<a href="${env.APP_URL}/continue?token=abc&amp;utm_source=email">Old sign-in link</a>`,
      `<a href="${env.APP_URL}/email/unsubscribe?t=x">Unsubscribe</a>`,
      '</body>',
    ].join('\n')
    const tracked = trackContent({ subject: 's', html, text: '' }, sendId)
    const hrefs = [...tracked.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, '&'))

    assert.ok(hrefs[0]!.includes(`/api/v1/email/c/${sendId.toString()}?u=`))
    assert.equal(hrefs[1], `${env.APP_URL}/pt-br/color-analysis`)
    assert.equal(hrefs[2], `${env.APP_URL}/continue?token=abc&utm_source=email`)
    assert.equal(hrefs[3], `${env.APP_URL}/email/unsubscribe?t=x`)
  })

  it('counts the email’s buttons, not its footer’s preferences or plan line', () => {
    assert.equal(countsAsClick(button), true)
    assert.equal(countsAsClick(`${env.APP_URL}/studio?buy=color_report&from=colors_home`), true)
    assert.equal(countsAsClick(`${env.APP_URL}/pt-br/studio/account`), false)
    assert.equal(countsAsClick(`${env.APP_URL}/studio/account#plan`), false)
  })

  it('signs a recent recipient in on the page, with the account’s Meta click', async () => {
    const { click, signed } = flow({ acquisition: { visitorId: null, channel: 'meta', source: 'facebook', medium: 'paid', campaign: 'faceage_br', content: null, term: null, landing: '/face-age', fbclid: 'abcd1234' } })
    const landing = await click(button)

    assert.equal(landing, `${env.APP_URL}/pt-br/continue?token=token-1`)
    assert.equal(signed[0]!.nx, '/studio/face-age?utm_source=email&utm_medium=lifecycle&utm_campaign=face_age_launch')
    assert.equal(signed[0]!.typ, 'email')
    assert.deepEqual(signed[0]!.ad, { fbc: `fb.1.${now - 30 * DAY}.abcd1234` })
  })

  it('keeps the ad ids the email was sent with, or none', async () => {
    const kept = flow({}, { ads: { fbc: 'fb.1.1.from_browser' } })
    await kept.click(button)
    assert.deepEqual(kept.signed[0]!.ad, { fbc: 'fb.1.1.from_browser' })

    const none = flow({}, { ads: null })
    await none.click(button)
    assert.equal(none.signed[0]!.ad, undefined)
  })

  it('opens the page as it is for an admin, a deleted account, an old email or a changed password', async () => {
    for (const [why, user, send] of [
      ['admin', { email: 'owner@avarobe.test' }, {}],
      ['deleted', { deletedAt: new Date(now - DAY) }, {}],
      ['old email', {}, { sentAt: new Date(now - 15 * DAY) }],
      ['new password', { passwordUpdatedAt: new Date(now - DAY / 2) }, {}],
    ] as const) {
      const { click, signed } = flow(user, send)
      assert.equal(await click(button), button, why)
      assert.equal(signed.length, 0, why)
    }

    // And any page outside the studio.
    const { click } = flow()
    assert.equal(await click(`${env.APP_URL}/pt-br/color-analysis?utm_source=email`), `${env.APP_URL}/pt-br/color-analysis?utm_source=email`)
  })
})
