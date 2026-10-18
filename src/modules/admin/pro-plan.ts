import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import type { TeaserKind } from '../../types/mongo.js'
import { adminUserIds } from '../billing/entitlements.js'

// Admin → Pro plan (Oct 18, 2026): everything built to turn reads into Pro,
// for the days picked, in one place: the teasers (drawn, seen, tapped,
// unlocked and how), the half-price month (given, used), the Pro and $1.99
// payments by where they came from, invites, the teaser emails, the free
// try-on of each Edit, and shares. Admins are left out.

const DAY = 24 * 60 * 60 * 1000
const KINDS: TeaserKind[] = ['perfect_haircut', 'perfect_look', 'best_face']
const OFFER_FROM = ['face_age', 'look_score', 'hair_score', 'edit_try_on', 'color_advisor', 'style_advisor', 'hair_advisor'] as const

type Count = { key: string; count: number }

function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): Count[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const value = key(row)

    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  return [...counts.entries()].map(([value, count]) => ({ key: value, count })).sort((a, b) => b.count - a.count)
}

export async function proPlanReport(app: FastifyInstance, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY)
  const admins = await adminUserIds(app)
  const adminSet = new Set(admins.map((id) => id.toString()))
  const notAdmin = { $nin: admins }

  const [teasers, events, purchases, offered, invitesMade, invited, sends, freeLooks] = await Promise.all([
    app.collections.teasers.find({ createdAt: { $gte: since }, userId: notAdmin }, { projection: { kind: 1, status: 1, unlockedAt: 1, resultId: 1 } }).toArray(),
    app.collections.analyticsEvents
      .find(
        { at: { $gte: since }, name: { $in: ['teaser', 'invite', 'image_shared', 'referral_reward', 'referral_signup'] } },
        { projection: { name: 1, props: 1, userId: 1, visitorId: 1 } },
      )
      .limit(50000)
      .toArray(),
    app.collections.purchases
      .find(
        { createdAt: { $gte: since }, userId: notAdmin, product: { $in: ['pro_monthly', 'pro_annual', 'pro_trial', 'teaser_unlock'] } },
        { projection: { product: 1, placement: 1, amountUsd: 1, refundedAt: 1 } },
      )
      .toArray(),
    app.collections.users.find({ 'proHalfOffer.at': { $gte: since }, _id: notAdmin }, { projection: { proHalfOffer: 1 } }).toArray(),
    app.collections.users.countDocuments({ 'invite.createdAt': { $gte: since }, _id: notAdmin }),
    app.collections.users.find({ 'invitedBy.at': { $gte: since }, _id: notAdmin }, { projection: { invitedBy: 1 } }).toArray(),
    app.collections.emailSends
      .find({ sentAt: { $gte: since }, kind: { $in: ['teaser_ready', 'half_offer_last_call'] }, userId: notAdmin }, { projection: { kind: 1, opens: 1, clicks: 1 } })
      .toArray(),
    app.collections.looks.find({ createdAt: { $gte: since }, freeTryOn: true, userId: notAdmin }, { projection: { freeEditId: 1, status: 1 } }).toArray(),
  ])

  // Events of people who aren't admins, each person once per step.
  const rows = events.filter((row) => !row.userId || !adminSet.has(row.userId.toString()))
  const personOf = (row: { userId: ObjectId | null; visitorId: string | null }) => row.userId?.toString() ?? row.visitorId ?? null
  const people = (filter: (row: (typeof rows)[number]) => boolean) => new Set(rows.filter(filter).map(personOf).filter(Boolean)).size
  const teaserStep = (kind: string, step: string, extra: (props: Record<string, unknown>) => boolean = () => true) =>
    people((row) => row.name === 'teaser' && row.props.kind === kind && row.props.step === step && extra(row.props))
  const paid = purchases.filter((purchase) => !purchase.refundedAt)
  const revenue = (list: typeof paid) => Math.round(list.reduce((sum, purchase) => sum + (purchase.amountUsd ?? 0), 0))
  const pro = paid.filter((purchase) => purchase.product !== 'teaser_unlock')
  const singles = paid.filter((purchase) => purchase.product === 'teaser_unlock')

  return {
    days,
    teasers: KINDS.map((kind) => {
      const mine = teasers.filter((teaser) => teaser.kind === kind)

      return {
        kind,
        drawn: mine.filter((teaser) => teaser.status !== 'failed').length,
        failed: mine.filter((teaser) => teaser.status === 'failed').length,
        shown: teaserStep(kind, 'shown'),
        tappedHalf: teaserStep(kind, 'cta', (props) => props.half === 1 && props.single !== 1),
        tappedPro: teaserStep(kind, 'cta', (props) => props.half !== 1 && props.single !== 1),
        tappedSingle: teaserStep(kind, 'cta', (props) => props.single === 1),
        unlocked: mine.filter((teaser) => teaser.resultId).length,
      }
    }),
    offer: {
      given: offered.length,
      used: offered.filter((user) => user.proHalfOffer?.usedAt).length,
      open: offered.filter((user) => user.proHalfOffer && !user.proHalfOffer.usedAt && user.proHalfOffer.until.getTime() > now.getTime()).length,
      byFrom: OFFER_FROM.map((from) => {
        const list = offered.filter((user) => user.proHalfOffer?.from === from)
        return { key: from, given: list.length, used: list.filter((user) => user.proHalfOffer?.usedAt).length }
      }).filter((row) => row.given > 0),
    },
    pro: {
      count: pro.length,
      revenueUsd: revenue(pro),
      byProduct: countBy(pro, (purchase) => purchase.product),
      byPlacement: countBy(pro, (purchase) => purchase.placement ?? 'unknown'),
    },
    singles: { count: singles.length, revenueUsd: revenue(singles), byPlacement: countBy(singles, (purchase) => purchase.placement ?? 'unknown') },
    invites: {
      links: invitesMade,
      shared: people((row) => row.name === 'invite'),
      friends: invited.length,
      rewarded: invited.filter((user) => user.invitedBy?.rewardedAt).length,
      // Teasers unlocked by a friend's first read.
      unlocks: rows.filter((row) => row.name === 'referral_reward' && row.props.unlocked === true).length,
    },
    emails: (['teaser_ready', 'half_offer_last_call'] as const).map((kind) => {
      const list = sends.filter((send) => send.kind === kind)
      return { kind, sent: list.length, opened: list.filter((send) => send.opens > 0).length, clicked: list.filter((send) => send.clicks > 0).length }
    }),
    freeTryOns: countBy(freeLooks, (look) => look.freeEditId ?? 'icons').map((row) => ({
      ...row,
      ready: freeLooks.filter((look) => (look.freeEditId ?? 'icons') === row.key && look.status === 'ready').length,
    })),
    shares: countBy(
      rows.filter((row) => row.name === 'image_shared'),
      (row) => String(row.props.kind ?? 'other'),
    ),
  }
}
