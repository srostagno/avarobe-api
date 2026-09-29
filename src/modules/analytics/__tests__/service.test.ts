import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { acquisitionSchema, toAcquisition, trackSchema } from '../service.js'

describe('first-party analytics input', () => {
  it('cleans campaign tags instead of rejecting them (a sign-up carries them)', () => {
    const parsed = acquisitionSchema.parse({
      visitorId: '3f2b1c9e-8a4d-4f6b-9c2e-1a2b3c4d5e6f',
      channel: 'meta',
      source: 'facebook',
      campaign: 'launch_us<script>',
      content: 'turnheads_a%20v2',
      landing: 'https://evil.example/',
      gclid: 'not a click id!',
    })
    const acquisition = toAcquisition(parsed)

    assert.equal(acquisition?.campaign, 'launch_usscript')
    assert.equal(acquisition?.content, 'turnheads_a20v2')
    assert.equal(acquisition?.landing, null)
    assert.equal(acquisition?.gclid, null)
  })

  it('keeps Google click ids and the landing path', () => {
    const acquisition = toAcquisition(
      acquisitionSchema.parse({ channel: 'google', gclid: 'Cj0KCQjw-abc_123', landing: '/color-analysis' }),
    )

    assert.equal(acquisition?.gclid, 'Cj0KCQjw-abc_123')
    assert.equal(acquisition?.landing, '/color-analysis')
    assert.equal(acquisition?.visitorId, null)
  })

  it('drops an unreadable first touch but keeps the events', () => {
    const parsed = trackSchema.parse({
      visitorId: '3f2b1c9e-8a4d-4f6b-9c2e-1a2b3c4d5e6f',
      sessionId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      firstTouch: { channel: 'tiktok' },
      events: [{ name: 'page_view', path: '/' }],
    })

    assert.equal(parsed.firstTouch, undefined)
    assert.equal(parsed.events.length, 1)
  })

  it('rejects event names that are not snake_case codes', () => {
    const result = trackSchema.safeParse({
      visitorId: '3f2b1c9e-8a4d-4f6b-9c2e-1a2b3c4d5e6f',
      sessionId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      events: [{ name: 'Signed Up!' }],
    })

    assert.equal(result.success, false)
  })
})
