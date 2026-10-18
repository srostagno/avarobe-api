import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import sharp from 'sharp'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { ScoreCheckDocument, ScoreKind } from '../../types/mongo.js'
import { exifDate } from '../../utils/exif-date.js'
import { parseBody } from '../../utils/http.js'
import { InvalidImageError, normalizeBodyPhoto, normalizeSelfie } from '../../utils/images.js'
import { toObjectId } from '../../utils/object-id.js'
import { differenceHash, hashDistance, photoSha256 } from '../../utils/photo-hash.js'
import { storage } from '../../utils/storage.js'
import { requestGeo } from '../analytics/geo.js'
import { trackServerEvent } from '../analytics/service.js'
import { needsCheckboxConsent } from '../avatar/routes.js'
import { PaywallError, billingState, isAdmin, refundCredits, requirePro, sendPaywall, spendCredits } from '../billing/entitlements.js'
import { reserveLookQuota } from '../looks/quota.js'
import { dailyLimitReply, releaseGenerations, reserveUsage } from '../../utils/usage.js'
import { NothingToFixError, planFix, startFixLook } from './fix.js'
import { NoPerfectCutError, serializePerfect, startPerfectHaircut } from './perfect.js'
import {
  SCORE_CONSENT_VERSION,
  SCORE_KINDS,
  ScoreLimitError,
  claimScoreRead,
  deleteScoreCheck,
  deleteScoreData,
  freeKind,
  scoreState,
  serializeScoreCheck,
  startScoreRead,
} from './service.js'

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
// The same picture again, re-saved or lightly cropped (difference hash bits).
const SAME_PHOTO = 6
// A camera date older than this isn't believed (a reset clock), nor a future one.
const OLDEST_PHOTO_MS = 10 * 365 * 24 * 60 * 60 * 1000
const NO_PROFILE = { code: 'score_setup', message: 'Start first.' }

const profileSchema = z.object({ consent: z.literal(true), method: z.enum(['tap', 'checkbox']).default('tap') })

const kindOf = (value: unknown): ScoreKind | null => (SCORE_KINDS.includes(value as ScoreKind) ? (value as ScoreKind) : null)

// Look Score and Hair Score (modules/scores/service.ts), at /scores/look and
// /scores/hair. Off with SCORES_ENABLED=off.
const scoreRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', async (_request, reply) => {
    if (env.SCORES_ENABLED !== 'on') {
      return reply.code(404).send({ message: 'Not found.' })
    }
  })

  // Her release for her photos, one for both scores: her tap on "Agree and
  // continue", or the box where the law asks for a written release (Illinois).
  app.post('/profile', async (request, reply) => {
    const userId = requireUserId(request)
    const parsed = parseBody(profileSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    if (parsed.data.method === 'tap' && needsCheckboxConsent(requestGeo(request))) {
      return reply.code(409).send({ code: 'consent_checkbox', message: 'Tick the box to agree.' })
    }

    const now = new Date()
    const user = await app.collections.users.findOne({ _id: userId }, { projection: { scoreProfile: 1 } })

    await app.collections.users.updateOne(
      { _id: userId },
      {
        $set: {
          scoreProfile: {
            consentAt: now,
            consentVersion: SCORE_CONSENT_VERSION,
            consentMethod: parsed.data.method,
            createdAt: user?.scoreProfile?.createdAt ?? now,
          },
          updatedAt: now,
        },
      },
    )
    void trackServerEvent(app, { name: 'score_started', userId, props: { method: parsed.data.method } })

    return { ok: true }
  })

  app.get('/:kind', async (request, reply) => {
    const kind = kindOf((request.params as { kind: string }).kind)
    const user = await app.collections.users.findOne({ _id: requireUserId(request) })

    if (!kind || !user) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    return {
      ...(await scoreState(app, user, kind)),
      checkboxRequired: needsCheckboxConsent(requestGeo(request)),
    }
  })

  app.post('/:kind/photos', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const kind = kindOf((request.params as { kind: string }).kind)
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId })

    if (!kind || !user) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    if (!user.scoreProfile) {
      return reply.code(409).send(NO_PROFILE)
    }

    let upload: Buffer | null = null
    const fields: Record<string, string> = {}

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
      request.log.warn({ err: error }, 'Score upload rejected')
      return reply.code(413).send({ message: 'The photo must be an image under 15 MB.' })
    }

    if (!upload) {
      return reply.code(400).send({ message: kind === 'look' ? 'Add a full-body photo of your outfit.' : 'Add a photo of your hair.' })
    }

    // One at a time: the read in progress first.
    if (await app.collections.scoreChecks.findOne({ userId, kind, status: 'processing' }, { projection: { _id: 1 } })) {
      return reply.code(409).send({ code: 'busy', message: 'We’re still reading your last photo.' })
    }

    const source: ScoreCheckDocument['source'] = fields.source === 'upload' ? 'upload' : 'camera'
    const now = new Date()
    // A photo from her library keeps the day it was taken (its camera date),
    // so older photos land where they belong on her timeline.
    const fromCamera = source === 'upload' ? exifDate((await sharp(upload).metadata().catch(() => null))?.exif) : null
    const believable = fromCamera && fromCamera.getTime() <= now.getTime() && now.getTime() - fromCamera.getTime() < OLDEST_PHOTO_MS
    const takenAt = believable ? fromCamera : now
    let photo: Buffer

    try {
      // EXIF rotation applied, then every tag dropped (GPS included).
      photo = kind === 'look' ? await normalizeBodyPhoto(upload) : await normalizeSelfie(upload)
    } catch (error) {
      return reply.code(400).send({ message: error instanceof InvalidImageError ? error.message : 'That photo could not be read.' })
    }

    // The same photo again: its read, with nothing used.
    const photoHash = photoSha256(photo)
    const photoDHash = await differenceHash(photo)
    const previous = await app.collections.scoreChecks
      .find({ userId, kind, status: { $ne: 'failed' } }, { projection: { photoHash: 1, photoDHash: 1 } })
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray()
    const same = previous.find((check) => check.photoHash === photoHash || hashDistance(check.photoDHash, photoDHash) <= SAME_PHOTO)

    if (same) {
      const check = await app.collections.scoreChecks.findOne({ _id: same._id })

      if (check) {
        return reply.code(409).send({
          code: 'duplicate',
          message: 'You already added this photo.',
          check: await serializeScoreCheck(check, billingState(user).proActive),
        })
      }
    }

    let freeUse: boolean

    try {
      freeUse = (await claimScoreRead(app, userId, kind)).freeUse
    } catch (error) {
      if (error instanceof PaywallError) {
        void trackServerEvent(app, { name: 'score_paywall', userId, props: { kind } })
        return sendPaywall(reply, error)
      }

      if (error instanceof ScoreLimitError) {
        return reply.code(429).send({ code: 'daily_limit', message: error.message })
      }

      throw error
    }

    const checkId = new ObjectId()
    const photoKey = `users/${userId.toString()}/${kind}score-${checkId.toString()}.jpg`

    await storage.put(photoKey, photo, 'image/jpeg')

    const check: ScoreCheckDocument = {
      _id: checkId,
      userId,
      kind,
      status: 'processing',
      error: null,
      photoKey,
      photoHash,
      photoDHash,
      takenAt,
      source,
      dateSource: believable ? 'exif' : 'now',
      freeUse,
      reading: null,
      createdAt: now,
      updatedAt: now,
    }

    await app.collections.scoreChecks.insertOne(check)
    startScoreRead(app, checkId)
    void trackServerEvent(app, { name: 'score_photo_added', userId, props: { kind, source, free: freeUse } })

    return reply.code(202).send({ check: await serializeScoreCheck(check, billingState(user).proActive) })
  })

  // "See it fixed" (looks, Pro): her outfit with its tips applied, drawn on
  // her avatar as a new look; one credit, given back if it fails. Again on
  // the same photo: the look she has.
  app.post('/look/photos/:id/fix', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id: string }).id)
    const check = id ? await app.collections.scoreChecks.findOne({ _id: id, userId, kind: 'look' }) : null

    if (!check || check.status !== 'ready' || !check.reading?.usable || !check.photoKey) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    if (check.fixLookId) {
      const existing = await app.collections.looks.findOne({ _id: check.fixLookId, userId })

      if (existing && existing.status !== 'failed') {
        return reply.code(200).send({ lookId: existing._id.toString() })
      }
    }

    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.avatarKey || !avatar.body || avatar.status === 'failed') {
      return reply.code(409).send({ code: 'needs_avatar', message: 'Create your avatar first.' })
    }

    const quota = await reserveLookQuota(app, userId, 1, { route: '/scores/look/fix' })

    if (!quota.ok) {
      return reply.code(quota.status).send(quota.body)
    }

    let creditSpent: boolean

    try {
      await requirePro(app, userId, 'Seeing your look fixed')
      creditSpent = await spendCredits(app, userId, 1)
    } catch (error) {
      await releaseGenerations(app, userId, 'look', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }

    try {
      const photo = await storage.read(check.photoKey)
      const { plan, dressCode } = await planFix(avatar, photo, check.reading.tips.map((tip) => tip.text))
      const look = await startFixLook(app, { check, avatar, plan, dressCode, creditSpent })

      void trackServerEvent(app, { name: 'score_fix_started', userId, props: { score: check.reading.score } })
      return reply.code(202).send({ lookId: look._id.toString() })
    } catch (error) {
      await releaseGenerations(app, userId, 'look', 1)
      await refundCredits(app, userId, creditSpent ? 1 : 0)

      if (error instanceof NothingToFixError) {
        return reply.code(422).send({ message: 'We couldn’t find an outfit to fix in that photo.' })
      }

      request.log.error({ err: error }, 'Score fix failed')
      return reply.code(502).send({ message: 'Our stylist couldn’t fix that look. Try again.' })
    }
  })

  // "Unlock your perfect haircut" (hair, Pro): the cut that suits her,
  // planned from this read and drawn on her; one credit, given back if it
  // fails. Again on the same photo: the haircut she has.
  app.post('/hair/photos/:id/perfect', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = requireUserId(request)
    const id = toObjectId((request.params as { id: string }).id)
    const check = id ? await app.collections.scoreChecks.findOne({ _id: id, userId, kind: 'hair' }) : null

    if (!check || check.status !== 'ready' || !check.reading?.usable) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    if (check.perfectHairstyleId) {
      const existing = await app.collections.hairstyles.findOne({ _id: check.perfectHairstyleId, userId })

      if (existing && existing.status !== 'failed') {
        return reply.code(200).send({ perfect: await serializePerfect(existing) })
      }
    }

    const avatar = await app.collections.avatars.findOne({ userId })

    if (!avatar?.avatarKey || avatar.status === 'failed') {
      return reply.code(409).send({ code: 'needs_avatar', message: 'Create your avatar first.' })
    }

    const reserved = await reserveUsage(app, userId, 'hair', 1)

    if (!reserved.ok) {
      return dailyLimitReply(reply, reserved, { message: `You can try ${env.DAILY_HAIR_LIMIT} hairstyles a day. Come back tomorrow.` })
    }

    let creditSpent: boolean

    try {
      await requirePro(app, userId, 'Your perfect haircut')
      creditSpent = await spendCredits(app, userId, 1)
    } catch (error) {
      await releaseGenerations(app, userId, 'hair', 1)

      if (error instanceof PaywallError) {
        return sendPaywall(reply, error)
      }

      throw error
    }

    try {
      const hairstyle = await startPerfectHaircut(app, { check, avatar, creditSpent })

      void trackServerEvent(app, { name: 'score_perfect_started', userId, props: { kind: 'hair', score: check.reading.score } })
      return reply.code(202).send({ perfect: await serializePerfect(hairstyle) })
    } catch (error) {
      await releaseGenerations(app, userId, 'hair', 1)
      await refundCredits(app, userId, creditSpent ? 1 : 0)

      if (error instanceof NoPerfectCutError) {
        return reply.code(422).send({ message: 'Our stylist couldn’t find a haircut for this photo. Try another one.' })
      }

      request.log.error({ err: error }, 'Perfect haircut failed')
      return reply.code(502).send({ message: 'Our stylist couldn’t plan your haircut. Try again.' })
    }
  })

  // Her own photo, for the video of her timeline (made on her phone; a canvas
  // only draws an image from the page's own API without tainting).
  app.get('/:kind/photos/:id/image', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = request.params as { kind: string; id: string }
    const kind = kindOf(params.kind)
    const id = toObjectId(params.id)
    const check = kind && id ? await app.collections.scoreChecks.findOne({ _id: id, userId: requireUserId(request), kind }) : null

    if (!check || check.status !== 'ready' || !check.photoKey) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    const image = await storage.read(check.photoKey)

    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=300').send(image)
  })

  app.delete('/:kind/photos/:id', async (request, reply) => {
    const params = request.params as { kind: string; id: string }
    const kind = kindOf(params.kind)
    const id = toObjectId(params.id)

    if (!kind || !id || !(await deleteScoreCheck(app, requireUserId(request), kind, id))) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    return reply.code(204).send()
  })

  // Every photo of this kind (her release stays for the other).
  app.delete('/:kind', async (request, reply) => {
    const kind = kindOf((request.params as { kind: string }).kind)
    const userId = requireUserId(request)

    if (!kind) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    await deleteScoreData(app, userId, { kind, profile: false })
    void trackServerEvent(app, { name: 'score_deleted', userId, props: { kind } })

    return reply.code(204).send()
  })

  // Admins testing: everything of this kind, and its free photos back.
  app.post('/:kind/reset', async (request, reply) => {
    const kind = kindOf((request.params as { kind: string }).kind)
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId }, { projection: { email: 1 } })

    if (!kind || !user || !isAdmin(user)) {
      return reply.code(404).send({ message: 'Not found.' })
    }

    await deleteScoreData(app, userId, { kind, profile: false })
    await app.collections.users.updateOne({ _id: userId }, { $unset: { [`freeUses.${freeKind(kind)}`]: '' } })

    return { ok: true }
  })
}

export default scoreRoutes
