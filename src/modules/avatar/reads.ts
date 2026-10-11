import { createHash } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type {
  AvatarDocument,
  ColorAnalysis,
  ColorCandidate,
  ColorReadLog,
  ColorsFailure,
  ColorsSource,
} from '../../types/mongo.js'
import { billingState, loadBillingUser } from '../billing/entitlements.js'
import { COLOR_BOARDS, boardKeys } from '../report/boards.js'
import type { ColorDecision } from './decide.js'

// A color read's lifecycle. A read never deletes anything before it
// succeeds: a new selfie waits in job.selfieKey, a successful read writes
// everything in one update guarded by its id, and only then do the files it
// replaced go. A failed read keeps the colors someone had (status 'ready',
// the failure in `failure`). A buyer's colors never change by themselves: a
// read that clearly differs waits as a candidate she chooses about.

export const MAX_READS = 12

export function imageHash(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function newReadId() {
  return new ObjectId().toHexString()
}

// A read starting: nothing is cleared. POST /avatar/colors and the retries
// for "tell me when ready" (retry.ts).
export function colorsReadStart(now: Date, read: { readId: string; selfieKey: string }) {
  return {
    status: 'processing' as const,
    error: null,
    failure: null,
    job: { kind: 'colors' as const, startedAt: now, previewKey: null, previewCount: 0, readId: read.readId, selfieKey: read.selfieKey },
    updatedAt: now,
  }
}

// The history, newest first, kept to the last 12.
export function withRead(reads: ColorReadLog[] | null | undefined, entry: ColorReadLog) {
  return [entry, ...(reads ?? [])].slice(0, MAX_READS)
}

export function readEntry(
  fields: Pick<ColorReadLog, 'id' | 'at' | 'selfieKey' | 'method' | 'outcome'> & Partial<ColorReadLog>,
): ColorReadLog {
  return {
    imageHash: null,
    season: null,
    undertone: null,
    contrast: null,
    scores: null,
    lighting: null,
    margin: null,
    lead: null,
    shown: null,
    ...fields,
  }
}

type BillingUser = Parameters<typeof billingState>[0]

// A buyer: someone with colors and the Color Advisor (a purchase, the
// mirror, Pro, a trial, an admin's comp, a guest who paid) or a report
// already written from these colors (the Hair Advisor's hair board too).
export function isColorsLocked(user: BillingUser | null, avatar: { colorAnalysis: unknown; colorReport?: unknown }) {
  return Boolean(avatar.colorAnalysis) && (Boolean(user && billingState(user).colorReport) || Boolean(avatar.colorReport))
}

export async function colorsLocked(app: FastifyInstance, avatar: Pick<AvatarDocument, 'userId' | 'colorAnalysis' | 'colorReport'>) {
  return isColorsLocked(await loadBillingUser(app, avatar.userId), avatar)
}

type KeyFields = Partial<Pick<AvatarDocument, 'selfieKey' | 'job' | 'colorCandidate' | 'drapePreview' | 'drape' | 'reportBoards'>>

function colorKeys(doc: KeyFields) {
  return [
    doc.selfieKey,
    doc.job?.selfieKey,
    doc.colorCandidate?.selfieKey,
    doc.drapePreview?.key,
    doc.drapePreview?.lockedKey,
    doc.drape?.key,
    ...boardKeys(doc.reportBoards, COLOR_BOARDS),
  ].filter((key): key is string => Boolean(key))
}

// The files a colors write leaves behind: the selfies, previews, drape and
// color boards the document pointed to before and doesn't after.
export function replacedKeys(before: KeyFields, after: KeyFields) {
  const kept = new Set(colorKeys(after))

  return [...new Set(colorKeys(before))].filter((key) => !kept.has(key))
}

export type SettledRead = {
  set: Record<string, unknown>
  // The document as the update leaves it.
  after: AvatarDocument
  // The selfie moved to the photo read: haircuts drawn from the old one go.
  selfieMoved: boolean
}

// What a successful read writes, in one update:
// - first / changed (not a buyer): the new colors, and the photo becomes
//   their selfie (its free preview drawn again);
// - confirmed / anchored (not a buyer): the colors stay; the photo becomes
//   their selfie and the colors' source, so it's recognized next time;
// - candidate (a buyer, clearly different): waits for her choice; nothing
//   about her colors changes;
// - confirmed / anchored (a buyer): nothing about her colors changes.
// 'avatar': the read that runs with an avatar render (its selfie switched
// at upload; the render's own update sets the status).
export function settleRead(
  before: AvatarDocument,
  input: {
    readId: string
    photoKey: string
    // Whether the photo read isn't the one the free preview was drawn from
    // (a new selfie, in the avatar path switched already).
    newPhoto: boolean
    locked: boolean
    decision: ColorDecision
    analysis: ColorAnalysis | null
    source: ColorsSource
    entry: ColorReadLog
    now: Date
    mode: 'colors' | 'avatar'
  },
): SettledRead {
  const { decision, now } = input
  const set: Record<string, unknown> = {
    colorReads: withRead(before.colorReads, input.entry),
    failure: null,
    ...(input.mode === 'colors' ? { status: 'ready', error: null, job: null, updatedAt: now } : {}),
  }
  const adopt = () => {
    set.selfieKey = input.photoKey
    set.colorsSource = input.source

    if (input.newPhoto) {
      set.drapePreview = null
      set.hairProfile = null
    }
  }

  if ((decision.outcome === 'first' || decision.outcome === 'changed') && input.analysis) {
    adopt()
    set.colorAnalysis = input.analysis
    set.colorsAt = now
    set.drapePreview = null
    set.colorCandidate = null
  } else if (decision.outcome === 'candidate' && input.analysis) {
    const candidate: ColorCandidate = { readId: input.readId, at: now, selfieKey: input.photoKey, analysis: input.analysis, source: input.source }
    set.colorCandidate = candidate
  } else if (!input.locked) {
    adopt()
    set.colorCandidate = null
  } else {
    set.colorCandidate = null
  }

  const after: AvatarDocument = { ...before, ...set }

  return { set, after, selfieMoved: after.selfieKey !== before.selfieKey }
}

// What a failed read writes: with colors, they stay and the avatar is ready
// (the failure kept for the web's notice); without, it's failed as before,
// and the photo read becomes their selfie, so a retry reads the newest one.
export function settleFailedRead(
  before: AvatarDocument,
  input: {
    photoKey: string
    failure: ColorsFailure
    entry: ColorReadLog
    now: Date
    // failureFor('colors'): the status and message of a read with nothing kept.
    failed: { status: 'failed'; error: string }
  },
): SettledRead & { kept: boolean } {
  const kept = Boolean(before.colorAnalysis)
  const set: Record<string, unknown> = kept
    ? { status: 'ready', error: null }
    : {
        ...input.failed,
        ...(input.photoKey !== before.selfieKey ? { selfieKey: input.photoKey, hairProfile: null } : {}),
      }

  Object.assign(set, { job: null, failure: input.failure, colorReads: withRead(before.colorReads, input.entry), updatedAt: input.now })

  const after: AvatarDocument = { ...before, ...set }

  return { set, after, selfieMoved: after.selfieKey !== before.selfieKey, kept }
}
