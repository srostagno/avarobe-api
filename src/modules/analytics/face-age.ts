import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { AnalyticsChannel, AnalyticsEventDocument } from '../../types/mongo.js'
import { proIsLive } from '../billing/entitlements.js'

// Face Age in the admin's analytics (Silvio, Oct 16, 2026: "how many have
// used it?"): its own funnel for the days picked, from its landing page to
// Pro, by where people came from; and where it stands overall, from the
// accounts and their photos.

type Row = Pick<AnalyticsEventDocument, 'at' | 'name' | 'visitorId' | 'userId' | 'props'>
type Touch = { channel: AnalyticsChannel | 'unknown'; campaign: string | null } | undefined

// The offers opened from Face Age: its summary and tips, and the Pro bar on
// its page.
export const isFaceAgePlacement = (placement: unknown) =>
  typeof placement === 'string' && (placement.startsWith('face_age') || placement === 'pro_sticky_face_age')

export const FACE_AGE_STEPS = [
  { id: 'landing', label: 'Saw its page (/face-age)' },
  { id: 'landing_cta', label: 'Tapped “See my face age”' },
  { id: 'opened', label: 'Opened Face Age in the studio' },
  { id: 'started', label: 'Signed the release' },
  { id: 'photo', label: 'Added a photo' },
  { id: 'read', label: 'Got their face age' },
  { id: 'again', label: 'Got 2 or more reads' },
  { id: 'offer', label: 'Saw Pro from Face Age' },
  { id: 'checkout', label: 'Opened checkout' },
  { id: 'paid', label: 'Paid' },
] as const

type StepId = (typeof FACE_AGE_STEPS)[number]['id']

const FACE_STEPS: Record<string, StepId> = { landing: 'landing', landing_cta: 'landing_cta', intro: 'opened', started: 'started' }

const usable = (row: Row) => row.props.usable === true || row.props.usable === 'true'

function stepOf(row: Row): StepId | null {
  switch (row.name) {
    case 'face_age':
      return FACE_STEPS[String(row.props.step)] ?? null
    case 'look_started':
      return 'started'
    case 'look_photo_added':
      return 'photo'
    case 'look_photo_read':
      return usable(row) ? 'read' : null
    case 'paywall_viewed':
      return isFaceAgePlacement(row.props.placement) ? 'offer' : null
    case 'checkout_started':
      return isFaceAgePlacement(row.props.placement) ? 'checkout' : null
    case 'purchase_completed':
      return isFaceAgePlacement(row.props.placement) ? 'paid' : null
    default:
      return null
  }
}

// The funnel, people counted once per step. A person is their account once
// one shows up (the browser they came in on and the one they verified their
// email in, Safari after Instagram, are the same person), else the browser.
export function faceAgeFunnel<R extends Row>(rows: R[], touchOf: (row: R) => Touch) {
  const userOfVisitor = new Map<string, string>()

  for (const row of rows) {
    if (row.userId && row.visitorId && !userOfVisitor.has(row.visitorId)) {
      userOfVisitor.set(row.visitorId, row.userId.toString())
    }
  }

  const personOf = (row: R) => row.userId?.toString() ?? (row.visitorId ? (userOfVisitor.get(row.visitorId) ?? `v:${row.visitorId}`) : null)
  const steps = new Map<StepId, Set<string>>(FACE_AGE_STEPS.map((step) => [step.id, new Set<string>()]))
  const reads = new Map<string, number>()
  const sourceOf = new Map<string, string>()
  let photosRead = 0
  let unreadable = 0

  for (const row of rows) {
    const step = stepOf(row)
    const person = personOf(row)

    if (row.name === 'look_photo_read') {
      if (usable(row)) photosRead += 1
      else unreadable += 1
    }

    if (!step || !person) {
      continue
    }

    steps.get(step)!.add(person)

    if (step === 'read') {
      reads.set(person, (reads.get(person) ?? 0) + 1)
    }

    if (!sourceOf.has(person)) {
      const touch = touchOf(row)
      sourceOf.set(person, `${touch?.channel ?? 'unknown'}|${touch?.campaign ?? ''}`)
    }
  }

  for (const [person, count] of reads) {
    if (count >= 2) steps.get('again')!.add(person)
  }

  // Each step counts who reached it: someone who came back to add a photo
  // signed the release on an earlier day, and paying went through the
  // offer. Everyone in the studio's steps opened Face Age, and a tap on
  // the landing's button means they saw it.
  const include = (into: StepId, ...from: StepId[]) => {
    for (const step of from) for (const person of steps.get(step)!) steps.get(into)!.add(person)
  }
  include('read', 'again')
  include('photo', 'read')
  include('started', 'photo')
  include('checkout', 'paid')
  include('offer', 'checkout')
  include('opened', 'started', 'offer')
  include('landing', 'landing_cta')

  // Where they came from (first touch), and how far each source gets.
  const SOURCE_STEPS = ['landing', 'opened', 'started', 'read', 'offer', 'paid'] as const
  const sources = new Map<string, Record<(typeof SOURCE_STEPS)[number], number>>()

  for (const [person, key] of sourceOf) {
    const entry = sources.get(key) ?? { landing: 0, opened: 0, started: 0, read: 0, offer: 0, paid: 0 }

    for (const step of SOURCE_STEPS) {
      if (steps.get(step)!.has(person)) entry[step] += 1
    }

    sources.set(key, entry)
  }

  return {
    steps: FACE_AGE_STEPS.map((step) => ({ id: step.id, label: step.label, people: steps.get(step.id)!.size })),
    photosRead,
    unreadable,
    sources: [...sources.entries()]
      .map(([key, entry]) => {
        const [channel, campaign] = key.split('|')
        return { channel: channel ?? 'unknown', campaign: campaign || null, ...entry }
      })
      .sort((a, b) => b.started - a.started || b.landing - a.landing || b.opened - a.opened),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

// Where Face Age stands now, all time: the accounts that signed its release
// (admins and deleted accounts left out), how many got a read, came back
// for more, read a photo in the last week, keep reminders on, gave their
// birth date, have Pro; and the Pro sales opened from it.
export async function faceAgeTotals(app: FastifyInstance, admins: ObjectId[], now = Date.now()) {
  const users = await app.collections.users
    .find(
      { lookGreat: { $type: 'object' }, _id: { $nin: admins }, deletedAt: null },
      { projection: { 'lookGreat.reminder': 1, 'lookGreat.birthDate': 1, pro: 1, guest: 1 } },
    )
    .toArray()
  const ids = users.map((user) => user._id)
  const [reads, unreadable, sales] = await Promise.all([
    app.collections.faceChecks
      .aggregate<{ _id: ObjectId; reads: number; lastAt: Date }>([
        { $match: { userId: { $in: ids }, status: 'ready', 'reading.usable': true } },
        { $group: { _id: '$userId', reads: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
      ])
      .toArray(),
    app.collections.faceChecks.countDocuments({ userId: { $in: ids }, $or: [{ status: 'failed' }, { 'reading.usable': false }] }),
    app.collections.purchases
      .find(
        { placement: { $regex: /^(face_age|pro_sticky_face_age$)/ }, refundedAt: null, userId: { $nin: admins } },
        { projection: { amountTotal: 1, amountUsd: 1 } },
      )
      .toArray(),
  ])

  return {
    started: users.length,
    // Still a guest: never gave an email.
    guests: users.filter((user) => user.guest).length,
    withRead: reads.length,
    twoOrMore: reads.filter((row) => row.reads >= 2).length,
    lastWeek: reads.filter((row) => row.lastAt.getTime() > now - 7 * DAY_MS).length,
    photosRead: reads.reduce((sum, row) => sum + row.reads, 0),
    unreadable,
    reminders: users.filter((user) => user.lookGreat?.reminder && user.lookGreat.reminder !== 'off').length,
    birthDate: users.filter((user) => Boolean(user.lookGreat?.birthDate)).length,
    pro: users.filter((user) => proIsLive(user.pro ?? null, now)).length,
    sales: sales.length,
    // US cents.
    revenue: sales.reduce((sum, sale) => sum + (sale.amountUsd ?? sale.amountTotal), 0),
  }
}

export type FaceAgeFunnel = ReturnType<typeof faceAgeFunnel>
