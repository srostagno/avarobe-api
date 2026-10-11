import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../__tests__/fake-app.js'
import { failStaleJobs } from '../stale-jobs.js'

const today = () => new Date().toISOString().slice(0, 10)

describe('renders interrupted by a restart', () => {
  it('give back the Pro month’s avatar change and the day’s render and picture', async () => {
    const userId = new ObjectId()
    const counter = (kind: string) => `${userId.toString()}:${kind}:${today()}`
    const { app, collection } = fakeApp({
      users: [{ _id: userId, email: 'customer@example.com', pro: { subscriptionId: 'sub_1', status: 'active', avatarRuns: 5 } }],
      avatars: [
        {
          _id: new ObjectId(),
          userId,
          status: 'processing',
          avatarKey: 'avatar.webp',
          job: { kind: 'refine', startedAt: new Date(Date.now() - 20 * 60 * 1000), previewKey: null, previewCount: 0, avatarRun: 'pro' },
          updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      ],
      usageCounters: [
        { _id: counter('avatar'), userId, kind: 'avatar', day: today(), count: 2 },
        { _id: counter('image'), userId, kind: 'image', day: today(), count: 3 },
      ],
    })

    await failStaleJobs(app)

    const avatar = collection('avatars').docs[0] as { status: string; job: unknown }
    const user = collection('users').docs[0] as { pro: { avatarRuns: number } }
    const count = (kind: string) => collection('usageCounters').docs.find((doc) => doc._id === counter(kind))?.count

    assert.deepEqual([avatar.status, avatar.job], ['ready', null])
    assert.equal(user.pro.avatarRuns, 4)
    assert.deepEqual([count('avatar'), count('image')], [1, 2])
  })
})
