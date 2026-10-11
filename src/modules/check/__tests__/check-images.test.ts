import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { runCheck } from '../service.js'

const today = () => new Date().toISOString().slice(0, 10)

describe('a color check that draws nothing', () => {
  it('gives the day’s picture back', async () => {
    const userId = new ObjectId()
    const checkId = new ObjectId()
    const counter = `${userId.toString()}:image:${today()}`
    const { app, collection } = fakeApp({
      colorChecks: [{ _id: checkId, userId, status: 'processing', garmentKey: `users/${userId.toString()}/check-missing.jpg`, deep: false }],
      // Colors read, but the garment photo is gone: the check fails.
      avatars: [{ _id: new ObjectId(), userId, colorAnalysis: { season: 'Warm Autumn', bestColors: [] } }],
      usageCounters: [{ _id: counter, userId, kind: 'image', day: today(), count: 3 }],
    })

    await runCheck(app, checkId)

    assert.equal(collection('colorChecks').docs[0]?.status, 'failed')
    assert.equal(collection('usageCounters').docs[0]?.count, 2)
  })
})
