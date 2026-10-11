import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { restoreBlockers, restorePlan, restoreUpdate, type OplogEntry } from '../restore.js'

// The buyer restore (scripts/restore-colors.ts) on a log shaped like hers:
// the first read, the report, the wipe, then failed reads of new selfies.

const avatarId = new ObjectId()
const at = (time: string) => new Date(`2026-10-11T${time}Z`)
const update = (time: string, u: Record<string, unknown>, i: Record<string, unknown> = {}): OplogEntry => ({
  op: 'u',
  o: { $v: 2, diff: { u, ...(Object.keys(i).length ? { i } : {}) } },
  o2: { _id: avatarId },
  wall: at(time),
})
const colors = { season: 'Deep Autumn', undertone: 'warm', contrast: 'high', summary: 'x', bestColors: [], neutrals: [], avoidColors: [], metals: 'gold', confidence: 'high', photoNote: null }
const report = { data: { seasonLean: 'Deep Autumn' }, createdAt: at('11:38:38.535') }
const log: OplogEntry[] = [
  { op: 'i', o: { _id: avatarId, selfieKey: 'users/u/selfie-1.jpg', colorAnalysis: null, colorReport: null }, wall: at('11:35:05') },
  update('11:35:11.390', { colorAnalysis: colors, colorsAt: at('11:35:11.358'), status: 'ready', job: null }),
  update('11:38:22', { updatedAt: at('11:38:22') }, { presentation: 'womenswear' }),
  update('11:38:38.690', { colorReport: report, drape: { status: 'processing' } }),
  update('11:51:15.344', { colorAnalysis: null, colorReport: null, colorsAt: null, status: 'processing' }),
  update('11:53:00', { selfieKey: 'users/u/selfie-2.jpg', status: 'processing' }),
  update('11:53:01', { status: 'failed' }),
  // Someone else's avatar in the same file.
  { op: 'u', o: { $v: 2, diff: { u: { colorAnalysis: { ...colors, season: 'Soft Summer' }, colorsAt: at('11:40:00') } } }, o2: { _id: new ObjectId() }, wall: at('11:40:00') },
  // Another collection's document with the same id: never read.
  { op: 'u', ns: 'avarobe.users', o: { $v: 2, diff: { u: { colorAnalysis: { ...colors, season: 'Bright Winter' }, colorsAt: at('11:45:00') } } }, o2: { _id: avatarId }, wall: at('11:45:00') },
]

describe('the buyer restore', () => {
  it('finds the colors and the report from before the wipe', () => {
    const plan = restorePlan(log, avatarId.toString())

    assert.ok(!('error' in plan))
    assert.equal(plan.colorAnalysis.season, 'Deep Autumn')
    assert.deepEqual(plan.colorsAt, at('11:35:11.358'))
    assert.deepEqual(plan.colorReport, report)
    assert.equal(plan.firstSelfieKey, 'users/u/selfie-1.jpg')
    assert.deepEqual(plan.before, at('11:51:15.344'))
  })

  it('takes nothing written at or after --before', () => {
    const plan = restorePlan(log, avatarId.toString(), at('11:38:00'))

    assert.deepEqual(plan, { error: 'No report written after the colors (2026-10-11T11:35:11.390Z) and before 2026-10-11T11:38:00.000Z.' })
  })

  it('stops unless she is a buyer left failed and empty, with nothing pending', () => {
    const wiped = { status: 'failed' as const, colorAnalysis: null, colorReport: null, job: null, colorsNotify: null }
    const buyer = { colorReportAt: at('11:37:33') }
    const paid = [{ product: 'color_report' as const, refundedAt: null }]

    assert.deepEqual(restoreBlockers(wiped, buyer, paid), [])
    assert.deepEqual(restoreBlockers({ ...wiped, status: 'ready' }, buyer, paid), ['status is ready, not failed'])
    assert.deepEqual(restoreBlockers({ ...wiped, status: 'ready', colorAnalysis: colors as never }, buyer, paid), [
      'status is ready, not failed',
      'it has colors (Deep Autumn; --same-season restores over colors of the same season)',
    ])
    assert.deepEqual(restoreBlockers(wiped, {}, paid), ['the user has no Color Advisor or mirror'])
    assert.deepEqual(restoreBlockers(wiped, buyer, [{ product: 'color_report', refundedAt: new Date() }]), ['the purchase was refunded'])
    assert.deepEqual(
      restoreBlockers({ ...wiped, colorsNotify: { requestedAt: new Date(), attempts: 0, lastTriedAt: null, sentAt: null, gaveUpAt: null, via: 'script' } }, buyer, paid),
      ['a "tell me when ready" is pending'],
    )
  })

  it('guards the write with the updatedAt the dry run printed, not one read at apply time', () => {
    const plan = restorePlan(log, avatarId.toString())
    assert.ok(!('error' in plan))
    const current = { _id: avatarId, status: 'failed' as const, selfieKey: 'users/u/selfie-2.jpg', updatedAt: at('12:30:00'), colorReads: null, colorAnalysis: null }
    const { filter } = restoreUpdate(current, plan, new Date(), at('12:08:12'))

    assert.deepEqual(filter.updatedAt, at('12:08:12'))
  })

  it('writes colors and report in one update, guarded by what the dry run saw', () => {
    const plan = restorePlan(log, avatarId.toString())
    assert.ok(!('error' in plan))
    const now = new Date()
    const current = { _id: avatarId, status: 'failed' as const, selfieKey: 'users/u/selfie-2.jpg', updatedAt: at('12:08:12'), colorReads: null, colorAnalysis: null }
    const { filter, set, unusedKeys } = restoreUpdate(current, plan, now)

    assert.deepEqual(filter, { _id: avatarId, status: 'failed', colorAnalysis: null, colorReport: null, selfieKey: 'users/u/selfie-2.jpg', updatedAt: at('12:08:12') })
    assert.deepEqual(unusedKeys, [])
    assert.equal(set.status, 'ready')
    assert.deepEqual(set.colorReport, report)
    assert.equal(set.drapePreview, null)
    assert.equal(set.reportBoards, null)
    assert.equal(set.colorsSource.method, 'restored')
    assert.equal(set.colorsSource.selfieKey, 'users/u/selfie-1.jpg')
    assert.deepEqual(
      set.colorReads.map((read) => [read.outcome, read.season, read.shown]),
      [['restored', 'Deep Autumn', 'Deep Autumn']],
    )
  })
})

describe('the restore over a later read of the same season (--same-season)', () => {
  // A "tell me when ready" retry read her newest selfie at 16:54: Deep Autumn
  // again, a new palette and preview, and no report.
  const reread = { ...colors, summary: 'a later read', bestColors: [{ name: 'Telha', hex: '#A0482A' }] }
  const now = { _id: avatarId, status: 'ready' as const, colorAnalysis: reread as never, colorReport: null, job: null, colorsNotify: { requestedAt: at('16:53:12'), attempts: 0, lastTriedAt: at('16:54:31'), sentAt: at('16:54:37'), gaveUpAt: null, via: 'script' as const } }
  const buyer = { colorReportAt: at('11:37:33') }
  const paid = [{ product: 'color_report' as const, refundedAt: null }]

  it('goes ahead only over colors of the season she paid for, with no report and nothing running', () => {
    assert.deepEqual(restoreBlockers(now, buyer, paid, 'Deep Autumn'), [])
    assert.deepEqual(restoreBlockers(now, buyer, paid, 'Soft Summer'), ['its colors are Deep Autumn, not Soft Summer'])
    assert.deepEqual(restoreBlockers({ ...now, status: 'processing' }, buyer, paid, 'Deep Autumn'), ['a read is running'])
    assert.deepEqual(restoreBlockers({ ...now, colorReport: { createdAt: new Date() } as never }, buyer, paid, 'Deep Autumn'), ['it has a report'])
  })

  it('puts the paid read and report back, guarded by the colors it replaces, and names the preview files left over', () => {
    const plan = restorePlan(log, avatarId.toString())
    assert.ok(!('error' in plan))
    const current = {
      ...now,
      selfieKey: 'users/u/selfie-2.jpg',
      updatedAt: at('16:54:36.672'),
      colorReads: null,
      drapePreview: { status: 'ready' as const, key: 'users/u/drape-preview-9.webp', lockedKey: 'users/u/drape-preview-9-locked.webp' } as never,
      drape: null,
    }
    const { filter, set, unusedKeys } = restoreUpdate(current, plan, new Date(), at('16:54:36.672'))

    assert.deepEqual(filter, {
      _id: avatarId,
      status: 'ready',
      'colorAnalysis.season': 'Deep Autumn',
      colorReport: null,
      selfieKey: 'users/u/selfie-2.jpg',
      updatedAt: at('16:54:36.672'),
    })
    assert.deepEqual(set.colorAnalysis, colors)
    assert.deepEqual(set.colorReport, report)
    assert.equal(set.drapePreview, null)
    assert.deepEqual(unusedKeys, ['users/u/drape-preview-9.webp', 'users/u/drape-preview-9-locked.webp'])
  })
})
