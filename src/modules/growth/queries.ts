import type { Filter } from 'mongodb'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import type { MongoCollections } from '../../plugins/mongodb.js'
import type { UserDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'

// The growth agent's reads (growth/metrics.mjs and growth/customers.mjs in
// the Avarobe folder), one name per query those scripts ran on Atlas, with
// the same filter, projection, sort and limit, so their results don't
// change. Read-only by construction: only find, findOne and aggregate with
// the filters and pipelines written here; the caller sends typed parameters
// (ids, dates, a name from a list), never a filter or a stage.

const DAY = 24 * 60 * 60 * 1000
// Off the primary when there is a secondary, and never a runaway query.
const READ = { readPreference: 'secondaryPreferred', maxTimeMS: 30_000 } as const

// metrics.mjs userFields.
export const GROWTH_USER_FIELDS = {
  createdAt: 1,
  acquisition: 1,
  'location.country': 1,
  guest: 1,
  proTrialAt: 1,
  'pro.status': 1,
  'pro.trialEnd': 1,
  'pro.cancelAtPeriodEnd': 1,
  'pro.interval': 1,
}

// customers.mjs USER_FIELDS.
export const CUSTOMER_USER_FIELDS = {
  email: 1,
  firstName: 1,
  locale: 1,
  location: 1,
  createdAt: 1,
  guest: 1,
  role: 1,
  acquisition: 1,
  paidAt: 1,
  colorReportAt: 1,
  styleReportAt: 1,
  hairAdvisorAt: 1,
  pro: 1,
  proTrialAt: 1,
  proTrialColor: 1,
  proTrialFree: 1,
  emailTipsOptOutAt: 1,
  lifecycleEmailLastAt: 1,
}

// metrics.mjs FUNNEL: the only events funnelReached reads.
export const FUNNEL_EVENTS = ['avatar_photo_added', 'colors_ready', 'signup_completed', 'upsell_viewed', 'checkout_created'] as const

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY)

// customers.mjs SEGMENTS, with the same days.
const SEGMENTS = {
  // Turned off Pro or a trial in the last 10 days.
  cancelled: (now: Date): Filter<UserDocument> => ({ 'pro.cancelAtPeriodEnd': true, updatedAt: { $gte: daysBefore(now, 10) } }),
  // Paid for the Color Advisor 2–14 days ago (the script keeps who never opened it).
  unopened: (now: Date): Filter<UserDocument> => ({ colorReportAt: { $gte: daysBefore(now, 14), $lte: daysBefore(now, 2) } }),
  // Started 1–7 days ago and never paid.
  no_buy: (now: Date): Filter<UserDocument> => ({ createdAt: { $gte: daysBefore(now, 7), $lte: daysBefore(now, 1) }, paidAt: null }),
  // First payment 5–30 days ago.
  buyers: (now: Date): Filter<UserDocument> => ({ paidAt: { $gte: daysBefore(now, 30), $lte: daysBefore(now, 5) } }),
}

const objectId = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'must be a 24-hex id')
  .transform((value) => new ObjectId(value))
const ids = z.array(objectId).max(5_000)
const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))

type Result = { ok: true; rows: unknown } | { ok: false; message: string }
type Runner = (collections: MongoCollections, params: unknown, now: Date) => Promise<Result>

function query<S extends z.ZodTypeAny>(schema: S, run: (collections: MongoCollections, params: z.output<S>, now: Date) => Promise<unknown>): Runner {
  return async (collections, params, now) => {
    const parsed = parseBody(schema, params)

    return parsed.ok ? { ok: true, rows: await run(collections, parsed.data, now) } : { ok: false, message: `Bad params: ${parsed.message}` }
  }
}

const compEmails = () =>
  env.COMP_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

const GROWTH_QUERIES: Record<string, Runner> = {
  // The team: admins and COMP_EMAILS (the server's own list).
  staff: query(z.object({}).strict(), async (c) => {
    const comp = compEmails()
    const users = await c.users.find({ $or: [{ role: 'admin' }, ...(comp.length ? [{ email: { $in: comp } }] : [])] }, { projection: { _id: 1 }, ...READ }).toArray()

    return { ids: users.map((user) => user._id.toHexString()), compEmails: comp }
  }),
  usersSince: query(z.object({ since: isoDate }).strict(), (c, { since }) =>
    c.users.find({ createdAt: { $gte: since } }, { projection: GROWTH_USER_FIELDS, ...READ }).toArray(),
  ),
  usersByIds: query(z.object({ ids }).strict(), (c, params) =>
    c.users.find({ _id: { $in: params.ids } }, { projection: GROWTH_USER_FIELDS, ...READ }).toArray(),
  ),
  purchasesSince: query(z.object({ since: isoDate }).strict(), (c, { since }) =>
    c.purchases
      .find({ createdAt: { $gte: since } }, { projection: { userId: 1, product: 1, amountUsd: 1, amountTotal: 1, createdAt: 1, refundedAt: 1 }, ...READ })
      .toArray(),
  ),
  // First paid purchase ever (a free trial's $0 doesn't count).
  firstPaid: query(z.object({ userIds: ids }).strict(), (c, { userIds }) =>
    c.purchases
      .aggregate(
        [
          { $match: { userId: { $in: userIds }, refundedAt: null, $or: [{ amountUsd: { $gt: 0 } }, { amountTotal: { $gt: 0 } }] } },
          { $group: { _id: '$userId', first: { $min: '$createdAt' } } },
        ],
        READ,
      )
      .toArray(),
  ),
  funnelReached: query(
    z.object({ userIds: ids, names: z.array(z.enum(FUNNEL_EVENTS)).max(FUNNEL_EVENTS.length), since: isoDate }).strict(),
    (c, { userIds, names, since }) =>
      c.analyticsEvents
        .aggregate([{ $match: { userId: { $in: userIds }, name: { $in: names }, at: { $gte: since } } }, { $group: { _id: { u: '$userId', n: '$name' } } }], READ)
        .toArray(),
  ),
  // Landing visitors by campaign: only the count of people leaves the server.
  visitors: query(z.object({ from: isoDate, to: isoDate }).strict(), (c, { from, to }) =>
    c.analyticsEvents
      .aggregate(
        [
          { $match: { name: 'page_view', at: { $gte: from, $lt: to } } },
          { $group: { _id: { c: '$campaign', ch: '$channel' }, v: { $addToSet: '$visitorId' } } },
          { $project: { people: { $size: '$v' } } },
        ],
        READ,
      )
      .toArray(),
  ),
  segment: query(z.object({ segment: z.enum(['cancelled', 'unopened', 'no_buy', 'buyers']) }).strict(), (c, { segment }, now) =>
    c.users
      .find(SEGMENTS[segment](now), { projection: CUSTOMER_USER_FIELDS, ...READ })
      .sort({ updatedAt: -1 })
      .limit(400)
      .toArray(),
  ),
  userByEmail: query(z.object({ email: z.string().min(3).max(320) }).strict(), (c, { email }) =>
    c.users.findOne({ email: email.trim().toLowerCase() }, { projection: CUSTOMER_USER_FIELDS, ...READ }),
  ),
  // customers.mjs context(): her avatar, purchases and last month's checkouts.
  context: query(z.object({ userIds: ids }).strict(), async (c, { userIds }, now) => {
    const [avatars, purchases, checkouts] = await Promise.all([
      c.avatars
        .find(
          { userId: { $in: userIds } },
          { projection: { userId: 1, 'colorAnalysis.season': 1, 'colorAnalysis.undertone': 1, colorsAt: 1, 'colorReport.createdAt': 1, avatarKey: 1 }, ...READ },
        )
        .toArray(),
      c.purchases.find({ userId: { $in: userIds }, refundedAt: null }, { projection: { userId: 1, product: 1, createdAt: 1, amountUsd: 1 }, ...READ }).toArray(),
      c.analyticsEvents
        .find({ userId: { $in: userIds }, name: 'checkout_created', at: { $gte: daysBefore(now, 30) } }, { projection: { userId: 1, props: 1, at: 1 }, ...READ })
        .sort({ at: -1 })
        .toArray(),
    ])

    return { avatars, purchases, checkouts }
  }),
}

export const GROWTH_QUERY_NAMES = Object.keys(GROWTH_QUERIES)

export async function runGrowthQuery(collections: MongoCollections, name: string, params: unknown, now = new Date()): Promise<Result> {
  const run = Object.hasOwn(GROWTH_QUERIES, name) ? GROWTH_QUERIES[name] : undefined

  return run ? run(collections, params, now) : { ok: false, message: `Unknown query "${name}".` }
}
