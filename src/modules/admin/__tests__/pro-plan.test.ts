import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { proPlanReport } from '../pro-plan.js'

// Admin → Pro plan (Oct 18, 2026): the teasers, the half-price month, the
// payments they brought, invites, emails and free try-ons, admins left out.

describe('the Pro plan report', () => {
  it('counts each step once per person, and the payments by where they came from', async () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const at = new Date('2026-10-19T12:00:00Z')
    const ana = new ObjectId()
    const rosa = new ObjectId()
    const { app } = fakeApp({
      users: [
        { _id: ana, email: 'ana@example.com', createdAt: at, proHalfOffer: { from: 'hair_score', at, until: new Date('2026-10-21T12:00:00Z'), usedAt: at } },
        { _id: rosa, email: 'rosa@example.com', createdAt: at, invite: { code: 'abcdefgh', createdAt: at, rewards: 0, pending: 0 }, proHalfOffer: { from: 'face_age', at, until: new Date('2026-10-21T12:00:00Z'), usedAt: null } },
      ],
      teasers: [
        { _id: new ObjectId(), userId: ana, kind: 'perfect_haircut', status: 'ready', resultId: new ObjectId(), unlockedAt: at, createdAt: at },
        { _id: new ObjectId(), userId: rosa, kind: 'best_face', status: 'ready', resultId: null, unlockedAt: null, createdAt: at },
      ],
      analyticsEvents: [
        { _id: new ObjectId(), at, name: 'teaser', userId: ana, visitorId: 'v1', props: { kind: 'perfect_haircut', step: 'shown' } },
        { _id: new ObjectId(), at, name: 'teaser', userId: ana, visitorId: 'v1', props: { kind: 'perfect_haircut', step: 'shown' } },
        { _id: new ObjectId(), at, name: 'teaser', userId: ana, visitorId: 'v1', props: { kind: 'perfect_haircut', step: 'cta', half: 1 } },
        { _id: new ObjectId(), at, name: 'teaser', userId: rosa, visitorId: 'v2', props: { kind: 'best_face', step: 'cta', single: 1 } },
      ],
      purchases: [
        { _id: new ObjectId(), userId: ana, product: 'pro_monthly', placement: 'teaser_perfect_haircut_hair_score', amountUsd: 399, createdAt: at },
        { _id: new ObjectId(), userId: rosa, product: 'teaser_unlock', placement: 'single_best_face_face_age', amountUsd: 199, createdAt: at },
      ],
      emailSends: [{ _id: new ObjectId(), userId: rosa, kind: 'teaser_ready', sentAt: at, opens: 1, clicks: 0 }],
      looks: [{ _id: new ObjectId(), userId: rosa, freeTryOn: true, freeEditId: 'zodiac-2026', status: 'ready', createdAt: at }],
    })

    const report = await proPlanReport(app, 7, now)
    const haircut = report.teasers.find((row) => row.kind === 'perfect_haircut')!

    assert.deepEqual({ drawn: haircut.drawn, shown: haircut.shown, tappedHalf: haircut.tappedHalf, unlocked: haircut.unlocked }, { drawn: 1, shown: 1, tappedHalf: 1, unlocked: 1 })
    assert.equal(report.teasers.find((row) => row.kind === 'best_face')!.tappedSingle, 1)
    assert.deepEqual({ given: report.offer.given, used: report.offer.used, open: report.offer.open }, { given: 2, used: 1, open: 1 })
    assert.deepEqual(report.pro.byPlacement, [{ key: 'teaser_perfect_haircut_hair_score', count: 1 }])
    assert.equal(report.singles.count, 1)
    assert.equal(report.invites.links, 1)
    assert.deepEqual(report.emails[0], { kind: 'teaser_ready', sent: 1, opened: 1, clicked: 0 })
    assert.deepEqual(report.freeTryOns, [{ key: 'zodiac-2026', count: 1, ready: 1 }])
  })
})
