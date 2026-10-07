import { createHash } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { Acquisition, AnalyticsChannel, ArrivalDocument } from '../../types/mongo.js'

// The ad click id as we keep it: a short SHA-256 of the fbclid (the web
// hashes it the same way), enough to match one click's stages.
export function hashClick(fbclid: string) {
  return createHash('sha256').update(fbclid).digest('hex').slice(0, 32)
}

// The fbclid inside Meta's _fbc cookie ("fb.1.<time>.<fbclid>").
export function fbclidFromFbc(fbc: string | undefined | null) {
  const parts = fbc?.split('.') ?? []
  return parts.length >= 4 && parts[0] === 'fb' ? parts.slice(3).join('.') : null
}

export async function recordArrival(
  app: FastifyInstance,
  arrival: Omit<ArrivalDocument, '_id' | 'at'>,
) {
  const at = new Date()

  if (!arrival.click) {
    await app.collections.arrivals.insertOne({ _id: new ObjectId(), ...arrival, at })
    return
  }

  // One document per click and stage: reloads don't count twice.
  await app.collections.arrivals.updateOne(
    { click: arrival.click, stage: arrival.stage },
    { $setOnInsert: { _id: new ObjectId(), ...arrival, at } },
    { upsert: true },
  )
}

// The channels a lost ad click hides behind: the browser kept Meta's click
// cookie but not the ad's parameters (an app's browser handing off to
// Safari, a reload without them). Paid and email touches stay as they are.
const RECOVERABLE = new Set<AnalyticsChannel | null>([null, 'direct', 'organic', 'social', 'referral'])

// The account's acquisition once its sign-up is known to come from a Meta ad
// click; null when it already names a channel worth keeping.
export function recoveredAcquisition(
  current: Acquisition | null | undefined,
  click: { fbclid: string; path: string | null; campaign: string | null; content: string | null },
): Acquisition | null {
  if (current?.recovered || !RECOVERABLE.has(current?.channel ?? null)) {
    return null
  }

  return {
    visitorId: current?.visitorId ?? null,
    channel: 'meta',
    source: 'meta',
    medium: 'paid_social',
    campaign: click.campaign ?? current?.campaign ?? null,
    content: click.content ?? current?.content ?? null,
    term: current?.term ?? null,
    landing: click.path ?? current?.landing ?? null,
    fbclid: click.fbclid,
    recovered: 'meta_click',
    recoveredFrom: current?.channel ?? null,
  }
}

// A sign-up whose browser came from an ad click: the click's last stage, and
// the account counted as Meta when the browser had lost the ad.
export async function recordRegisteredClick(app: FastifyInstance, fbc: string | undefined, userId?: ObjectId) {
  const fbclid = fbclidFromFbc(fbc)

  if (!fbclid) {
    return
  }

  const click = hashClick(fbclid)
  const arrived = await app.collections.arrivals.findOne({ click }, { projection: { path: 1, campaign: 1, content: 1, inApp: 1, mobile: 1 } })

  await recordArrival(app, {
    stage: 'registered',
    click,
    path: arrived?.path ?? '/',
    campaign: arrived?.campaign ?? null,
    content: arrived?.content ?? null,
    inApp: arrived?.inApp ?? false,
    mobile: arrived?.mobile ?? false,
  })

  if (!userId) {
    return
  }

  const user = await app.collections.users.findOne({ _id: userId }, { projection: { acquisition: 1 } })
  const acquisition = recoveredAcquisition(user?.acquisition, {
    fbclid,
    path: arrived?.path ?? null,
    campaign: arrived?.campaign ?? null,
    content: arrived?.content ?? null,
  })

  if (acquisition) {
    await app.collections.users.updateOne({ _id: userId }, { $set: { acquisition } })
  }
}
