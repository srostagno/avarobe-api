import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { env } from '../../../config/env.js'
import { clickTarget, trackContent, trackedLink } from '../service.js'
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
