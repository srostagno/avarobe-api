import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { memoryStorage } from '../../../__tests__/color-reads.js'
import { fakeApp } from '../../../__tests__/fake-app.js'
import type { TeaserDocument } from '../../../types/mongo.js'
import { regionalAmount } from '../pricing.js'
import { grantSession } from '../stripe.js'

// One teaser bought on its own (Oct 18, 2026): the downsell under Pro. The
// payment makes it hers, like unlocking it with Pro, and nothing else.

describe('teaser_unlock', () => {
  let files: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    files = memoryStorage()
  })

  afterEach(() => files.restore())

  function setup() {
    const userId = new ObjectId()
    const teaserId = new ObjectId()
    const checkId = new ObjectId()
    const key = `users/${userId.toString()}/teaser-${teaserId.toString()}-1.webp`
    const lockedKey = key.replace('.webp', '-locked.webp')
    files.files.set(key, Buffer.from('sharp'))
    files.files.set(lockedKey, Buffer.from('blurred'))
    const fake = fakeApp({
      users: [{ _id: userId, email: 'rosa@example.com', credits: 0, createdAt: new Date() }],
      scoreChecks: [{ _id: checkId, userId, kind: 'hair', status: 'ready' }],
      teasers: [
        {
          _id: teaserId,
          userId,
          kind: 'perfect_haircut',
          sourceId: checkId,
          status: 'ready',
          error: null,
          key,
          lockedKey,
          plan: { name: 'Soft collarbone layers', render: 'x', stylistBrief: 'Collarbone.' },
          avatarId: null,
          selfieKey: null,
          unlockedAt: null,
          resultId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const session = {
      id: 'cs_test_teaser',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 199,
      currency: 'usd',
      payment_intent: 'pi_1',
      metadata: { app: 'avarobe', userId: userId.toString(), product: 'teaser_unlock', teaserId: teaserId.toString() },
    } as unknown as Stripe.Checkout.Session

    return { ...fake, session, userId, key, lockedKey }
  }

  it('makes the teaser hers when the payment lands, once', async () => {
    const { app, collection, session, key, lockedKey } = setup()

    await grantSession(app, session)
    await grantSession(app, session)

    const teaser = collection('teasers').docs[0] as TeaserDocument
    assert.ok(teaser.unlockedAt)
    assert.ok(teaser.resultId)
    const hairstyles = collection('hairstyles').docs as { imageKey: string }[]
    assert.equal(hairstyles.length, 1)
    assert.equal(hairstyles[0]?.imageKey, key)
    assert.ok(files.removed.includes(lockedKey))
    assert.equal(collection('purchases').docs.length, 1)
    // No Pro, no credits: only the picture.
    const user = collection('users').docs[0] as { pro?: unknown; credits: number }
    assert.equal(user.pro, undefined)
    assert.equal(user.credits, 0)
  })

  it('costs $1.99 in the US and less where the plans cost less', () => {
    assert.equal(regionalAmount('teaser_unlock', 'us'), 199)
    assert.equal(regionalAmount('teaser_unlock', 'br'), 690)
    assert.equal(regionalAmount('teaser_unlock', 'latam'), 99)
  })
})
