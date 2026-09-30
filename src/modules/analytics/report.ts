import type { FastifyInstance } from 'fastify'
import type { Filter } from 'mongodb'

import type { AnalyticsChannel, AnalyticsEventDocument, UserLocation } from '../../types/mongo.js'
import { adminUserIds } from '../billing/entitlements.js'
import { parseGeo } from './geo.js'

// The admin's analytics: the funnel step by step, where people come from,
// which offers they see and what happens next, checkouts per product, pages
// and the latest events. People are counted once per step (a visitor, or a
// user when the server saw them before their browser did). Admins and the
// browsers they used are left out.

const DAY_MS = 24 * 60 * 60 * 1000

export const FUNNEL = [
  { id: 'visited', label: 'Visited', names: ['page_view'] },
  { id: 'signup_viewed', label: 'Opened sign-up', names: ['signup_viewed'] },
  { id: 'signed_up', label: 'Signed up', names: ['signup_completed'] },
  // Colors first sends the selfie before the avatar: either counts.
  { id: 'avatar_started', label: 'Sent a selfie', names: ['avatar_started', 'colors_started'] },
  { id: 'colors_ready', label: 'Saw their colors', names: ['colors_ready', 'avatar_ready'] },
  { id: 'avatar_ready', label: 'Avatar ready', names: ['avatar_ready'] },
  { id: 'look_requested', label: 'Asked for looks', names: ['look_requested'] },
  { id: 'looks_styled', label: 'Got looks', names: ['looks_styled'] },
  { id: 'offer_seen', label: 'Saw an offer', names: ['paywall_viewed', 'paywall_blocked'] },
  { id: 'checkout', label: 'Opened checkout', names: ['checkout_started', 'checkout_created'] },
  { id: 'paid', label: 'Paid', names: ['purchase_completed'] },
] as const

type Row = Pick<AnalyticsEventDocument, 'at' | 'name' | 'origin' | 'visitorId' | 'userId' | 'path' | 'props' | 'channel' | 'campaign' | 'content' | 'geo'>

type Tally = { events: number; people: Set<string> }

const str = (value: unknown) => (typeof value === 'string' && value ? value : 'unknown')
const num = (value: unknown) => (typeof value === 'number' ? value : 0)

function tally(map: Map<string, Tally>, key: string, person: string) {
  const entry = map.get(key) ?? { events: 0, people: new Set<string>() }
  entry.events += 1
  entry.people.add(person)
  map.set(key, entry)
}

// A US state by its code ("TX"), anywhere else by its country ("CL").
function stateKey(location: Pick<UserLocation, 'country' | 'region'> | null | undefined) {
  if (!location) {
    return 'unknown'
  }

  return location.country === 'US' ? (location.region ?? 'US') : location.country
}

// "2026-09-28" in Pacific time, the ad account's day.
function pacificDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date)
}

export async function analyticsReport(app: FastifyInstance, input: { days: number; channel: AnalyticsChannel | 'all' }) {
  const since = new Date(Date.now() - input.days * DAY_MS)
  const admins = await adminUserIds(app)
  const adminVisitors = (
    await app.collections.analyticsEvents.distinct('visitorId', { userId: { $in: admins } })
  ).filter((value): value is string => Boolean(value))

  const filter: Filter<AnalyticsEventDocument> = {
    at: { $gte: since },
    userId: { $nin: admins },
    visitorId: { $nin: adminVisitors },
  }

  const rows = (await app.collections.analyticsEvents
    .find(filter, {
      projection: { at: 1, name: 1, origin: 1, visitorId: 1, userId: 1, path: 1, props: 1, channel: 1, campaign: 1, content: 1, geo: 1 },
      sort: { at: 1 },
    })
    .limit(200_000)
    .toArray()) as Row[]

  // One person per visitor; server-only events find their visitor through
  // the same user's browser events.
  const visitorOfUser = new Map<string, string>()

  for (const row of rows) {
    if (row.userId && row.visitorId && !visitorOfUser.has(row.userId.toString())) {
      visitorOfUser.set(row.userId.toString(), row.visitorId)
    }
  }

  const personOf = (row: Row) =>
    row.visitorId ?? (row.userId ? (visitorOfUser.get(row.userId.toString()) ?? `u:${row.userId.toString()}`) : 'anon')

  // Each person's first touch: the first channel/campaign seen for them.
  const touch = new Map<string, { channel: AnalyticsChannel | 'unknown'; campaign: string | null; content: string | null }>()

  for (const row of rows) {
    const person = personOf(row)

    if (!touch.has(person) && row.channel) {
      touch.set(person, { channel: row.channel, campaign: row.campaign, content: row.content })
    }
  }

  const inChannel = (person: string) => input.channel === 'all' || touch.get(person)?.channel === input.channel
  const scoped = rows.filter((row) => inChannel(personOf(row)))

  // The funnel.
  const stepPeople = FUNNEL.map(() => new Set<string>())

  for (const row of scoped) {
    FUNNEL.forEach((step, index) => {
      if ((step.names as readonly string[]).includes(row.name)) {
        stepPeople[index]!.add(personOf(row))
      }
    })
  }

  const funnel = FUNNEL.map((step, index) => ({
    id: step.id,
    label: step.label,
    people: stepPeople[index]!.size,
  }))

  // Where people come from (first touch), and how far each source gets.
  type Source = { channel: string; campaign: string; content: string; people: Set<string>; signups: Set<string>; looks: Set<string>; offers: Set<string>; checkouts: Set<string>; payers: Set<string>; revenue: number }
  const sources = new Map<string, Source>()

  for (const row of rows) {
    const person = personOf(row)
    const first = touch.get(person)
    const channel = first?.channel ?? 'unknown'

    if (input.channel !== 'all' && channel !== input.channel) {
      continue
    }

    const key = `${channel}|${first?.campaign ?? ''}|${first?.content ?? ''}`
    const source = sources.get(key) ?? {
      channel,
      campaign: first?.campaign ?? '',
      content: first?.content ?? '',
      people: new Set<string>(),
      signups: new Set<string>(),
      looks: new Set<string>(),
      offers: new Set<string>(),
      checkouts: new Set<string>(),
      payers: new Set<string>(),
      revenue: 0,
    }
    source.people.add(person)

    if (row.name === 'signup_completed') source.signups.add(person)
    if (row.name === 'looks_styled') source.looks.add(person)
    if (row.name === 'paywall_viewed' || row.name === 'paywall_blocked') source.offers.add(person)
    if (row.name === 'checkout_started' || row.name === 'checkout_created') source.checkouts.add(person)
    if (row.name === 'purchase_completed') {
      source.payers.add(person)
      source.revenue += num(row.props.amount)
    }

    sources.set(key, source)
  }

  // Offers: each one shown (reason and placement), closed, taken to checkout
  // and paid. A payment counts for the placement of that person's latest
  // checkout before it.
  const offers = new Map<string, { reason: string; placement: string; views: Tally; closed: Tally; checkouts: Tally; paid: Tally }>()
  const offerKey = (reason: string, placement: string) => `${reason}|${placement}`
  const offer = (reason: string, placement: string) => {
    const key = offerKey(reason, placement)
    const entry = offers.get(key) ?? {
      reason,
      placement,
      views: { events: 0, people: new Set<string>() },
      closed: { events: 0, people: new Set<string>() },
      checkouts: { events: 0, people: new Set<string>() },
      paid: { events: 0, people: new Set<string>() },
    }
    offers.set(key, entry)
    return entry
  }
  const lastCheckout = new Map<string, { reason: string; placement: string }>()
  const lastOfferReason = new Map<string, Map<string, string>>()
  const blocked = new Map<string, Tally>()

  for (const row of scoped) {
    const person = personOf(row)

    if (row.name === 'paywall_viewed') {
      const reason = str(row.props.reason)
      const placement = str(row.props.placement)
      const entry = offer(reason, placement)
      entry.views.events += 1
      entry.views.people.add(person)
      const reasons = lastOfferReason.get(person) ?? new Map<string, string>()
      reasons.set(placement, reason)
      lastOfferReason.set(person, reasons)
    } else if (row.name === 'paywall_closed') {
      const entry = offer(str(row.props.reason), str(row.props.placement))
      entry.closed.events += 1
      entry.closed.people.add(person)
    } else if (row.name === 'checkout_started') {
      const placement = str(row.props.placement)
      const reason = lastOfferReason.get(person)?.get(placement) ?? 'unknown'
      const entry = offer(reason, placement)
      entry.checkouts.events += 1
      entry.checkouts.people.add(person)
      lastCheckout.set(person, { reason, placement })
    } else if (row.name === 'purchase_completed') {
      const last = lastCheckout.get(person) ?? { reason: 'unknown', placement: 'unknown' }
      const entry = offer(last.reason, last.placement)
      entry.paid.events += 1
      entry.paid.people.add(person)
    } else if (row.name === 'paywall_blocked') {
      tally(blocked, `${str(row.props.code)}|${str(row.props.route)}`, person)
    }
  }

  // Checkouts per product: the click in the offer, the session Stripe opened,
  // cancelled on the way back, and paid.
  const products = new Map<string, { started: Tally; created: Tally; cancelled: Tally; paid: Tally; revenue: number }>()
  const product = (id: string) => {
    const entry = products.get(id) ?? {
      started: { events: 0, people: new Set<string>() },
      created: { events: 0, people: new Set<string>() },
      cancelled: { events: 0, people: new Set<string>() },
      paid: { events: 0, people: new Set<string>() },
      revenue: 0,
    }
    products.set(id, entry)
    return entry
  }

  for (const row of scoped) {
    const person = personOf(row)
    const id = str(row.props.product)
    const bump = (entry: Tally) => {
      entry.events += 1
      entry.people.add(person)
    }

    if (row.name === 'checkout_started') bump(product(id).started)
    else if (row.name === 'checkout_created') bump(product(id).created)
    else if (row.name === 'checkout_cancelled') bump(product(id).cancelled)
    else if (row.name === 'purchase_completed') {
      const entry = product(id)
      bump(entry.paid)
      entry.revenue += num(row.props.amount)
    }
  }

  // Pages and days.
  const pages = new Map<string, Tally>()
  const days = new Map<string, { visitors: Set<string>; signups: Set<string>; checkouts: Set<string>; payers: Set<string> }>()

  for (const row of scoped) {
    const person = personOf(row)
    const day = pacificDay(row.at)
    const entry = days.get(day) ?? { visitors: new Set<string>(), signups: new Set<string>(), checkouts: new Set<string>(), payers: new Set<string>() }

    if (row.name === 'page_view') {
      tally(pages, row.path ?? 'unknown', person)
      entry.visitors.add(person)
    }
    if (row.name === 'signup_completed') entry.signups.add(person)
    if (row.name === 'checkout_started' || row.name === 'checkout_created') entry.checkouts.add(person)
    if (row.name === 'purchase_completed') entry.payers.add(person)

    days.set(day, entry)
  }

  // Everything else people did (store clicks, feedback, reports...).
  const events = new Map<string, Tally>()

  for (const row of scoped) {
    tally(events, row.name, personOf(row))
  }

  // Where people sign up from (the state saved on the account) and how far
  // they get; visitors per state come from the events that carry it.
  const signups = await app.collections.users
    .find(
      {
        _id: { $nin: admins },
        createdAt: { $gte: since },
        ...(input.channel === 'all' ? {} : { 'acquisition.channel': input.channel }),
      },
      { projection: { location: 1, paidAt: 1, colorReportAt: 1, styleReportAt: 1, pro: 1, styleKitUntil: 1 } },
    )
    .toArray()
  const signupIds = signups.map((user) => user._id)
  const [avatarUsers, lookUsers] = await Promise.all([
    app.collections.avatars.distinct('userId', {
      userId: { $in: signupIds },
      $or: [{ status: 'ready' }, { readyAt: { $type: 'date' } }],
    }),
    app.collections.looks.distinct('userId', { userId: { $in: signupIds }, status: { $ne: 'locked' } }),
  ])
  const withAvatar = new Set(avatarUsers.map(String))
  const withLooks = new Set(lookUsers.map(String))
  const states = new Map<string, { visitors: Set<string>; signups: number; avatars: number; looks: number; payers: number }>()
  const state = (key: string) => {
    const entry = states.get(key) ?? { visitors: new Set<string>(), signups: 0, avatars: 0, looks: 0, payers: 0 }
    states.set(key, entry)
    return entry
  }

  for (const user of signups) {
    const entry = state(stateKey(user.location))
    const id = user._id.toString()
    entry.signups += 1
    if (withAvatar.has(id)) entry.avatars += 1
    if (withLooks.has(id)) entry.looks += 1
    if (user.paidAt || user.colorReportAt || user.styleReportAt || user.pro || user.styleKitUntil) entry.payers += 1
  }

  for (const row of scoped) {
    const geo = row.name === 'page_view' ? parseGeo(row.geo) : null

    if (geo) {
      state(stateKey(geo)).visitors.add(personOf(row))
    }
  }

  const people = (entry: Tally) => ({ events: entry.events, people: entry.people.size })

  return {
    days: input.days,
    channel: input.channel,
    funnel,
    sources: [...sources.values()]
      .map((source) => ({
        channel: source.channel,
        campaign: source.campaign || null,
        content: source.content || null,
        people: source.people.size,
        signups: source.signups.size,
        looks: source.looks.size,
        offers: source.offers.size,
        checkouts: source.checkouts.size,
        payers: source.payers.size,
        revenue: source.revenue,
      }))
      .sort((a, b) => b.people - a.people),
    offers: [...offers.values()]
      .map((entry) => ({
        reason: entry.reason,
        placement: entry.placement,
        views: people(entry.views),
        closed: people(entry.closed),
        checkouts: people(entry.checkouts),
        paid: people(entry.paid),
      }))
      .sort((a, b) => b.views.events - a.views.events || b.checkouts.events - a.checkouts.events),
    blocked: [...blocked.entries()]
      .map(([key, entry]) => {
        const [code, route] = key.split('|')
        return { code: code ?? 'unknown', route: route ?? 'unknown', ...people(entry) }
      })
      .sort((a, b) => b.events - a.events),
    products: [...products.entries()]
      .map(([id, entry]) => ({
        product: id,
        started: people(entry.started),
        created: people(entry.created),
        cancelled: people(entry.cancelled),
        paid: people(entry.paid),
        revenue: entry.revenue,
      }))
      .sort((a, b) => b.started.events + b.created.events - (a.started.events + a.created.events)),
    pages: [...pages.entries()]
      .map(([path, entry]) => ({ path, ...people(entry) }))
      .sort((a, b) => b.people - a.people)
      .slice(0, 20),
    daily: [...days.entries()]
      .map(([day, entry]) => ({
        day,
        visitors: entry.visitors.size,
        signups: entry.signups.size,
        checkouts: entry.checkouts.size,
        payers: entry.payers.size,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    events: [...events.entries()].map(([name, entry]) => ({ name, ...people(entry) })).sort((a, b) => b.events - a.events),
    states: [...states.entries()]
      .map(([key, entry]) => ({
        state: key,
        visitors: entry.visitors.size,
        signups: entry.signups,
        avatars: entry.avatars,
        looks: entry.looks,
        payers: entry.payers,
      }))
      .sort((a, b) => b.signups - a.signups || b.visitors - a.visitors),
    recent: scoped
      .slice(-80)
      .reverse()
      .map((row) => ({
        at: row.at.toISOString(),
        name: row.name,
        origin: row.origin,
        path: row.path,
        props: row.props,
        channel: touch.get(personOf(row))?.channel ?? null,
        // A short, stable handle for following one person through the list.
        person: personOf(row).replace(/^u:/, '').slice(-6),
        signedIn: Boolean(row.userId),
      })),
  }
}

export type AnalyticsReport = Awaited<ReturnType<typeof analyticsReport>>
