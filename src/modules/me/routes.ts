import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { clearAuthCookies } from '../../utils/auth-session.js'
import { parseBody } from '../../utils/http.js'
import { serializeUser } from '../../utils/serializers.js'
import { shareableKey } from '../../utils/shareable.js'
import { storage } from '../../utils/storage.js'
import { cancelProNow } from '../billing/stripe.js'

import { deleteUserContent } from './content.js'

const updateSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
})

const emailPreferencesSchema = z.object({
  // Tips and reminders (the onboarding emails). Account and security emails
  // always go out.
  tips: z.boolean(),
})

const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // One of their own generated images, for sharing. The page adds the
  // avarobe.com band and hands it to the share sheet; it can't read S3
  // images itself (no CORS there).
  app.get(
    '/image',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const key = shareableKey((request.query as { src?: string }).src ?? '', userId.toString())

      if (!key) {
        return reply.code(404).send({ message: 'That image can’t be shared.' })
      }

      try {
        const file = await storage.read(key)

        return reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=300').send(file)
      } catch {
        return reply.code(404).send({ message: 'That image can’t be shared.' })
      }
    },
  )

  app.patch('/', async (request, reply) => {
    const parsed = parseBody(updateSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const user = await app.collections.users.findOneAndUpdate(
      { _id: requireUserId(request) },
      { $set: { firstName: parsed.data.firstName, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' })
    }

    return { user: serializeUser(user) }
  })

  app.patch('/email', async (request, reply) => {
    const parsed = parseBody(emailPreferencesSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const now = new Date()
    const user = await app.collections.users.findOneAndUpdate(
      { _id: requireUserId(request) },
      { $set: { emailTipsOptOutAt: parsed.data.tips ? null : now, updatedAt: now } },
      { returnDocument: 'after' },
    )

    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' })
    }

    return { user: serializeUser(user) }
  })

  // Deletes the account and every photo and render tied to it. Promised in
  // the privacy notice, so it hard-deletes rather than soft-deleting.
  app.delete('/', async (request, reply) => {
    const userId = requireUserId(request)
    const user = await app.collections.users.findOne({ _id: userId }, { projection: { pro: 1 } })

    // Pro ends with the account: without this, a trial still turned into a
    // charge a week later for someone whose account was gone.
    if (user?.pro?.subscriptionId && !['canceled', 'incomplete_expired'].includes(user.pro.status)) {
      try {
        await cancelProNow(user.pro.subscriptionId)
      } catch (error) {
        request.log.error({ err: error, userId: userId.toString() }, 'Could not cancel Pro before deleting the account')
        return reply.code(502).send({ message: 'We couldn’t cancel your Pro subscription, so your account wasn’t deleted. Please try again in a minute.' })
      }
    }

    const { files } = await deleteUserContent(app, userId)
    await Promise.all([
      app.collections.refreshTokens.deleteMany({ userId }),
      app.collections.passkeys.deleteMany({ userId }),
      app.collections.authChallenges.deleteMany({ userId }),
      app.collections.purchases.deleteMany({ userId }),
    ])
    await app.collections.users.deleteOne({ _id: userId })

    request.log.info({ userId: userId.toString(), files }, 'Account deleted')
    clearAuthCookies(reply)

    return { ok: true }
  })
}

export default meRoutes
