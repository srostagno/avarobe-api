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
//
// The agent adds the reads it needs here itself (growth/PLAYBOOK.md, "Datos
// de comportamiento"), under the same rules: no writes, typed params, a
// window cap on anything that scans events, and no email, name or address
// in the rows (ids, codes and counts; the free text people typed into the
// surveys and reviews is the one exception). Each one with its test.

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

// Days are Los Angeles days, as in the ad account and metrics.mjs.
const laDay = (date: string) => ({ $dateToString: { format: '%Y-%m-%d', date, timezone: 'America/Los_Angeles' } })

// The generations people wait for, by collection: their failures are bugs
// the agent should see before customers write about them.
export const GENERATIONS = ['avatars', 'looks', 'hairstyles', 'colorChecks', 'faceChecks', 'makeupTryOns', 'scoreChecks'] as const

// Error text leaves the server without keys or email addresses.
const redact = (text: string | null | undefined) =>
  (text ?? '')
    .replace(/\b(sk|rk|pk|whsec)[-_][\w*-]{6,}/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .slice(0, 200)

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

// A [from, to) window of at most `days` days, for the reads that scan events.
const span = (days: number) =>
  z
    .object({ from: isoDate, to: isoDate })
    .strict()
    .refine(({ from, to }) => to > from && to.getTime() - from.getTime() <= days * DAY, { message: `to must be after from, at most ${days} days`, path: ['to'] })

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

const staffUsers = (c: MongoCollections, comp: string[]) =>
  c.users.find({ $or: [{ role: 'admin' }, ...(comp.length ? [{ email: { $in: comp } }] : [])] }, { projection: { _id: 1 }, ...READ }).toArray()

const GROWTH_QUERIES: Record<string, Runner> = {
  // The team: admins and COMP_EMAILS (the server's own list).
  staff: query(z.object({}).strict(), async (c) => {
    const comp = compEmails()
    const users = await staffUsers(c, comp)

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

  // Behavior. The days each signed-in person used the site (web events),
  // for return rates and frequency: one row per person.
  activeDays: query(span(120), (c, { from, to }) =>
    c.analyticsEvents
      .aggregate(
        [
          { $match: { at: { $gte: from, $lt: to }, origin: 'web', userId: { $ne: null } } },
          { $group: { _id: '$userId', days: { $addToSet: laDay('$at') }, events: { $sum: 1 } } },
        ],
        READ,
      )
      .toArray(),
  ),
  // Every event by name and day: how many, by how many people and visitors.
  // The team's own events left out.
  eventCounts: query(span(62), async (c, { from, to }) => {
    const staff = (await staffUsers(c, compEmails())).map((user) => user._id)

    return c.analyticsEvents
      .aggregate(
        [
          { $match: { at: { $gte: from, $lt: to }, userId: { $nin: staff } } },
          { $group: { _id: { n: '$name', d: laDay('$at') }, events: { $sum: 1 }, u: { $addToSet: '$userId' }, v: { $addToSet: '$visitorId' } } },
          { $project: { events: 1, users: { $size: { $setDifference: ['$u', [null]] } }, visitors: { $size: { $setDifference: ['$v', [null]] } } } },
        ],
        READ,
      )
      .toArray()
  }),
  // The studio's one-tap questions (modules/survey): why they came, what held
  // them back, what convinced them. The script leaves the team out.
  surveyAnswers: query(z.object({ since: isoDate }).strict(), (c, { since }) =>
    c.surveyAnswers
      .find({ createdAt: { $gte: since } }, { projection: { userId: 1, question: 1, answer: 1, note: 1, context: 1, content: 1, createdAt: 1 }, ...READ })
      .sort({ createdAt: -1 })
      .limit(5000)
      .toArray(),
  ),
  // The advisors' ratings (0–10) and reviews (modules/feedback).
  feedback: query(z.object({ since: isoDate }).strict(), (c, { since }) =>
    c.feedback
      .find(
        { updatedAt: { $gte: since } },
        { projection: { userId: 1, product: 1, score: 1, comment: 1, locale: 1, region: 1, pro: 1, content: 1, createdAt: 1, updatedAt: 1 }, ...READ },
      )
      .sort({ updatedAt: -1 })
      .limit(2000)
      .toArray(),
  ),
  // What broke: generations by status in the last hours with their top
  // errors, and the founder's open ops alerts.
  generationHealth: query(z.object({ hours: z.number().int().min(1).max(168) }).strict(), async (c, { hours }, now) => {
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000)
    const collections = await Promise.all(
      GENERATIONS.map(async (name) => {
        const [byStatus, errors] = await Promise.all([
          c[name].aggregate<{ _id: string | null; n: number }>([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }], READ).toArray(),
          c[name]
            .aggregate<{ _id: string | null; n: number }>([{ $match: { createdAt: { $gte: since }, status: 'failed' } }, { $group: { _id: '$error', n: { $sum: 1 } } }], READ)
            .toArray(),
        ])

        return {
          name,
          byStatus: Object.fromEntries(byStatus.map((row) => [row._id ?? 'none', row.n])),
          errors: errors
            .sort((a, b) => b.n - a.n)
            .slice(0, 5)
            .map((row) => ({ error: redact(row._id), n: row.n })),
        }
      }),
    )
    const alerts = await c.opsAlerts.find({}, READ).toArray()

    return {
      since,
      collections,
      alerts: alerts.map((alert) => ({ kind: alert._id, openSince: alert.openSince, lastSentAt: alert.lastSentAt, lastError: redact(alert.lastError) })),
    }
  }),
}

export const GROWTH_QUERY_NAMES = Object.keys(GROWTH_QUERIES)

export async function runGrowthQuery(collections: MongoCollections, name: string, params: unknown, now = new Date()): Promise<Result> {
  const run = Object.hasOwn(GROWTH_QUERIES, name) ? GROWTH_QUERIES[name] : undefined

  return run ? run(collections, params, now) : { ok: false, message: `Unknown query "${name}".` }
}
