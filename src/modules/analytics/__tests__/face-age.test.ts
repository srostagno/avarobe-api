import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { proBadge } from '../../admin/pro-badge.js'
import { faceAgeFunnel, isFaceAgePlacement } from '../face-age.js'

const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 16, minute))

type Event = { at: Date; name: string; visitorId: string | null; userId: ObjectId | null; props: Record<string, string | number | boolean> }

describe('Face Age funnel', () => {
  it('follows one person from the ad browser into Safari by their account', () => {
    const user = new ObjectId()
    const rows: Event[] = [
      { at: at(0), name: 'face_age', visitorId: 'ig', userId: null, props: { step: 'landing' } },
      { at: at(1), name: 'face_age', visitorId: 'ig', userId: null, props: { step: 'landing_cta' } },
      { at: at(2), name: 'face_age', visitorId: 'ig', userId: user, props: { step: 'intro' } },
      { at: at(3), name: 'look_started', visitorId: 'ig', userId: user, props: {} },
      { at: at(4), name: 'look_photo_added', visitorId: 'ig', userId: user, props: { source: 'camera' } },
      { at: at(5), name: 'look_photo_read', visitorId: 'ig', userId: user, props: { usable: true } },
      { at: at(6), name: 'look_photo_read', visitorId: 'ig', userId: user, props: { usable: true } },
      // Safari, after the email link.
      { at: at(9), name: 'paywall_viewed', visitorId: 'safari', userId: user, props: { placement: 'face_age_summary' } },
      { at: at(10), name: 'checkout_started', visitorId: 'safari', userId: user, props: { placement: 'face_age_summary' } },
      { at: at(12), name: 'purchase_completed', visitorId: 'ig', userId: user, props: { placement: 'face_age_summary' } },
    ]
    const funnel = faceAgeFunnel(rows, (row) => (row.visitorId === 'ig' ? { channel: 'meta', campaign: 'faceage_us' } : { channel: 'direct', campaign: null }))

    assert.deepEqual(
      funnel.steps.map((step) => [step.id, step.people]),
      [
        ['landing', 1],
        ['landing_cta', 1],
        ['opened', 1],
        ['started', 1],
        ['photo', 1],
        ['read', 1],
        ['again', 1],
        ['offer', 1],
        ['checkout', 1],
        ['paid', 1],
      ],
    )
    assert.equal(funnel.photosRead, 2)
    assert.deepEqual(funnel.sources, [{ channel: 'meta', campaign: 'faceage_us', landing: 1, opened: 1, started: 1, read: 1, offer: 1, paid: 1 }])
  })

  it('leaves out unreadable photos and offers opened elsewhere', () => {
    const user = new ObjectId()
    const rows: Event[] = [
      { at: at(0), name: 'look_photo_read', visitorId: 'a', userId: user, props: { usable: false, problem: 'too_dark' } },
      { at: at(1), name: 'paywall_viewed', visitorId: 'a', userId: user, props: { placement: 'colors_offer' } },
      { at: at(2), name: 'paywall_viewed', visitorId: 'b', userId: null, props: { placement: 'pro_sticky_face_age' } },
    ]
    const funnel = faceAgeFunnel(rows, () => undefined)
    const people = Object.fromEntries(funnel.steps.map((step) => [step.id, step.people]))

    assert.equal(people.read, 0)
    assert.equal(people.offer, 1)
    assert.equal(funnel.unreadable, 1)
    assert.equal(funnel.sources[0]?.channel, 'unknown')
  })

  it('counts someone who came back for another photo in every step before it', () => {
    const user = new ObjectId()
    const funnel = faceAgeFunnel([{ at: at(0), name: 'look_photo_read', visitorId: 'a', userId: user, props: { usable: true } }], () => undefined)
    const people = Object.fromEntries(funnel.steps.map((step) => [step.id, step.people]))

    assert.deepEqual([people.landing, people.opened, people.started, people.photo, people.read, people.again], [0, 1, 1, 1, 1, 0])
  })

  it('knows the offers that open from Face Age', () => {
    assert.equal(isFaceAgePlacement('face_age_summary'), true)
    assert.equal(isFaceAgePlacement('face_age_tips'), true)
    assert.equal(isFaceAgePlacement('pro_sticky_face_age'), true)
    assert.equal(isFaceAgePlacement('pro_sticky_looks'), false)
    assert.equal(isFaceAgePlacement(undefined), false)
  })
})

describe('Pro badge', () => {
  const now = Date.UTC(2026, 9, 16)
  const pro = {
    subscriptionId: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    interval: 'month' as const,
    periodEnd: new Date(now + 20 * 24 * 3600e3),
    cancelAtPeriodEnd: false,
  }

  it('says the plan and whether it runs, cancels, is in its trial or ended', () => {
    assert.equal(proBadge(null, now), null)
    assert.deepEqual(proBadge(pro, now), { plan: 'monthly', state: 'active', until: pro.periodEnd })
    assert.equal(proBadge({ ...pro, interval: 'year' }, now)?.plan, 'annual')
    assert.equal(proBadge({ ...pro, cancelAtPeriodEnd: true }, now)?.state, 'canceling')
    assert.equal(proBadge({ ...pro, status: 'trialing' }, now)?.state, 'trial')
    assert.equal(proBadge({ ...pro, status: 'past_due' }, now)?.state, 'past_due')
    assert.equal(proBadge({ ...pro, status: 'canceled' }, now)?.state, 'ended')
    assert.equal(proBadge({ ...pro, periodEnd: new Date(now - 30 * 24 * 3600e3) }, now)?.state, 'ended')
  })
})
