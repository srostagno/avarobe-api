import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import sharp from 'sharp'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { FaceCheckDocument, LookGreatProfile } from '../../types/mongo.js'
import { exifDate } from '../../utils/exif-date.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { InvalidImageError, normalizeSelfie } from '../../utils/images.js'
import { toObjectId } from '../../utils/object-id.js'
import { storage } from '../../utils/storage.js'
import { trackServerEvent } from '../analytics/service.js'
import { saveChallenge, takeChallenge, toTransports } from '../auth/passkeys.js'
import { PaywallError, billingState, isAdmin, sendPaywall } from '../billing/entitlements.js'

import { ageOn, parseBirthDate } from './age.js'
import {
  LOOK_CONSENT_VERSION,
  LookLimitError,
  assertPhotoAllowed,
  deleteFaceCheck,
  deleteLookData,
  isUnlocked,
  lookAvailableFor,
  lookState,
  serializeFaceCheck,
  signUnlock,
  startFaceRead,
} from './service.js'

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const REMINDERS = ['off', 'daily', 'few', 'weekly'] as const
const CLOSED = { code: 'look_unavailable', message: 'Face Age isn’t available where you are yet.' }
const NO_PROFILE = { code: 'look_setup', message: 'Start Face Age first.' }

const birthDate = z.string().refine((value) => {
  const age = parseBirthDate(value) ? ageOn(value, new Date()) : null

  return age !== null && age >= 18 && age <= 110
}, 'Enter your birth date (you must be 18 or older).')

// The birth date is optional: it only compares her face age with her real
// age and makes the tips fit her stage of life.
const profileSchema = z.object({
  birthDate: birthDate.nullish(),
  consent: z.literal(true),
  // Older pages send the name she typed to sign; since Oct 16 her tap is
  // the consent.
  consentName: z.string().trim().min(3).max(100).nullish(),
  reminder: z.enum(REMINDERS).default('few'),
})

const settingsSchema = z.object({
  birthDate: birthDate.nullish(),
  reminder: z.enum(REMINDERS).optional(),
  lock: z.boolean().optional(),
})

const unlockSchema = z.object({
  challengeId: z.string().min(10).max(100),
  response: z.object({ id: z.string().min(1).max(1_024), rawId: z.string().min(1).max(1_024), type: z.literal('public-key'), response: z.record(z.unknown()) }).passthrough(),
})

// 'YYYY-MM-DD' or 'YYYY-MM' (the 1st), not in the future.
function chosenDate(value: string | undefined) {
  const match = value ? /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value) : null

  if (!match) {
    return null
  }

  const day = match[3] ?? '01'
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(day)))

  return date.toISOString().slice(0, 10) === `${match[1]}-${match[2]}-${day}` && date.getTime() <= Date.now() ? date : null
}

// Face Age (modules/look/service.ts): her face photos over time, how old
// her face reads in each, and what takes years off.
const lookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const user = await app.collections.users.findOne({ _id: requireUserId(request) })

    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    return lookState(app, request, user)
  })

  // Starting: her birth date (optional) and her consent.
  app.post('/profile', async (request, reply) => {
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId })
    const parsed = parseBody(profileSchema, request.body)

    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    if (!lookAvailableFor(request, user)) {
      return reply.code(403).send(CLOSED)
    }

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const now = new Date()
    const profile: LookGreatProfile = {
      birthDate: parsed.data.birthDate ?? null,
      consentAt: now,
      consentVersion: LOOK_CONSENT_VERSION,
      consentName: parsed.data.consentName ?? null,
      reminder: parsed.data.reminder,
      reminderLastAt: user.lookGreat?.reminderLastAt ?? null,
      lock: user.lookGreat?.lock ?? false,
      createdAt: user.lookGreat?.createdAt ?? now,
    }

    await app.collections.users.updateOne({ _id: userId }, { $set: { lookGreat: profile, updatedAt: now } })
    void trackServerEvent(app, { name: 'look_started', userId, props: { reminder: profile.reminder, again: Boolean(user.lookGreat), birth_date: Boolean(profile.birthDate) } })

    return lookState(app, request, { ...user, lookGreat: profile })
  })

  app.patch('/profile', async (request, reply) => {
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId })
    const parsed = parseBody(settingsSchema, request.body)

    if (!user?.lookGreat) {
      return reply.code(409).send(NO_PROFILE)
    }

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    // The lock opens with her passkey: there has to be one.
    if (parsed.data.lock && (await app.collections.passkeys.countDocuments({ userId })) === 0) {
      return reply.code(409).send({ code: 'no_passkey', message: 'Add a passkey (Face ID or Touch ID) first.' })
    }

    const set: Record<string, unknown> = { updatedAt: new Date() }

    for (const key of ['birthDate', 'reminder', 'lock'] as const) {
      if (parsed.data[key] !== undefined) {
        set[`lookGreat.${key}`] = parsed.data[key]
      }
    }

    await app.collections.users.updateOne({ _id: userId }, { $set: set })
    const updated = await app.collections.users.findOne({ _id: userId })

    return lookState(app, request, updated!)
  })

  // A photo: today's (camera or a saved one), or an old one with its date.
  app.post('/photos', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId })
    let upload: Buffer | null = null
    const fields: Record<string, string> = {}

    if (!user?.lookGreat) {
      return reply.code(409).send(NO_PROFILE)
    }

    if (!lookAvailableFor(request, user)) {
      return reply.code(403).send(CLOSED)
    }

    try {
      for await (const part of request.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } })) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer()

          if (part.fieldname === 'photo') {
            upload = buffer
          }
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value
        }
      }
    } catch (error) {
      request.log.warn({ err: error }, 'Face Age upload rejected')
      return reply.code(413).send({ message: 'The photo must be an image under 15 MB.' })
    }

    if (!upload) {
      return reply.code(400).send({ message: 'Add a photo of your face.' })
    }

    const source: FaceCheckDocument['source'] = fields.source === 'import' ? 'import' : fields.source === 'upload' ? 'upload' : 'camera'
    const now = new Date()
    let takenAt = now
    let dateSource: FaceCheckDocument['dateSource'] = 'now'

    // An old photo: the date she picked, else the camera's.
    if (source === 'import') {
      const chosen = chosenDate(fields.takenAt)
      const fromCamera = chosen ? null : exifDate((await sharp(upload).metadata().catch(() => null))?.exif)

      if (!chosen && !fromCamera) {
        return reply.code(400).send({ code: 'needs_date', message: 'When is this photo from? Pick the month and year.' })
      }

      takenAt = (chosen ?? fromCamera)!
      dateSource = chosen ? 'chosen' : 'exif'

      // Never a photo of her as a minor (by her birth date when she gave it;
      // the read itself turns away anyone who looks under 18).
      const then = user.lookGreat.birthDate ? ageOn(user.lookGreat.birthDate, takenAt) : null

      if (then !== null && then < 18) {
        return reply.code(400).send({ code: 'too_young', message: 'Add photos from when you were 18 or older.' })
      }
    }

    try {
      await assertPhotoAllowed(app, userId)
    } catch (error) {
      if (error instanceof PaywallError) {
        void trackServerEvent(app, { name: 'look_paywall', userId, props: { source } })
        return sendPaywall(reply, error)
      }

      if (error instanceof LookLimitError) {
        return reply.code(429).send({ message: error.message })
      }

      throw error
    }

    let photo: Buffer

    try {
      // EXIF rotation applied, then every tag dropped (GPS included).
      photo = await normalizeSelfie(upload)
    } catch (error) {
      return reply.code(400).send({ message: error instanceof InvalidImageError ? error.message : 'That photo could not be read.' })
    }

    const checkId = new ObjectId()
    const photoKey = `users/${userId.toString()}/face-${checkId.toString()}.jpg`

    await storage.put(photoKey, photo, 'image/jpeg')

    const check: FaceCheckDocument = {
      _id: checkId,
      userId,
      status: 'processing',
      error: null,
      photoKey,
      takenAt,
      source,
      dateSource,
      reading: null,
      createdAt: now,
      updatedAt: now,
    }

    await app.collections.faceChecks.insertOne(check)
    await app.collections.users.updateOne({ _id: userId }, { $inc: { lookPhotosAdded: 1 } })
    startFaceRead(app, checkId)
    void trackServerEvent(app, { name: 'look_photo_added', userId, props: { source, dateSource } })

    return reply.code(202).send({ check: await serializeFaceCheck(check, user.lookGreat.birthDate, true, billingState(user).proActive) })
  })

  // Her own photo, for the video of her timeline the page makes on her
  // phone (a canvas only draws an image from the page's own API without
  // tainting): only hers, only a read one, and never while her photos are
  // locked on this device (Face ID).
  app.get('/photos/:id/image', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const checkId = toObjectId((request.params as { id?: string }).id)
    const user = checkId ? await app.collections.users.findOne({ _id: userId }, { projection: { lookGreat: 1 } }) : null
    const check = checkId && user?.lookGreat ? await app.collections.faceChecks.findOne({ _id: checkId, userId }) : null

    if (!user?.lookGreat || !check?.photoKey || check.status !== 'ready') {
      return reply.code(404).send({ message: 'Photo not found.' })
    }

    if (user.lookGreat.lock && !isUnlocked(app, request, userId)) {
      return reply.code(403).send({ code: 'look_locked', message: 'Unlock your photos first.' })
    }

    try {
      const file = await storage.read(check.photoKey)

      return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=300').send(file)
    } catch {
      return reply.code(404).send({ message: 'Photo not found.' })
    }
  })

  app.delete('/photos/:id', async (request, reply) => {
    const checkId = toObjectId((request.params as { id?: string }).id)
    const deleted = checkId ? await deleteFaceCheck(app, requireUserId(request), checkId) : false

    if (!deleted) {
      return reply.code(404).send({ message: 'Photo not found.' })
    }

    return { ok: true }
  })

  // Admins testing the whole thing again, as a first-timer: everything,
  // the count of free photos included.
  app.post('/reset', async (request, reply) => {
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId })

    if (!user || !isAdmin(user)) {
      return reply.code(403).send({ message: 'Only for admins.' })
    }

    await deleteLookData(app, userId, { profile: true })
    await app.collections.users.updateOne({ _id: userId }, { $unset: { lookPhotosAdded: '' } })
    const fresh = await app.collections.users.findOne({ _id: userId })

    return lookState(app, request, fresh!)
  })

  // Everything: photos, readings, birth date, release and settings.
  app.delete('/', async (request) => {
    const userId = requireUserId(request)
    const { photos } = await deleteLookData(app, userId, { profile: true })
    void trackServerEvent(app, { name: 'look_deleted', userId, props: { photos } })

    return { ok: true, photos }
  })

  // Face ID / Touch ID before her photos show (when she turned the lock on):
  // her own passkeys only, and the device must check it's her.
  app.post('/unlock/options', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const passkeys = await app.collections.passkeys.find({ userId }).toArray()

    if (passkeys.length === 0) {
      return reply.code(409).send({ code: 'no_passkey', message: 'Add a passkey (Face ID or Touch ID) first.' })
    }

    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: passkeys.map((passkey) => ({ id: passkey.credentialId, transports: toTransports(passkey.transports) })),
      userVerification: 'required',
    })
    const challengeId = await saveChallenge(app, 'look_unlock', options.challenge, userId)

    return { challengeId, options }
  })

  app.post('/unlock/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(unlockSchema, request.body)
    const failed = { message: 'That didn’t unlock your photos. Try again.' }

    if (!parsed.ok) {
      return reply.code(400).send(failed)
    }

    const challenge = await takeChallenge(app, parsed.data.challengeId, 'look_unlock', userId)

    if (!challenge) {
      return reply.code(400).send({ message: 'That took too long. Please try again.' })
    }

    const passkey = await app.collections.passkeys.findOne({ credentialId: parsed.data.response.id, userId })

    if (!passkey) {
      return reply.code(401).send(failed)
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response: parsed.data.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: env.WEBAUTHN_ORIGINS,
        expectedRPID: env.WEBAUTHN_RP_ID,
        credential: {
          id: passkey.credentialId,
          publicKey: Uint8Array.from(passkey.publicKey.buffer.subarray(0, passkey.publicKey.length())),
          counter: passkey.counter,
          transports: toTransports(passkey.transports),
        },
        requireUserVerification: true,
      })

      if (!verification.verified) {
        return reply.code(401).send(failed)
      }

      await app.collections.passkeys.updateOne(
        { _id: passkey._id },
        { $set: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() } },
      )
    } catch (error) {
      request.log.warn({ err: errorMessage(error) }, 'Face Age unlock rejected')
      return reply.code(401).send(failed)
    }

    void trackServerEvent(app, { name: 'look_unlocked', userId })

    return { token: signUnlock(app, userId) }
  })
}

export default lookRoutes
