import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import { storage } from '../../../utils/storage.js'
import { runCheck } from '../service.js'

const today = () => new Date().toISOString().slice(0, 10)

// A check whose picture is never drawn, with the day's images at 3.
function setup(garmentKey: string) {
  const userId = new ObjectId()
  const checkId = new ObjectId()
  const counter = `${userId.toString()}:image:${today()}`
  const { app, collection } = fakeApp({
    colorChecks: [{ _id: checkId, userId, status: 'processing', garmentKey, deep: false }],
    avatars: [{ _id: new ObjectId(), userId, selfieKey: 'selfie.jpg', colorAnalysis: { season: 'Warm Autumn', undertone: 'warm', contrast: 'medium', metals: 'gold', bestColors: [], neutrals: [], avoidColors: [] } }],
    usageCounters: [{ _id: counter, userId, kind: 'image', day: today(), count: 3 }],
  })

  return { app, checkId, check: () => collection('colorChecks').docs[0], images: () => collection('usageCounters').docs[0]?.count }
}

describe('a color check that draws nothing', () => {
  const saved = { read: storage.read.bind(storage), fetch: globalThis.fetch, key: env.OPENAI_API_KEY, fault: env.AI_FAULT }

  afterEach(() => {
    storage.read = saved.read
    globalThis.fetch = saved.fetch
    env.OPENAI_API_KEY = saved.key
    env.AI_FAULT = saved.fault
  })

  it('gives the day’s picture back when it fails', async () => {
    // Colors read, but the garment photo is gone: the check fails.
    const { app, checkId, check, images } = setup(`users/${new ObjectId().toString()}/check-missing.jpg`)

    await runCheck(app, checkId)

    assert.equal(check()?.status, 'failed')
    assert.equal(images(), 2)
  })

  it('gives it back when the photo is too unclear to read (a reading, no picture)', async () => {
    const { app, checkId, check, images } = setup('garment.jpg')
    const calls: string[] = []

    storage.read = async () => Buffer.from('garment')
    env.OPENAI_API_KEY = 'sk-test-not-a-key'
    env.AI_FAULT = undefined
    globalThis.fetch = async (url: string | URL | Request) => {
      const target = url instanceof Request ? url.url : url.toString()
      calls.push(target)

      return new Response(JSON.stringify({ output_text: JSON.stringify({ verdict: 'unclear', color: null, summary: 'Too dark to read.' }) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await runCheck(app, checkId)

    assert.equal(check()?.status, 'ready')
    assert.equal((check()?.reading as { verdict?: string } | undefined)?.verdict, 'unclear')
    assert.equal(images(), 2)
    // Only the reading: no picture was asked for.
    assert.equal(calls.length, 1)
    assert.ok(calls[0]?.endsWith('/responses'), calls[0])
  })
})
