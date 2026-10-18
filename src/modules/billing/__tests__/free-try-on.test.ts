import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { costumeFor } from '../../looks/edits.js'
import { buildTryOnRenderPrompt } from '../../looks/prompts.js'
import { PaywallError, billingState, releaseFreeTryOn, serializeBilling, useTryOn } from '../entitlements.js'

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
  const user = () => collection('users').docs[0] as Record<string, unknown> & { freeTryOns?: number; freeEditTryOns?: string[]; credits?: number }

  return { app, userId, user }
}

describe('A free try-on of a collection look', () => {
  const before = { free: env.FREE_TRY_ONS, comp: env.COMP_EMAILS }

  beforeEach(() => {
    env.FREE_TRY_ONS = 1
    env.COMP_EMAILS = ''
  })

  afterEach(() => {
    env.FREE_TRY_ONS = before.free
    env.COMP_EMAILS = before.comp
  })

  it('lets anyone without Pro try one on, then shows the Pro offer', async () => {
    const { app, userId, user } = account({ credits: 1 })

    assert.deepEqual(await useTryOn(app, userId, 'Trying on outfits'), { free: true, creditSpent: false, freeEditId: null })
    assert.equal(user().freeTryOns, 1)
    assert.equal(user().credits, 1)
    assert.equal(billingState(user() as never).freeTryOnsLeft, 0)

    await assert.rejects(useTryOn(app, userId, 'Trying on outfits'), (error: unknown) => {
      assert.ok(error instanceof PaywallError)
      assert.equal(error.code, 'needs_pro')
      return true
    })
  })

  it('gives it back when the try-on fails on our side', async () => {
    const { app, userId, user } = account({ freeTryOns: 1 })

    await releaseFreeTryOn(app, userId)
    assert.equal(user().freeTryOns, 0)
    assert.equal(serializeBilling(user() as never).freeTryOnsLeft, 1)
  })

  it('gives one free look of each Edit, apart from the icon looks', async () => {
    const { app, userId, user } = account({ freeTryOns: 1 })

    assert.deepEqual(await useTryOn(app, userId, 'Trying on outfits', 'halloween-2026'), { free: true, creditSpent: false, freeEditId: 'halloween-2026' })
    assert.equal((await useTryOn(app, userId, 'Trying on outfits', 'zodiac-2026')).free, true)
    await assert.rejects(useTryOn(app, userId, 'Trying on outfits', 'halloween-2026'), PaywallError)
    assert.deepEqual(user().freeEditTryOns, ['halloween-2026', 'zodiac-2026'])

    // A failed render gives that Edit's back.
    await releaseFreeTryOn(app, userId, 'halloween-2026')
    assert.deepEqual(user().freeEditTryOns, ['zodiac-2026'])
    assert.equal((await useTryOn(app, userId, 'Trying on outfits', 'halloween-2026')).free, true)
  })

  it('spends a look on Pro and leaves the free one alone', async () => {
    const { app, userId, user } = account({ pro, credits: 30 })

    assert.deepEqual(await useTryOn(app, userId, 'Trying on outfits'), { free: false, creditSpent: true, freeEditId: null })
    assert.equal(user().credits, 29)
    assert.equal(user().freeTryOns, undefined)
    assert.equal(billingState(user() as never).freeTryOnsLeft, null)
  })
})

describe('A costume try-on', () => {
  const plan = {
    title: 'La Catrina',
    summary: '',
    items: [{ slot: 'accessory', name: 'Marigold flower crown', color: 'Marigold and red', colorHex: '#E8891C', material: 'Silk flowers', fit: 'Crown', fromPhoto: true }],
  } as never

  it('is drawn at night in its own scene, with its face paint', () => {
    const costume = costumeFor('hw-catrina')
    assert.ok(costume?.makeup?.includes('sugar-skull'))

    const prompt = buildTryOnRenderPrompt(plan, costume)
    assert.match(prompt, /Halloween night/)
    assert.match(prompt, /sugar-skull/)
    assert.doesNotMatch(prompt, /studio backdrop/)
  })

  it('leaves every other look in the studio', () => {
    assert.equal(costumeFor('fall-pumpkin-patch'), null)
    assert.equal(costumeFor(null), null)
    assert.match(buildTryOnRenderPrompt(plan, null), /studio backdrop/)
  })
})
