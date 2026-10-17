import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { PaywallError, releaseFreeUse, serializeBilling, useFreeUse, usePresetTryOn } from '../entitlements.js'

// The studios' free uses (Oct 17, 2026): each feature its own count, claimed
// atomically, given back on a failure; Pro spends a credit instead.

const pro: ProSubscription = {
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval: 'month',
  periodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  cancelAtPeriodEnd: false,
}

function account(fields: Record<string, unknown> = {}) {
  const userId = new ObjectId()
  const { app, collection } = fakeApp({ users: [{ _id: userId, email: 'customer@example.com', ...fields }] })
  const user = () => collection('users').docs[0] as Record<string, unknown> & { freeUses?: Record<string, number>; credits?: number }

  return { app, userId, user }
}

describe('Free uses of the studios', () => {
  const saved = { score: env.SCORE_FREE_PHOTOS, makeup: env.FREE_MAKEUP_TRY_ONS, hair: env.FREE_HAIR_PRESETS, comp: env.COMP_EMAILS }

  beforeEach(() => {
    env.SCORE_FREE_PHOTOS = 3
    env.FREE_MAKEUP_TRY_ONS = 1
    env.FREE_HAIR_PRESETS = 1
    env.COMP_EMAILS = ''
  })

  afterEach(() => {
    Object.assign(env, { SCORE_FREE_PHOTOS: saved.score, FREE_MAKEUP_TRY_ONS: saved.makeup, FREE_HAIR_PRESETS: saved.hair, COMP_EMAILS: saved.comp })
  })

  it('counts each feature on its own, up to its limit', async () => {
    const { app, userId, user } = account()

    assert.equal(await useFreeUse(app, userId, 'makeup'), true)
    assert.equal(await useFreeUse(app, userId, 'makeup'), false)
    assert.equal(await useFreeUse(app, userId, 'look_score'), true)
    assert.equal(await useFreeUse(app, userId, 'look_score'), true)
    assert.equal(await useFreeUse(app, userId, 'look_score'), true)
    assert.equal(await useFreeUse(app, userId, 'look_score'), false)
    assert.deepEqual(user().freeUses, { makeup: 1, look_score: 3 })
    assert.deepEqual(serializeBilling(user() as never).freeLeft, { look_score: 0, hair_score: 3, makeup: 0, hair_preset: 1 })
  })

  it('gives one back, never below zero', async () => {
    const { app, userId, user } = account({ freeUses: { hair_preset: 1 } })

    await releaseFreeUse(app, userId, 'hair_preset')
    await releaseFreeUse(app, userId, 'hair_preset')
    assert.equal(user().freeUses?.hair_preset, 0)
  })

  it('tries a preset free once, then shows the Pro offer', async () => {
    const { app, userId } = account({ credits: 2 })

    assert.deepEqual(await usePresetTryOn(app, userId, 'makeup', 'Trying on makeup'), { creditSpent: false, freeUse: true })
    await assert.rejects(usePresetTryOn(app, userId, 'makeup', 'Trying on makeup'), (error: unknown) => {
      assert.ok(error instanceof PaywallError)
      assert.equal(error.code, 'needs_pro')
      return true
    })
  })

  it('spends a credit with Pro, and leaves her free ones alone', async () => {
    const { app, userId, user } = account({ pro, credits: 30 })

    assert.deepEqual(await usePresetTryOn(app, userId, 'hair_preset', 'Trying more hairstyles'), { creditSpent: true, freeUse: false })
    assert.equal(user().credits, 29)
    assert.equal(user().freeUses, undefined)
    assert.equal(serializeBilling(user() as never).freeLeft, null)
  })
})
