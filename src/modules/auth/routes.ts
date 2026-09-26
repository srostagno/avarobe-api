import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { REFRESH_TOKEN_COOKIE } from '../../constants/auth.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import {
  clearAuthCookies,
  issueAuthSession,
  rotateAuthSession,
} from '../../utils/auth-session.js'
import { buildLoginLinkEmail, canSendEmail, sendTransactionalEmail } from '../../utils/email.js'
import { parseBody } from '../../utils/http.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { toObjectId } from '../../utils/object-id.js'
import { serializeUser } from '../../utils/serializers.js'
import { generateSecureToken, hashToken } from '../../utils/tokens.js'

type LoginLinkPayload = {
  typ?: string
  sub?: string
  em?: string
  nn?: string
  rp?: string
}

const startSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().max(60).optional(),
  redirectPath: z.string().max(200).optional(),
})

const consumeSchema = z.object({
  token: z.string().min(20).max(2_000),
})

// Only same-site paths, never protocol-relative URLs.
function normalizeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null
  }

  return value
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Passwordless: creates the account on first use and emails a one-time
  // sign-in link. In development without MailerSend the link is returned in
  // the response so the flow can be tested locally.
  app.post(
    '/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(startSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a valid email address.' })
      }

      const { email } = parsed.data
      const firstName = parsed.data.firstName ?? ''
      const now = new Date()
      let user = await app.collections.users.findOne({ email })

      if (!user) {
        try {
          const created = {
            _id: new ObjectId(),
            email,
            firstName,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: null,
            emailVerifiedAt: null,
          }

          await app.collections.users.insertOne(created)
          user = created
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            throw error
          }

          user = await app.collections.users.findOne({ email })
        }
      } else if (!user.firstName && firstName) {
        await app.collections.users.updateOne(
          { _id: user._id },
          { $set: { firstName, updatedAt: now } },
        )
        user.firstName = firstName
      }

      if (!user) {
        return reply.code(500).send({ message: 'Could not start sign-in.' })
      }

      const redirectPath = normalizeRedirectPath(parsed.data.redirectPath)
      const nonce = generateSecureToken(24)

      await app.collections.users.updateOne(
        { _id: user._id },
        { $set: { loginNonceHash: hashToken(nonce) } },
      )

      const token = await app.jwt.sign(
        {
          typ: 'login_link',
          sub: user._id.toString(),
          em: user.email,
          nn: nonce,
          ...(redirectPath ? { rp: redirectPath } : {}),
        },
        { expiresIn: env.LOGIN_LINK_TTL },
      )
      const loginUrl = `${env.APP_URL}/auth/callback?token=${encodeURIComponent(token)}`

      if (!canSendEmail()) {
        if (env.NODE_ENV === 'development') {
          request.log.info({ email, loginUrl }, 'Dev sign-in link (MailerSend not configured)')
          return reply.send({ ok: true, devLoginUrl: loginUrl })
        }

        request.log.error('MailerSend is not configured; cannot send sign-in links.')
        return reply
          .code(503)
          .send({ message: 'Sign-in email is unavailable right now. Please try again soon.' })
      }

      try {
        const content = buildLoginLinkEmail({ firstName: user.firstName, loginUrl })
        await sendTransactionalEmail({
          to: { email: user.email, name: user.firstName },
          ...content,
        })
      } catch (error) {
        request.log.error({ err: error, email }, 'Failed to send sign-in link')
        return reply
          .code(503)
          .send({ message: 'We could not send the email. Please try again in a moment.' })
      }

      return reply.send({ ok: true })
    },
  )

  app.post(
    '/consume',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(consumeSchema, request.body)
      const invalid = { message: 'This sign-in link is invalid or has expired.' }

      if (!parsed.ok) {
        return reply.code(400).send(invalid)
      }

      let payload: LoginLinkPayload

      try {
        payload = await app.jwt.verify<LoginLinkPayload>(parsed.data.token)
      } catch {
        return reply.code(401).send(invalid)
      }

      const userId = toObjectId(payload.sub)

      if (payload.typ !== 'login_link' || !userId || !payload.em || !payload.nn) {
        return reply.code(401).send(invalid)
      }

      const now = new Date()
      // Consuming clears the nonce atomically, so a link can't be reused.
      const user = await app.collections.users.findOneAndUpdate(
        { _id: userId, email: payload.em, loginNonceHash: hashToken(payload.nn) },
        { $set: { loginNonceHash: null, lastLoginAt: now, updatedAt: now } },
        { returnDocument: 'after' },
      )

      if (!user) {
        return reply.code(401).send(invalid)
      }

      if (!user.emailVerifiedAt) {
        await app.collections.users.updateOne(
          { _id: user._id },
          { $set: { emailVerifiedAt: now } },
        )
      }
      await issueAuthSession(app, reply, request, {
        id: user._id.toString(),
        email: user.email,
      })

      return reply.send({
        user: serializeUser(user),
        redirectPath: normalizeRedirectPath(payload.rp),
      })
    },
  )

  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE]
      const user = refreshToken
        ? await rotateAuthSession(app, reply, request, refreshToken)
        : null

      if (!user) {
        clearAuthCookies(reply)
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      return reply.send({ user: serializeUser(user) })
    },
  )

  app.post('/logout', async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE]

    if (refreshToken) {
      await app.collections.refreshTokens.updateOne(
        { tokenHash: hashToken(refreshToken), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
    }

    clearAuthCookies(reply)

    return reply.send({ ok: true })
  })

  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await app.collections.users.findOne({ _id: requireUserId(request) })

    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' })
    }

    return { user: serializeUser(user) }
  })
}

export default authRoutes
