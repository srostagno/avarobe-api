import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { LifecycleEmailKind } from '../../../types/mongo.js'
import { addDays, emailActivity, pacificDay, pacificStart } from '../email-activity.js'

const send = (kind: LifecycleEmailKind, sentAt: string, opens = 0, clicks = 0) => ({ kind, sentAt: new Date(sentAt), opens, clicks })

describe('email activity', () => {
  it('starts a Pacific day at its midnight, in daylight and in standard time', () => {
    assert.equal(pacificStart('2026-10-07').toISOString(), '2026-10-07T07:00:00.000Z')
    assert.equal(pacificStart('2026-12-01').toISOString(), '2026-12-01T08:00:00.000Z')
    assert.equal(pacificDay(new Date('2026-10-08T06:59:00Z')), '2026-10-07')
    assert.equal(addDays('2026-10-30', 3), '2026-11-02')
    assert.equal(addDays('2026-10-07', -6), '2026-10-01')
  })

  it('counts each day of the range, quiet days included, by the Pacific day an email went out', () => {
    const report = emailActivity(
      [
        // Oct 6, 23:30 in California: still Oct 6 there.
        send('welcome', '2026-10-07T06:30:00Z', 1, 0),
        send('welcome', '2026-10-07T18:00:00Z', 2, 1),
        send('xsell_style', '2026-10-07T19:00:00Z', 0, 0),
        // Outside the range.
        send('welcome', '2026-10-09T18:00:00Z', 1, 1),
      ],
      '2026-10-06',
      '2026-10-08',
      ['welcome', 'xsell_style'],
    )

    assert.deepEqual(
      report.daily.map((day) => [day.day, day.sent, day.opened, day.clicked]),
      [
        ['2026-10-06', 1, 1, 0],
        ['2026-10-07', 2, 1, 1],
        ['2026-10-08', 0, 0, 0],
      ],
    )
    assert.deepEqual(report.totals, { sent: 3, opened: 2, clicked: 1, clicks: 1 })
  })

  it('splits by kind in the given order, counting emails opened and clicked, not events', () => {
    const report = emailActivity(
      [
        send('xsell_style', '2026-10-07T18:00:00Z', 3, 2),
        send('welcome', '2026-10-07T18:00:00Z', 1, 0),
        send('welcome', '2026-10-07T19:00:00Z', 0, 0),
        send('checkout_rescue', '2026-10-07T20:00:00Z', 0, 0),
      ],
      '2026-10-07',
      '2026-10-07',
      ['welcome', 'xsell_style'],
    )

    assert.deepEqual(
      report.kinds.map((row) => [row.kind, row.sent, row.opened, row.clicked, row.clicks]),
      [
        ['welcome', 2, 1, 0, 0],
        ['xsell_style', 1, 1, 1, 2],
        // Not in the order: last.
        ['checkout_rescue', 1, 0, 0, 0],
      ],
    )
  })
})
