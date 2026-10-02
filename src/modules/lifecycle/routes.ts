import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import sharp from 'sharp'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { parseBody } from '../../utils/http.js'
import { storage } from '../../utils/storage.js'
import { clickTarget, emailImageUser, recordClick, recordOpen, recordUnsubscribe, userIdFromUnsubscribeToken } from './service.js'

const unsubscribeSchema = z.object({
  token: z.string().min(10).max(200),
  // false to opt back in from the same page.
  unsubscribe: z.boolean().default(true),
  // The email the link came from, to count unsubscribes per email.
  sendId: z.string().max(40).optional(),
})

const clickSchema = z.object({ u: z.string().min(1).max(2000), s: z.string().min(10).max(200) })
const imageSchema = z.object({ e: z.string().max(20), s: z.string().min(10).max(200) })

// Where an email photo link falls back to (expired, tampered with, or the
// photo is gone): the generic report image, so the email never breaks.
const FALLBACK_IMAGE = 'https://www.avarobe.com/email/color-report.jpg'

// A transparent 1x1 GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

// The public side of the onboarding emails: the unsubscribe link (the token
// is the account id signed with the server secret; account and security
// emails are not affected), the open pixel, the click redirect and the
// signed photo of the price-drop email.
const lifecycleRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/unsubscribe',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(unsubscribeSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const userId = userIdFromUnsubscribeToken(parsed.data.token)

      if (!userId) {
        return reply.code(400).send({ message: 'This unsubscribe link is not valid.' })
      }

      const result = await app.collections.users.updateOne(
        { _id: userId },
        parsed.data.unsubscribe
          ? { $set: { emailTipsOptOutAt: new Date(), updatedAt: new Date() } }
          : { $set: { emailTipsOptOutAt: null, updatedAt: new Date() } },
      )

      if (result.matchedCount === 0) {
        return reply.code(404).send({ message: 'We could not find this account. It may have been deleted.' })
      }

      if (parsed.data.unsubscribe && parsed.data.sendId) {
        await recordUnsubscribe(app, parsed.data.sendId, userId)
      }

      return { ok: true, subscribed: !parsed.data.unsubscribe }
    },
  )

  // Email clients load images through proxies, so allow plenty.
  app.get<{ Params: { file: string } }>(
    '/o/:file',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const id = request.params.file.replace(/\.gif$/, '')

      if (ObjectId.isValid(id)) {
        await recordOpen(app, new ObjectId(id)).catch((error: unknown) => request.log.warn({ err: error }, 'Open not recorded'))
      }

      return reply
        .header('Content-Type', 'image/gif')
        .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        .send(PIXEL)
    },
  )

  // Their drape photo, best side blurred, for the price-drop email. JPEG,
  // which every email client shows.
  app.get<{ Params: { file: string } }>(
    '/i/:file',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(imageSchema, request.query)
      const userId = parsed.ok ? emailImageUser(request.params.file, parsed.data.e, parsed.data.s) : null
      const avatar = userId ? await app.collections.avatars.findOne({ userId }, { projection: { drapePreview: 1 } }) : null
      const key = avatar?.drapePreview?.lockedKey

      if (!key) {
        return reply.redirect(FALLBACK_IMAGE, 302)
      }

      try {
        const jpeg = await sharp(await storage.read(key)).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
        return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(jpeg)
      } catch (error) {
        request.log.warn({ err: error }, 'Email image not served')
        return reply.redirect(FALLBACK_IMAGE, 302)
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/c/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(clickSchema, request.query)
      const target = parsed.ok ? clickTarget(request.params.id, parsed.data.u, parsed.data.s) : null

      if (!target) {
        return reply.redirect(env.APP_URL, 302)
      }

      await recordClick(app, new ObjectId(request.params.id)).catch((error: unknown) =>
        request.log.warn({ err: error }, 'Click not recorded'),
      )

      return reply.header('Cache-Control', 'no-store').redirect(target, 302)
    },
  )
}

export default lifecycleRoutes
