import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { FaceCheckDocument, FaceTipArea, UserDocument, UserLocation } from '../../types/mongo.js'
import { errorMessage } from '../../utils/http.js'
import { createStructuredResponse, toDataUrl } from '../../utils/openai.js'
import { signedUrlOrNull, storage } from '../../utils/storage.js'
import { type Geo, requestGeo } from '../analytics/geo.js'
import { trackServerEvent } from '../analytics/service.js'
import { PaywallError, billingState, loadBillingUser } from '../billing/entitlements.js'

import { ageOn, currentAge, recentOf, shownAge } from './age.js'
import { FACE_SCHEMA, type FaceReadingRaw, buildFaceInstructions, toFaceReading } from './prompts.js'

// Face Age ("Look Great" its first day): face photos she adds whenever she
// likes (today's, or old ones dated when they were taken), how old her face
// reads in each, and what takes years off. Her own timeline, never matched
// across photos, gone whenever she deletes it.

// The release she signs (the web shows its text in her language, under
// lookGreat.consent): a new version when that text changes.
// face-age-2026-10-15: renamed Face Age, birth date optional, "I'm 18 or
// older" in the box she ticks.
export const LOOK_CONSENT_VERSION = 'face-age-2026-10-15'

// Face Age is off where a face photo is a "biometric identifier" people
// can sue over: Illinois (BIPA; the try-on suits against beauty brands) and
// Washington (My Health My Data Act). By where she signed up and where she
// is now.
const CLOSED = new Set(['US-IL', 'US-WA'])

export function lookAvailable(geo: Geo | null, location: Pick<UserLocation, 'country' | 'region'> | null | undefined) {
  const code = (place: { country: string; region: string | null } | null | undefined) =>
    place?.region ? `${place.country}-${place.region}` : null

  return !CLOSED.has(code(geo) ?? '') && !CLOSED.has(code(location) ?? '')
}

export function lookAvailableFor(request: FastifyRequest, user: Pick<UserDocument, 'location'>) {
  return lookAvailable(requestGeo(request), user.location)
}

// The day's cap: not an offer, just "more tomorrow".
export class LookLimitError extends Error {}

async function photosAdded(app: FastifyInstance, userId: ObjectId) {
  const user = await app.collections.users.findOne({ _id: userId }, { projection: { lookPhotosAdded: 1 } })

  return user?.lookPhotosAdded ?? 0
}

// Whether she can add one more photo now; throws Pro's offer when the free
// ones are used.
export async function assertPhotoAllowed(app: FastifyInstance, userId: ObjectId) {
  const counted = { userId, status: { $ne: 'failed' as const } }
  const today = await app.collections.faceChecks.countDocuments({ ...counted, createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } })

  if (today >= env.LOOK_DAILY_PHOTOS) {
    throw new LookLimitError(`That's ${env.LOOK_DAILY_PHOTOS} photos today. More tomorrow.`)
  }

  const user = await loadBillingUser(app, userId)

  if (user && billingState(user).proActive) {
    return
  }

  if ((await photosAdded(app, userId)) >= env.LOOK_FREE_PHOTOS) {
    throw new PaywallError('needs_pro', 'Your timeline, a photo whenever you like and tips on each come with Avarobe Pro.')
  }
}

// Reads one photo. One that can't be read (no face, several, someone under
// 18, too dark) is deleted at once: nothing of it stays but the reason.
export async function runFaceRead(app: FastifyInstance, checkId: ObjectId) {
  const check = await app.collections.faceChecks.findOne({ _id: checkId })

  if (!check) {
    return
  }

  // A photo that wasn't read isn't kept either, and gives its place back:
  // she adds it again.
  const fail = async (error: string, extra: Partial<FaceCheckDocument> = {}) => {
    await storage.remove(check.photoKey).catch(() => undefined)
    await app.collections.faceChecks.updateOne({ _id: checkId }, { $set: { status: 'failed', error, photoKey: '', ...extra, updatedAt: new Date() } })
    await app.collections.users.updateOne({ _id: check.userId, lookPhotosAdded: { $gt: 0 } }, { $inc: { lookPhotosAdded: -1 } })
  }

  try {
    const [user, avatar, photo] = await Promise.all([
      loadBillingUser(app, check.userId),
      app.collections.avatars.findOne({ userId: check.userId }, { projection: { colorAnalysis: 1 } }),
      storage.read(check.photoKey),
    ])
    const owner = await app.collections.users.findOne({ _id: check.userId }, { projection: { locale: 1 } })
    const palette = user && billingState(user).colorReport ? (avatar?.colorAnalysis ?? null) : null
    const old = check.source === 'import'
    const profile = await app.collections.users.findOne({ _id: check.userId }, { projection: { lookGreat: 1 } })
    const age = profile?.lookGreat?.birthDate ? ageOn(profile.lookGreat.birthDate, check.takenAt) : null
    const raw = await createStructuredResponse<FaceReadingRaw>({
      instructions: buildFaceInstructions({ palette, old, decade: age === null ? null : Math.floor(age / 10) * 10 }),
      content: [
        { type: 'input_text', text: old ? 'An older photo of me. How did my face read then?' : 'My photo for today. How does my face read?' },
        { type: 'input_image', image_url: toDataUrl(photo, 'image/jpeg'), detail: 'high' },
      ],
      schemaName: 'face_read',
      schema: FACE_SCHEMA,
      reasoningEffort: 'low',
      store: false,
      locale: (owner?.locale ?? null),
    })
    const reading = toFaceReading(raw)

    if (!reading.usable) {
      await fail(`unreadable:${reading.problem ?? 'no_face'}`, { reading })
    } else {
      await app.collections.faceChecks.updateOne({ _id: checkId }, { $set: { status: 'ready', reading, updatedAt: new Date() } })
    }

    void trackServerEvent(app, {
      name: 'look_photo_read',
      userId: check.userId,
      props: { usable: reading.usable, problem: reading.problem ?? 'none', source: check.source, light: reading.photo.light },
    })
  } catch (error) {
    app.log.error({ checkId: checkId.toString(), err: errorMessage(error) }, 'Face Age read failed')
    await fail('We could not read that photo. Try again in a moment.')
  }
}

export function startFaceRead(app: FastifyInstance, checkId: ObjectId) {
  void runFaceRead(app, checkId).catch((error: unknown) => {
    app.log.error({ err: error, checkId: checkId.toString() }, 'Face Age read crashed')
  })
}

// ---------------------------------------------------------------- the lock

// Face ID / Touch ID (her passkey) opens her photos for this long, on this
// device: the page holds the token, the API asks for it before signing
// photo links. A photo she added in the last minutes shows anyway: she
// just took it, here.
const UNLOCK_TTL = '15m'
const JUST_ADDED_MS = 15 * 60 * 1000
export const UNLOCK_HEADER = 'x-look-unlock'

export function signUnlock(app: FastifyInstance, userId: ObjectId) {
  return app.jwt.sign({ typ: 'look_unlock', sub: userId.toString() }, { expiresIn: UNLOCK_TTL })
}

export function isUnlocked(app: FastifyInstance, request: FastifyRequest, userId: ObjectId) {
  const token = request.headers[UNLOCK_HEADER]

  if (typeof token !== 'string' || !token) {
    return false
  }

  try {
    const payload = app.jwt.verify<{ typ?: string; sub?: string }>(token)

    return payload.typ === 'look_unlock' && payload.sub === userId.toString()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- reading it

// Shown as a code the page words in her language ('unreadable:minor'), or
// the message.
function problemOf(check: FaceCheckDocument) {
  return check.error?.startsWith('unreadable:') ? check.error.slice('unreadable:'.length) : null
}

// Without Pro she sees the first of the three tips; the other two (and the
// years they take off) are what Pro unlocks.
const FREE_TIPS = 1

// No "with your tips: about 41" (Oct 15, 2026): applying the tips to the same
// face, the read stayed the same, so a number of years off would promise
// what the next read doesn't show. potentialYears stays in the reading only.
export async function serializeFaceCheck(check: FaceCheckDocument, birthDate: string | null, showPhoto: boolean, pro: boolean) {
  const realAge = birthDate ? ageOn(birthDate, check.takenAt) : null
  const reading = check.status === 'ready' && check.reading?.usable ? check.reading : null
  const age = reading ? shownAge(reading.apparentAge, realAge) : null
  const visible = showPhoto || Date.now() - check.createdAt.getTime() < JUST_ADDED_MS

  return {
    id: check._id.toString(),
    status: check.status,
    problem: problemOf(check),
    error: problemOf(check) ? null : check.error,
    takenAt: check.takenAt.toISOString(),
    source: check.source,
    dateSource: check.dateSource,
    photoUrl: visible && check.photoKey ? await signedUrlOrNull(check.photoKey) : null,
    locked: !visible && Boolean(check.photoKey),
    age,
    realAge,
    reading: reading
      ? {
          headline: reading.headline,
          strengths: reading.strengths,
          agingFactors: reading.agingFactors,
          tips: pro ? reading.tips : reading.tips.slice(0, FREE_TIPS),
          lockedTips: pro ? 0 : Math.max(0, reading.tips.length - FREE_TIPS),
          photo: reading.photo,
        }
      : null,
    createdAt: check.createdAt.toISOString(),
  }
}

export type SerializedFaceCheck = Awaited<ReturnType<typeof serializeFaceCheck>>

const TIMELINE_LIMIT = 300

// Everything the page shows: her settings, her photos (newest first, by
// the day they're from) and where her face stands today.
export async function lookState(app: FastifyInstance, request: FastifyRequest, user: UserDocument) {
  const profile = user.lookGreat ?? null
  const available = lookAvailableFor(request, user)
  const billing = billingState(user)

  if (!profile) {
    return { available, profile: null, checks: [], summary: null, allowance: allowanceOf(billing.proActive, user.lookPhotosAdded ?? 0) }
  }

  const checks = await app.collections.faceChecks.find({ userId: user._id }).sort({ takenAt: -1, createdAt: -1 }).limit(TIMELINE_LIMIT).toArray()
  const showPhotos = !profile.lock || isUnlocked(app, request, user._id)
  const serialized = await Promise.all(checks.map((check) => serializeFaceCheck(check, profile.birthDate, showPhotos, billing.proActive)))
  const points = serialized
    .filter((check) => check.age !== null)
    .map((check) => ({ takenAt: new Date(check.takenAt), age: check.age! }))
  const today = currentAge(points)
  const realAge = profile.birthDate ? ageOn(profile.birthDate, new Date()) : null
  // Where her years come from: how often each area came up in her tips,
  // across every photo (the counts only: the tips beyond the first are Pro's).
  const areas: Partial<Record<FaceTipArea, number>> = {}

  for (const check of checks) {
    if (check.status === 'ready' && check.reading?.usable) {
      for (const tip of check.reading.tips) {
        areas[tip.area] = (areas[tip.area] ?? 0) + 1
      }
    }
  }
  const used = user.lookPhotosAdded ?? 0
  const passkeys = await app.collections.passkeys.countDocuments({ userId: user._id })

  return {
    available,
    profile: {
      birthDate: profile.birthDate,
      reminder: profile.reminder,
      lock: profile.lock,
      hasPasskey: passkeys > 0,
      guest: Boolean(user.guest),
      admin: billing.admin,
    },
    checks: serialized,
    summary: {
      age: today,
      realAge,
      // Years under her age (negative: over).
      younger: today !== null && realAge !== null ? realAge - today : null,
      photos: points.length,
      // How many photos "today" is read from.
      recent: recentOf(points).length,
      areas,
      firstAt: points.length ? points[points.length - 1]!.takenAt.toISOString() : null,
    },
    allowance: allowanceOf(billing.proActive, used),
    unlocked: showPhotos,
  }
}

function allowanceOf(pro: boolean, used: number) {
  return { pro, freeLeft: pro ? null : Math.max(0, env.LOOK_FREE_PHOTOS - used) }
}

// ---------------------------------------------------------------- deleting

export async function deleteFaceCheck(app: FastifyInstance, userId: ObjectId, checkId: ObjectId) {
  const check = await app.collections.faceChecks.findOneAndDelete({ _id: checkId, userId })

  if (check?.photoKey) {
    await storage.remove(check.photoKey).catch(() => undefined)
  }

  return Boolean(check)
}

// All of it: every photo, every reading, and (`profile`) her birth date,
// release and settings. Her "delete everything", account deletion, and
// three years without opening it.
export async function deleteLookData(app: FastifyInstance, userId: ObjectId, options: { profile: boolean }) {
  const checks = await app.collections.faceChecks.find({ userId }, { projection: { photoKey: 1 } }).toArray()

  await Promise.all(checks.filter((check) => check.photoKey).map((check) => storage.remove(check.photoKey).catch(() => undefined)))
  await app.collections.faceChecks.deleteMany({ userId })

  if (options.profile) {
    await app.collections.users.updateOne({ _id: userId }, { $unset: { lookGreat: '' } })
  }

  return { photos: checks.length }
}

// Her photos' storage keys, for an account's deletion sweep.
export function faceCheckKeys(checks: Pick<FaceCheckDocument, 'photoKey'>[]) {
  return checks.map((check) => check.photoKey).filter(Boolean)
}
