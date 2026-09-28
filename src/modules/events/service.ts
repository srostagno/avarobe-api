import { createHash } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { ArrivalDocument } from '../../types/mongo.js'

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

// A sign-up whose browser came from an ad click: the click's last stage.
export async function recordRegisteredClick(app: FastifyInstance, fbc: string | undefined) {
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
}
