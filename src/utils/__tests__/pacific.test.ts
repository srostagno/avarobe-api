import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { addDays, daysBetween, pacificDay, pacificStart } from '../pacific.js'

describe('Pacific days', () => {
  it('counts the days in a range, both ends included', () => {
    assert.equal(daysBetween('2026-10-09', '2026-10-09'), 1)
    assert.equal(daysBetween('2026-10-03', '2026-10-09'), 7)
    // Across the change to standard time (Nov 1).
    assert.equal(daysBetween('2026-10-31', '2026-11-02'), 3)
  })

  it('starts each day at Pacific midnight', () => {
    assert.equal(pacificStart('2026-10-09').toISOString(), '2026-10-09T07:00:00.000Z')
    assert.equal(pacificDay(new Date('2026-10-10T06:59:00Z')), '2026-10-09')
    assert.equal(addDays('2026-10-09', 1), '2026-10-10')
  })
})
