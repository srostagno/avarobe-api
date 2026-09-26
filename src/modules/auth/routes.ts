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
import {
  burnPasswordCheck,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  passwordProblem,
  verifyPassword,
} from '../../utils/password.js'
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

const emailField = z.string().trim().toLowerCase().email().max(254)
const passwordField = z.string().min(1).max(MAX_PASSWORD_LENGTH)

const registerSchema = z.object({
  email: emailField,
  password: passwordField,
  firstName: z.string().trim().max(60).optional(),
})

const loginSchema = z.object({
  email: emailField,
  password: passwordField,
})

const changePasswordSchema = z.object({
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH).optional(),
  newPassword: passwordField,
})

const MAX_FAILED_LOGINS = 10
const LOCKOUT_MS = 15 * 60 * 1000

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

      let credentialsReset = false

      if (!user.emailVerifiedAt) {
        // First proof that this person owns the email. A password or passkey
        // added before that could belong to someone who signed up with an
        // email that isn't theirs, so drop them and end other sessions.
        const passkeyCount = await app.collections.passkeys.countDocuments({ userId: user._id })

        credentialsReset = Boolean(user.passwordHash) || passkeyCount > 0

        if (credentialsReset) {
          await app.collections.passkeys.deleteMany({ userId: user._id })
          await app.collections.refreshTokens.updateMany(
            { userId: user._id, revokedAt: null },
            { $set: { revokedAt: now } },
          )
          request.log.warn(
            { userId: user._id.toString() },
            'Cleared credentials set before the email was verified',
          )
        }

        await app.collections.users.updateOne(
          { _id: user._id },
          { $set: { emailVerifiedAt: now, passwordHash: null, passwordUpdatedAt: null } },
        )
        user.passwordHash = null
      }
      await issueAuthSession(app, reply, request, {
        id: user._id.toString(),
        email: user.email,
      })

      return reply.send({
        user: serializeUser(user),
        redirectPath: normalizeRedirectPath(payload.rp),
        credentialsReset,
      })
    },
  )

  // Creates an account with email and password. A stub account left by an
  // unused sign-in link (never logged in, no password) can be claimed.
  app.post(
    '/register',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(registerSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a valid email and password.' })
      }

      const { email, password } = parsed.data
      const problem = passwordProblem(password, email)

      if (problem) {
        return reply.code(400).send({ message: problem })
      }

      const firstName = parsed.data.firstName ?? ''
      const passwordHash = await hashPassword(password)
      const now = new Date()
      const existing = await app.collections.users.findOne({ email })
      let userId: ObjectId

      if (existing) {
        if (existing.passwordHash || existing.lastLoginAt) {
          return reply
            .code(409)
            .send({ message: 'An account with this email already exists. Sign in instead.' })
        }

        await app.collections.users.updateOne(
          { _id: existing._id },
          {
            $set: {
              passwordHash,
              passwordUpdatedAt: now,
              lastLoginAt: now,
              updatedAt: now,
              ...(existing.firstName ? {} : { firstName }),
            },
          },
        )
        userId = existing._id
      } else {
        userId = new ObjectId()

        try {
          await app.collections.users.insertOne({
            _id: userId,
            email,
            firstName,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
            emailVerifiedAt: null,
            passwordHash,
            passwordUpdatedAt: now,
          })
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            return reply
              .code(409)
              .send({ message: 'An account with this email already exists. Sign in instead.' })
          }

          throw error
        }
      }

      const user = await app.collections.users.findOne({ _id: userId })

      if (!user) {
        return reply.code(500).send({ message: 'Could not create your account.' })
      }

      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })

      return reply.code(201).send({ user: serializeUser(user) })
    },
  )

  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(loginSchema, request.body)
      const wrong = { message: 'Email or password is incorrect.' }

      if (!parsed.ok) {
        return reply.code(400).send(wrong)
      }

      const { email, password } = parsed.data
      const user = await app.collections.users.findOne({ email })

      if (!user?.passwordHash) {
        await burnPasswordCheck(password)
        return reply.code(401).send(wrong)
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        return reply
          .code(429)
          .send({ message: 'Too many attempts. Try again in a few minutes or use a sign-in link.' })
      }

      if (!(await verifyPassword(password, user.passwordHash))) {
        const failures = (user.failedLoginCount ?? 0) + 1
        const locked = failures >= MAX_FAILED_LOGINS

        await app.collections.users.updateOne(
          { _id: user._id },
          {
            $set: locked
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
              : { failedLoginCount: failures },
          },
        )
        request.log.warn({ userId: user._id.toString(), failures, locked }, 'Failed password login')

        return reply.code(401).send(wrong)
      }

      const now = new Date()

      await app.collections.users.updateOne(
        { _id: user._id },
        { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now } },
      )
      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })

      return reply.send({ user: serializeUser(user) })
    },
  )

  // Sets or changes the password. Changing requires the current one; other
  // sessions are signed out.
  app.post(
    '/password',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(changePasswordSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a new password.' })
      }

      const user = await app.collections.users.findOne({ _id: requireUserId(request) })

      if (!user) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      if (user.passwordHash) {
        const current = parsed.data.currentPassword ?? ''

        if (!(await verifyPassword(current, user.passwordHash))) {
          return reply.code(400).send({ message: 'Your current password is incorrect.' })
        }
      }

      const problem = passwordProblem(parsed.data.newPassword, user.email)

      if (problem) {
        return reply.code(400).send({ message: problem })
      }

      const now = new Date()
      const currentToken = request.cookies[REFRESH_TOKEN_COOKIE]

      await app.collections.users.updateOne(
        { _id: user._id },
        {
          $set: {
            passwordHash: await hashPassword(parsed.data.newPassword),
            passwordUpdatedAt: now,
            failedLoginCount: 0,
            lockedUntil: null,
            updatedAt: now,
          },
        },
      )
      await app.collections.refreshTokens.updateMany(
        {
          userId: user._id,
          revokedAt: null,
          ...(currentToken ? { tokenHash: { $ne: hashToken(currentToken) } } : {}),
        },
        { $set: { revokedAt: now } },
      )

      const updated = await app.collections.users.findOne({ _id: user._id })

      return reply.send({ user: updated ? serializeUser(updated) : null })
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
