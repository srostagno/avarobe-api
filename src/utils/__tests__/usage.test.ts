import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../__tests__/fake-app.js'
import { env } from '../../config/env.js'
import { limitMessages } from '../../i18n/limits.js'
import { withLocale } from '../request-locale.js'
import { imageLimitBody, releaseGenerations, remainingGenerations, reserveGenerations, reserveUsage } from '../usage.js'

const today = () => new Date().toISOString().slice(0, 10)

// One person's counters, `image` and the kind's, at what today's counters say.
function setup(counts: Partial<Record<string, number>> = {}, email = 'customer@example.com') {
  const userId = new ObjectId()
  const counters = Object.entries(counts).map(([kind, count]) => ({ _id: `${userId.toString()}:${kind}:${today()}`, userId, kind, day: today(), count }))
  const { app, collection } = fakeApp({ users: [{ _id: userId, email }], usageCounters: counters })
  const count = (kind: string) => (collection('usageCounters').docs.find((doc) => doc._id === `${userId.toString()}:${kind}:${today()}`)?.count as number) ?? 0

  return { app, userId, count }
}

describe('the day’s new pictures', () => {
  const before = { limit: env.AI_DAILY_IMAGE_LIMIT, comp: env.COMP_EMAILS }

  beforeEach(() => {
    env.AI_DAILY_IMAGE_LIMIT = 15
    env.COMP_EMAILS = 'founder@example.com'
  })

  afterEach(() => {
    env.AI_DAILY_IMAGE_LIMIT = before.limit
    env.COMP_EMAILS = before.comp
  })

  it('count every look, hairstyle and avatar render, and come back with the generation', async () => {
    const { app, userId, count } = setup()

    assert.equal(await reserveGenerations(app, userId, 'look', 3), true)
    assert.equal(await reserveGenerations(app, userId, 'hair', 1), true)
    assert.equal(await reserveGenerations(app, userId, 'avatar', 1), true)
    assert.deepEqual([count('look'), count('hair'), count('avatar'), count('image')], [3, 1, 1, 5])

    await releaseGenerations(app, userId, 'look', 3)
    await releaseGenerations(app, userId, 'avatar', 1)
    assert.deepEqual([count('look'), count('avatar'), count('image')], [0, 0, 1])
  })

  it('leave out reads (text) on the way in and out, and piece photos and store searches', async () => {
    const { app, userId, count } = setup()

    assert.equal(await reserveGenerations(app, userId, 'avatar', 1, { image: false }), true)
    assert.equal(await reserveGenerations(app, userId, 'hair', 1, { image: false }), true)
    assert.equal(await reserveGenerations(app, userId, 'pieces', 1), true)
    assert.equal(await reserveGenerations(app, userId, 'shop', 1), true)
    assert.equal(count('image'), 0)

    await releaseGenerations(app, userId, 'avatar', 1, { image: false })
    assert.deepEqual([count('avatar'), count('image')], [0, 0])
  })

  it('stop a look at the cap without touching the look counter, and say so', async () => {
    const { app, userId, count } = setup({ image: 15, look: 2 })
    const result = await reserveUsage(app, userId, 'look', 1)

    assert.deepEqual(result, { ok: false, reason: 'images', left: 0, timeZone: 'America/New_York' })
    assert.deepEqual([count('look'), count('image')], [2, 15])
    // A read still goes.
    assert.equal(await reserveGenerations(app, userId, 'avatar', 1, { image: false }), true)
  })

  it('tell a batch how many still fit', async () => {
    const { app, userId } = setup({ image: 13 })

    assert.deepEqual(await reserveUsage(app, userId, 'look', 3), { ok: false, reason: 'images', left: 2, timeZone: 'America/New_York' })
    assert.match(withLocale('en', () => imageLimitBody(2).message), /You can make 2 more new pictures today/)
    assert.match(withLocale('en', () => imageLimitBody(1).message), /1 more new picture today/)
    assert.equal(imageLimitBody(0).code, 'daily_image_limit')
  })

  it('give the picture back when the kind’s own limit stops it', async () => {
    const { app, userId, count } = setup({ look: env.DAILY_LOOK_LIMIT, image: 4 })
    const result = await reserveUsage(app, userId, 'look', 1)

    assert.deepEqual(result, { ok: false, reason: 'kind', left: 0 })
    assert.equal(count('image'), 4)
  })

  it('reserve color checks on their own', async () => {
    const { app, userId, count } = setup({ image: 14 })

    assert.equal(await reserveGenerations(app, userId, 'image', 1), true)
    assert.equal(await reserveGenerations(app, userId, 'image', 1), false)
    await releaseGenerations(app, userId, 'image', 1)
    assert.equal(count('image'), 14)
    assert.equal(await remainingGenerations(app, userId, 'image'), 1)
  })

  it('don’t hold comp accounts, and count them so releasing stays even', async () => {
    const { app, userId, count } = setup({ image: 15 }, 'founder@example.com')

    assert.equal(await reserveGenerations(app, userId, 'look', 1), true)
    assert.equal(count('image'), 16)
    await releaseGenerations(app, userId, 'look', 1)
    assert.equal(count('image'), 15)
  })

  it('say when more come back on their clock: later today in the Americas’ evening, tomorrow otherwise', () => {
    // 20:00 UTC: 1 PM in California, 5 PM in São Paulo, already 10 PM in Madrid.
    const evening = new Date('2026-10-11T20:00:00Z')

    assert.match(limitMessages('en', 'America/Los_Angeles', evening).images(15, 0), /More from 5:00\sPM today; your looks stay/)
    assert.match(limitMessages('pt-BR', 'America/Sao_Paulo', evening).images(15, 0), /Hoje, a partir das 21:00, tem mais/)
    assert.match(limitMessages('es', 'America/Mexico_City', evening).images(15, 2), /vuelve después de las 6:00\sp\.\s?m\./)
    assert.match(limitMessages('en', 'Europe/Madrid', evening).images(15, 0), /More tomorrow/)
    // A batch that can't be smaller (an event's looks) isn't told to ask for fewer.
    const event = limitMessages('en', 'Europe/Madrid', evening).images(15, 2, 3)
    assert.match(event, /You can make 2 more new pictures today, and this needs 3\. Come back tomorrow; nothing was used\./)
    assert.doesNotMatch(event, /fewer/)
  })

  it('say it in the language of the page', () => {
    assert.match(withLocale('pt-BR', () => imageLimitBody(0).message), /Você já criou 15 imagens novas hoje/)
    assert.match(withLocale('pt-BR', () => imageLimitBody(1).message), /1 imagem nova hoje/)
    assert.match(withLocale('es', () => imageLimitBody(0).message), /Ya creaste 15 imágenes nuevas hoy/)
    assert.match(withLocale('es', () => imageLimitBody(3).message), /3 imágenes nuevas más/)
  })
})
