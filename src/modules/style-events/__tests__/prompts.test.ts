import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildEventNotes, describeDay } from '../prompts.js'

describe('event brief', () => {
  it('names the day of the event', () => {
    assert.equal(describeDay('2026-10-10'), 'Saturday, October 10, 2026')
    assert.equal(describeDay('2026-13-40'), null)
  })

  it('adds the budget and the day to their notes', () => {
    const notes = buildEventNotes({ notes: 'Garden wedding, I hate heels', budget: 'save', date: '2026-10-10' })
    assert.match(notes, /^Garden wedding, I hate heels /)
    assert.match(notes, /affordable/)
    assert.match(notes, /Saturday, October 10, 2026/)
    assert.doesNotMatch(buildEventNotes({ notes: null, budget: 'splurge', date: null }), /The event is on/)
  })
})
