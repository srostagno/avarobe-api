import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { ACCESS_TOKEN_COOKIE } from '../../constants/auth.js'
import type { Acquisition, AnalyticsChannel, AnalyticsEventDocument } from '../../types/mongo.js'
import { geoCode } from './geo.js'
import { toObjectId } from '../../utils/object-id.js'
import { extractBearerToken } from '../../utils/tokens.js'

// First-party analytics: what people do in the funnel, stored in our own
// database so the admin can see it without Google Analytics. Events carry no
// personal data: ids are random (visitor, session) or ours (user), props are
// short codes (reason, placement, product), never free text.

export const CHANNELS = ['meta', 'google', 'email', 'organic', 'social', 'referral', 'direct'] as const satisfies readonly AnalyticsChannel[]

const id = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)
// Campaign tags come from URLs anyone can write: odd characters are dropped,
// never a reason to reject the request (a sign-up carries them).
const code = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[^\w .:/@+-]/g, '').trim().slice(0, max))
const clickId = z
  .string()
  .max(500)
  .transform((value) => (/^[\w-]{4,500}$/.test(value) ? value : null))

export const acquisitionSchema = z.object({
  visitorId: id.optional().nullable(),
  channel: z.enum(CHANNELS).default('direct'),
  source: code(80).optional().nullable(),
  medium: code(80).optional().nullable(),
  campaign: code(120).optional().nullable(),
  content: code(120).optional().nullable(),
  term: code(120).optional().nullable(),
  landing: z
    .string()
    .transform((value) => (value.startsWith('/') ? value.slice(0, 200) : null))
    .optional()
    .nullable(),
  gclid: clickId.optional().nullable(),
  gbraid: clickId.optional().nullable(),
  wbraid: clickId.optional().nullable(),
  fbclid: clickId.optional().nullable(),
})

const propValue = z.union([z.string().max(120), z.number().finite(), z.boolean()])

export const trackSchema = z.object({
  visitorId: id,
  sessionId: id,
  firstTouch: acquisitionSchema.optional().catch(undefined),
  sessionChannel: z.enum(CHANNELS).optional(),
  mobile: z.boolean().optional(),
  inApp: z.boolean().optional(),
  events: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        path: z.string().max(200).regex(/^\//).optional(),
        // Milliseconds since epoch on the device; kept when close to ours.
        at: z.number().int().positive().optional(),
        props: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), propValue).optional(),
      }),
    )
    .min(1)
    .max(40),
})

export function toAcquisition(input: z.output<typeof acquisitionSchema> | undefined | null): Acquisition | null {
  if (!input) {
    return null
  }

  return {
    visitorId: input.visitorId ?? null,
    channel: input.channel,
    source: input.source ?? null,
    medium: input.medium ?? null,
    campaign: input.campaign ?? null,
    content: input.content ?? null,
    term: input.term ?? null,
    landing: input.landing ?? null,
    gclid: input.gclid ?? null,
    gbraid: input.gbraid ?? null,
    wbraid: input.wbraid ?? null,
    fbclid: input.fbclid ?? null,
  }
}

// At most 12 props per event, strings trimmed: enough for codes, never a story.
function cleanProps(props: Record<string, string | number | boolean> | undefined) {
  const out: Record<string, string | number | boolean> = {}

  for (const [key, value] of Object.entries(props ?? {}).slice(0, 12)) {
    out[key] = typeof value === 'string' ? value.trim().slice(0, 120) : value
  }

  return out
}

const MAX_SKEW_MS = 10 * 60 * 1000

// The signed-in user behind a request, if any (the same access token the
// studio uses); anonymous otherwise. Never rejects the request.
export async function optionalUserId(request: FastifyRequest) {
  const token = extractBearerToken(request.headers.authorization) ?? request.cookies[ACCESS_TOKEN_COOKIE]

  if (!token) {
    return null
  }

  try {
    const payload = await request.server.jwt.verify<{ sub: string }>(token)
    return toObjectId(payload.sub)
  } catch {
    return null
  }
}

export async function recordWebEvents(
  app: FastifyInstance,
  input: z.output<typeof trackSchema>,
  userId: ObjectId | null,
  geo: string | null = null,
) {
  const now = Date.now()
  const docs: AnalyticsEventDocument[] = input.events.map((event) => ({
    _id: new ObjectId(),
    at: new Date(event.at && Math.abs(event.at - now) < MAX_SKEW_MS ? event.at : now),
    name: event.name,
    origin: 'web',
    visitorId: input.visitorId,
    sessionId: input.sessionId,
    userId,
    path: event.path ?? null,
    props: cleanProps(event.props),
    channel: input.firstTouch?.channel ?? null,
    campaign: input.firstTouch?.campaign ?? null,
    content: input.firstTouch?.content ?? null,
    sessionChannel: input.sessionChannel ?? null,
    mobile: input.mobile ?? null,
    inApp: input.inApp ?? null,
    geo,
  }))

  await app.collections.analyticsEvents.insertMany(docs, { ordered: false })
}

// An event the server knows about for sure: a checkout it created, a payment
// Stripe confirmed, an offer it answered with instead of a result. It
// inherits the person's first touch, so the funnel can be split by channel.
// Never throws: analytics must not break the request that reports it.
export async function trackServerEvent(
  app: FastifyInstance,
  input: { name: string; userId: ObjectId | null; props?: Record<string, string | number | boolean>; path?: string | null },
) {
  try {
    const user = input.userId
      ? await app.collections.users.findOne({ _id: input.userId }, { projection: { acquisition: 1, location: 1 } })
      : null
    const acquisition = user?.acquisition ?? null

    await app.collections.analyticsEvents.insertOne({
      _id: new ObjectId(),
      at: new Date(),
      name: input.name,
      origin: 'server',
      visitorId: acquisition?.visitorId ?? null,
      sessionId: null,
      userId: input.userId,
      path: input.path ?? null,
      props: cleanProps(input.props),
      channel: acquisition?.channel ?? null,
      campaign: acquisition?.campaign ?? null,
      content: acquisition?.content ?? null,
      sessionChannel: null,
      mobile: null,
      inApp: null,
      geo: geoCode(user?.location),
    })
  } catch (error) {
    app.log.warn({ err: error instanceof Error ? error.message : String(error), event: input.name }, 'analytics event not recorded')
  }
}
