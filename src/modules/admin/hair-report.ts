import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { adminUserIds, billingState } from '../billing/entitlements.js'

// Is the Hair studio used? Its funnel in the period (opened the page, read
// their hair, saw a cut on them, put one on the avatar, hit an offer, went
// to checkout) and the accounts that used it. Counts and short account
// codes only: no names, emails or images. Admins are left out.

const DAY_MS = 24 * 60 * 60 * 1000
const HAIR_REASONS = ['hair', 'hair_tryon']

export async function hairReport(app: FastifyInstance, days: number) {
  const since = new Date(Date.now() - days * DAY_MS)
  const admins = await adminUserIds(app)
  const adminVisitors = (
    await app.collections.analyticsEvents.distinct('visitorId', { userId: { $in: admins } })
  ).filter((value): value is string => Boolean(value))

  const [avatars, hairstyles, events] = await Promise.all([
    app.collections.avatars
      .find(
        { userId: { $nin: admins }, $or: [{ 'hairProfile.startedAt': { $gte: since } }, { 'versions.source': 'hair' }] },
        { projection: { userId: 1, hairProfile: 1, versions: 1 } },
      )
      .toArray(),
    app.collections.hairstyles
      .find({ userId: { $nin: admins }, createdAt: { $gte: since } }, { projection: { userId: 1, source: 1, status: 1, createdAt: 1 } })
      .toArray(),
    app.collections.analyticsEvents
      .find(
        {
          at: { $gte: since },
          userId: { $nin: admins },
          visitorId: { $nin: adminVisitors },
          $or: [
            { name: 'page_view', path: '/studio/hair' },
            { name: 'paywall_viewed', 'props.reason': { $in: HAIR_REASONS } },
            { name: 'paywall_blocked', 'props.code': 'needs_hair' },
            { name: 'checkout_started', 'props.placement': { $regex: '^hair' } },
            { name: 'upsell_clicked', 'props.stage': 'hair_next' },
          ],
        },
        { projection: { name: 1, visitorId: 1, userId: 1, props: 1 } },
      )
      .toArray(),
  ])

  const person = (event: { visitorId: string | null; userId: ObjectId | null }) =>
    event.visitorId ?? event.userId?.toString() ?? 'anon'
  const peopleWith = (test: (event: (typeof events)[number]) => boolean) => new Set(events.filter(test).map(person)).size

  const reads = avatars.filter((avatar) => avatar.hairProfile && avatar.hairProfile.startedAt >= since)
  const appliedIn = (avatar: (typeof avatars)[number]) =>
    (avatar.versions ?? []).filter((version) => version.source === 'hair' && version.createdAt >= since).length
  const cutsByUser = new Map<string, typeof hairstyles>()

  for (const hairstyle of hairstyles) {
    const key = hairstyle.userId.toString()
    cutsByUser.set(key, [...(cutsByUser.get(key) ?? []), hairstyle])
  }

  const count = (source: string) => hairstyles.filter((item) => item.source === source && item.status !== 'failed').length

  // Everyone who read their hair or has a cut in the period, newest first.
  const accountIds = new Map<string, ObjectId>()

  for (const item of [...reads, ...hairstyles]) {
    accountIds.set(item.userId.toString(), item.userId)
  }

  const users = await app.collections.users
    .find(
      { _id: { $in: [...accountIds.values()] } },
      { projection: { email: 1, credits: 1, colorReportAt: 1, styleReportAt: 1, pro: 1, styleKitUntil: 1, paidAt: 1, freeAvatarRuns: 1, freeHairRuns: 1, compPaused: 1 } },
    )
    .toArray()
  const plans = new Map(
    users.map((user) => {
      const state = billingState(user)
      return [user._id.toString(), state.proActive ? 'pro' : state.styleReport ? 'style_report' : state.paid ? 'paid' : 'free'] as const
    }),
  )
  const avatarByUser = new Map(avatars.map((avatar) => [avatar.userId.toString(), avatar]))

  const accounts = [...accountIds.keys()]
    .map((id) => {
      const avatar = avatarByUser.get(id)
      const cuts = cutsByUser.get(id) ?? []
      const readAt = avatar?.hairProfile?.startedAt ?? null
      const last = [readAt, ...cuts.map((cut) => cut.createdAt)].filter((at): at is Date => Boolean(at))

      return {
        account: id.slice(-6),
        lastAt: new Date(Math.max(...last.map((at) => at.getTime()))).toISOString(),
        read: avatar?.hairProfile?.status ?? null,
        faceShape: avatar?.hairProfile?.data?.faceShape ?? null,
        recommended: cuts.filter((cut) => cut.source === 'recommended' && cut.status !== 'failed').length,
        custom: cuts.filter((cut) => cut.source !== 'recommended' && cut.status !== 'failed').length,
        failed: cuts.filter((cut) => cut.status === 'failed').length,
        onAvatar: avatar ? appliedIn(avatar) > 0 : false,
        plan: plans.get(id) ?? 'free',
      }
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, 50)

  return {
    days,
    funnel: [
      { id: 'opened', label: 'Opened Hair', people: peopleWith((event) => event.name === 'page_view') },
      { id: 'read', label: 'Read their hair', people: reads.length },
      { id: 'read_ready', label: 'Got their read', people: reads.filter((avatar) => avatar.hairProfile?.status === 'ready').length },
      { id: 'cut', label: 'Saw a cut on them', people: new Set(hairstyles.filter((item) => item.status === 'ready').map((item) => item.userId.toString())).size },
      { id: 'applied', label: 'Put one on the avatar', people: avatars.filter((avatar) => appliedIn(avatar) > 0).length },
      { id: 'offer', label: 'Saw a Hair offer', people: peopleWith((event) => event.name === 'paywall_viewed' || event.name === 'paywall_blocked') },
      { id: 'checkout', label: 'Checkout from Hair', people: peopleWith((event) => event.name === 'checkout_started') },
    ],
    cuts: {
      recommended: count('recommended'),
      described: count('described'),
      photo: count('photo'),
      failed: hairstyles.filter((item) => item.status === 'failed').length,
    },
    readsFailed: reads.filter((avatar) => avatar.hairProfile?.status === 'failed').length,
    crossSellClicks: peopleWith((event) => event.name === 'upsell_clicked'),
    accounts,
  }
}

export type HairReport = Awaited<ReturnType<typeof hairReport>>
