import type { AvatarDocument, ColorAnalysis, ColorReport, ColorReadLog, PurchaseDocument, UserDocument } from '../../types/mongo.js'
import { readEntry, withRead } from './reads.js'

// Putting back a buyer's colors and report from the database's own log of
// changes (the oplog), after a read wiped them (11-Oct-2026, before reads
// kept what they had). Pure: scripts/restore-colors.ts reads the log and the
// documents, prints the plan and, only when asked, writes it.

// One oplog entry, parsed as extended JSON (dates as dates). Updates carry
// a v2 diff (o.diff: u updated, i inserted fields); older ones a $set.
export type OplogEntry = {
  op: string
  // The collection ("avarobe.avatars"): entries of any other are ignored.
  ns?: string
  o: Record<string, unknown>
  o2?: { _id?: unknown }
  wall: Date
}

export type RestorePlan = {
  colorAnalysis: ColorAnalysis
  colorsAt: Date
  colorReport: { data: ColorReport; createdAt: Date }
  // The selfie the colors and the report were read from (the first one).
  firstSelfieKey: string | null
  colorsWrittenAt: Date
  reportWrittenAt: Date
  // The first entry that wiped the colors, or --before.
  before: Date
}

function idOf(entry: OplogEntry) {
  const id = (entry.op === 'i' ? entry.o._id : entry.o2?._id) as { toHexString?: () => string } | string | undefined

  return typeof id === 'string' ? id : (id?.toHexString?.() ?? '')
}

// The fields an entry set: the whole document for an insert, the updated
// and inserted fields of a diff, or a $set.
function fieldsOf(entry: OplogEntry): Record<string, unknown> {
  if (entry.op === 'i') {
    return entry.o
  }

  const diff = entry.o.diff as { u?: Record<string, unknown>; i?: Record<string, unknown> } | undefined
  const set = entry.o.$set as Record<string, unknown> | undefined

  return { ...(diff?.i ?? {}), ...(diff?.u ?? {}), ...(set ?? {}) }
}

export function restorePlan(all: OplogEntry[], avatarId: string, before?: Date): RestorePlan | { error: string } {
  const entries = all
    .filter((entry) => (!entry.ns || entry.ns.endsWith('.avatars')) && idOf(entry) === avatarId)
    .sort((a, b) => a.wall.getTime() - b.wall.getTime())

  if (entries.length === 0) {
    return { error: `No entries for avatar ${avatarId} in the log.` }
  }

  let wipedAt: Date | null = null
  let hadColors = false

  for (const entry of entries) {
    const fields = fieldsOf(entry)

    if (fields.colorAnalysis) {
      hadColors = true
    } else if (hadColors && 'colorAnalysis' in fields && fields.colorAnalysis === null) {
      wipedAt = entry.wall
      break
    }
  }

  const cutoff = before ?? wipedAt

  if (!cutoff) {
    return { error: 'The log never sets the colors back to null: pass --before.' }
  }

  const earlier = entries.filter((entry) => entry.wall.getTime() < cutoff.getTime())
  const colorsEntry = earlier.filter((entry) => fieldsOf(entry).colorAnalysis && fieldsOf(entry).colorsAt).at(-1)

  if (!colorsEntry) {
    return { error: `No colors in the log before ${cutoff.toISOString()}.` }
  }

  const reportEntry = earlier.filter((entry) => entry.wall.getTime() >= colorsEntry.wall.getTime() && fieldsOf(entry).colorReport).at(-1)

  if (!reportEntry) {
    return { error: `No report written after the colors (${colorsEntry.wall.toISOString()}) and before ${cutoff.toISOString()}.` }
  }

  const colors = fieldsOf(colorsEntry)
  const report = fieldsOf(reportEntry).colorReport as RestorePlan['colorReport']
  const firstSelfie = entries.map((entry) => fieldsOf(entry).selfieKey).find((key): key is string => typeof key === 'string')

  return {
    colorAnalysis: colors.colorAnalysis as ColorAnalysis,
    colorsAt: colors.colorsAt as Date,
    colorReport: { data: report.data, createdAt: report.createdAt },
    firstSelfieKey: firstSelfie ?? null,
    colorsWrittenAt: colorsEntry.wall,
    reportWrittenAt: reportEntry.wall,
    before: cutoff,
  }
}

const COLOR_PRODUCTS = new Set(['color_report', 'color_addon', 'reports_bundle', 'color_mirror', 'advisors_bundle', 'pro_annual'])

// Why it must not be restored now, if anything: only an avatar the outage
// left failed and empty, nobody waiting for an email of it, a buyer whose
// purchase stands. `sameSeason` (--same-season): also one a later read gave
// colors of the same season again but no report (ready, the report still
// gone), whose paid read and report go back over that read.
export function restoreBlockers(
  avatar: Pick<AvatarDocument, 'status' | 'colorAnalysis' | 'colorReport' | 'job' | 'colorsNotify'>,
  user: Pick<UserDocument, 'colorReportAt' | 'colorMirrorAt'> | null,
  purchases: Pick<PurchaseDocument, 'product' | 'refundedAt'>[],
  sameSeason: string | null = null,
) {
  const blockers: string[] = []
  const notify = avatar.colorsNotify
  const current = avatar.colorAnalysis?.season ?? null

  if (sameSeason) {
    if (avatar.status === 'processing') blockers.push('a read is running')
    if (current && current !== sameSeason) blockers.push(`its colors are ${current}, not ${sameSeason}`)
  } else {
    if (avatar.status !== 'failed') blockers.push(`status is ${avatar.status}, not failed`)
    if (avatar.colorAnalysis) blockers.push(`it has colors (${current}; --same-season restores over colors of the same season)`)
  }

  if (avatar.colorReport) blockers.push('it has a report')
  if (avatar.job) blockers.push('a job is running')
  if (notify && !notify.sentAt && !notify.gaveUpAt) blockers.push('a "tell me when ready" is pending')
  if (!user?.colorReportAt && !user?.colorMirrorAt) blockers.push('the user has no Color Advisor or mirror')

  const colorPurchases = purchases.filter((purchase) => COLOR_PRODUCTS.has(purchase.product))

  if (colorPurchases.length > 0 && colorPurchases.every((purchase) => purchase.refundedAt)) {
    blockers.push('the purchase was refunded')
  }

  return blockers
}

// The one update: guarded by the state the dry run printed (its status and
// colors, no report, the same selfie, and the updatedAt the dry run showed,
// passed back with --expect-updated-at), so nothing that happened since is
// overwritten. The drape test, the free preview and the boards are drawn
// again from her current selfie when she opens the report (`unusedKeys`: the
// files of a preview drawn from the colors replaced, to delete by hand).
export function restoreUpdate(
  avatar: Pick<AvatarDocument, '_id' | 'status' | 'selfieKey' | 'updatedAt' | 'colorReads' | 'colorAnalysis' | 'drapePreview' | 'drape'>,
  plan: RestorePlan,
  now: Date,
  expectedUpdatedAt: Date = avatar.updatedAt,
) {
  const readId = `restored-${plan.colorsWrittenAt.getTime().toString(36)}`
  const entry: ColorReadLog = readEntry({
    id: readId,
    at: now,
    selfieKey: plan.firstSelfieKey ?? avatar.selfieKey,
    method: 'restored',
    outcome: 'restored',
    season: plan.colorAnalysis.season,
    undertone: plan.colorAnalysis.undertone,
    contrast: plan.colorAnalysis.contrast,
    shown: plan.colorAnalysis.season,
  })

  const colors = avatar.colorAnalysis ? { 'colorAnalysis.season': avatar.colorAnalysis.season } : { colorAnalysis: null }

  return {
    filter: { _id: avatar._id, status: avatar.status, ...colors, colorReport: null, selfieKey: avatar.selfieKey, updatedAt: expectedUpdatedAt },
    unusedKeys: [avatar.drapePreview?.key, avatar.drapePreview?.lockedKey, avatar.drape?.key].filter((key): key is string => Boolean(key)),
    set: {
      colorAnalysis: plan.colorAnalysis,
      colorsAt: plan.colorsAt,
      colorReport: plan.colorReport,
      status: 'ready' as const,
      error: null,
      failure: null,
      job: null,
      drape: null,
      drapePreview: null,
      reportBoards: null,
      colorsSource: {
        readId,
        at: plan.colorsAt,
        selfieKey: plan.firstSelfieKey ?? avatar.selfieKey,
        imageHash: null,
        method: 'restored' as const,
        scores: null,
        lighting: null,
      },
      colorReads: withRead(avatar.colorReads, entry),
      updatedAt: now,
    },
  }
}
