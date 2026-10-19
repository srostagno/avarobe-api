import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import type { UserDocument } from '../../../types/mongo.js'
import { isProFirst, serializeBilling } from '../../billing/entitlements.js'
import { grantColorsProOffer } from '../wow-offer.js'

// Pro first (Oct 19, 2026): who came from a colors_pro campaign gets the
// half-price month when she sees her colors, and her offer leads with Pro.

function account(campaign: string | null, extra: Partial<UserDocument> = {}) {
  const userId = new ObjectId()
  const acquisition = campaign
    ? { visitorId: 'v1', channel: 'meta' as const, source: 'meta', medium: 'paid_social', campaign, content: 'colors_grey_e', term: null, landing: '/color-analysis' }
    : null
  const fake = fakeApp({ users: [{ _id: userId, email: 'mia@example.com', credits: 0, createdAt: new Date(), acquisition, ...extra }] })
  const user = () => fake.collection('users').docs[0] as unknown as UserDocument

  return { ...fake, userId, user }
}

describe('Pro first', () => {
  it('gives the half-price month on her colors when she came from a colors_pro campaign, once', async () => {
    const { app, userId, user } = account('colors_pro_au_ca')

    assert.equal(await grantColorsProOffer(app, userId), true)
    assert.equal(user().proHalfOffer?.from, 'colors')
    assert.equal(await grantColorsProOffer(app, userId), false)
    assert.equal(serializeBilling(user()).proFirst, true)
    assert.ok(serializeBilling(user()).proHalfOffer)
  })

  it('leaves everyone else as today', async () => {
    for (const campaign of ['launch_us', 'faceage_au_ca', null]) {
      const { app, userId, user } = account(campaign)

      assert.equal(await grantColorsProOffer(app, userId), false)
      assert.equal(user().proHalfOffer, undefined)
      assert.equal(serializeBilling(user()).proFirst, false)
    }

    assert.equal(isProFirst({ acquisition: null }), false)
  })

  it('never leads with Pro for who already has it', () => {
    const { user } = account('colors_pro_au_ca', {
      pro: { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'active', interval: 'month', periodEnd: new Date(Date.now() + 20 * 86400000), cancelAtPeriodEnd: false },
    })

    assert.equal(serializeBilling(user()).proFirst, false)
  })
})
