import type { FastifyBaseLogger, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { REFRESH_TOKEN_COOKIE } from '../../constants/auth.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { UserDocument } from '../../types/mongo.js'
import { consumeLink, createLink, linkSentRecently, readLink } from '../../utils/auth-links.js'
import {
  clearAuthCookies,
  issueAuthSession,
  rotateAuthSession,
} from '../../utils/auth-session.js'
import {
  deliverLinkEmail,
  passwordChangedEmail,
  passwordResetEmail,
  sendNotice,
  verificationEmail,
} from '../../utils/email.js'
import { parseBody } from '../../utils/http.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import {
  burnPasswordCheck,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  passwordProblem,
  verifyPassword,
} from '../../utils/password.js'
import { serializeUser } from '../../utils/serializers.js'
import { hashToken } from '../../utils/tokens.js'
import { attributionMetadata, reportRegistration } from '../billing/conversions.js'
import { recordRegisteredClick } from '../events/service.js'

const emailField = z.string().trim().toLowerCase().email().max(254)
const passwordField = z.string().min(1).max(MAX_PASSWORD_LENGTH)
const firstNameField = z.string().trim().max(60).optional()
const tokenField = z.string().min(20).max(2_000)

const idField = z.string().regex(/^[A-Za-z0-9._-]{1,200}$/)

// Analytics ids from the browser (absent when the visitor opted out), and
// the id the pixel used for this sign-up, so Meta merges both reports.
const signupTracking = {
  attribution: z.object({ gaClientId: idField.optional(), fbp: idField.optional(), fbc: idField.optional() }).optional(),
  eventId: z.string().uuid().optional(),
}

const registerSchema = z.object({
  email: emailField,
  password: passwordField,
  firstName: firstNameField,
  ...signupTracking,
})

const registerPasskeySchema = z.object({
  email: emailField,
  firstName: firstNameField,
  ...signupTracking,
})

const loginSchema = z.object({
  email: emailField,
  password: passwordField,
})

const changePasswordSchema = z.object({
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH).optional(),
  newPassword: passwordField,
})

const forgotSchema = z.object({ email: emailField })
const tokenSchema = z.object({ token: tokenField })
const resetSchema = z.object({ token: tokenField, newPassword: passwordField })

const MAX_FAILED_LOGINS = 10
const LOCKOUT_MS = 15 * 60 * 1000
const ACCOUNT_EXISTS = { message: 'An account with this email already exists. Sign in instead.' }
const EMAIL_FAILED = { message: 'We could not send the email. Please try again in a moment.' }
const WAIT_FOR_EMAIL = { message: 'We just sent you an email. Wait a minute before asking for another.' }

function recipient(user: UserDocument) {
  return { email: user.email, name: user.firstName }
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Sign-ups reported from the server (Meta CAPI), and the ad click they
  // came from counted as registered. Never blocks or fails the sign-up.
  function reportSignup(
    request: FastifyRequest,
    data: { attribution?: { fbp?: string; fbc?: string; gaClientId?: string }; eventId?: string },
    method: 'password' | 'passkey',
  ) {
    const metadata = attributionMetadata(data.attribution, request) as Record<string, string>

    if (data.eventId) {
      void reportRegistration(app, { metadata, eventId: data.eventId, method })
    }

    void recordRegisteredClick(app, data.attribution?.fbc).catch((error: unknown) =>
      request.log.warn({ err: error }, 'Registered click not recorded'),
    )
  }

  async function sendVerification(log: FastifyBaseLogger, user: UserDocument, forPasskey: boolean) {
    const url = await createLink(app, user, 'verify_email', forPasskey ? 'passkey' : undefined)

    return deliverLinkEmail({
      log,
      to: recipient(user),
      link: url,
      content: verificationEmail({ firstName: user.firstName, url, forPasskey }),
    })
  }

  function notifyPasswordChanged(log: FastifyBaseLogger, user: UserDocument) {
    void sendNotice({
      log,
      to: recipient(user),
      content: passwordChangedEmail({
        firstName: user.firstName,
        resetUrl: `${env.APP_URL}/login?mode=forgot`,
      }),
    })
  }

  // Email + password. The account works right away and a verification email
  // goes out (passkeys need a verified email); if sending fails the person
  // can resend from the app. A stub left by an unfinished passkey sign-up can
  // be claimed.
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
        if (existing.passwordHash || existing.lastLoginAt || existing.emailVerifiedAt) {
          return reply.code(409).send(ACCOUNT_EXISTS)
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
            return reply.code(409).send(ACCOUNT_EXISTS)
          }

          throw error
        }
      }

      const user = await app.collections.users.findOne({ _id: userId })

      if (!user) {
        return reply.code(500).send({ message: 'Could not create your account.' })
      }

      let verification: { sent: boolean; devLink?: string } = { sent: false }

      try {
        verification = await sendVerification(request.log, user, false)
      } catch (error) {
        // The account still works; the person can resend from the app.
        request.log.error({ err: error, email }, 'Failed to send verification email')
      }

      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })
      reportSignup(request, parsed.data, 'password')

      return reply.code(201).send({ user: serializeUser(user), verification })
    },
  )

  // Passkey sign-up starts with the email: we confirm it first, and the link
  // signs the person in to create the passkey (passkeys need a verified email).
  app.post(
    '/register/passkey',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(registerPasskeySchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a valid email address.' })
      }

      const { email } = parsed.data
      const firstName = parsed.data.firstName ?? ''
      const now = new Date()
      let user = await app.collections.users.findOne({ email })
      let created = false

      if (user) {
        if (user.passwordHash || user.lastLoginAt || user.emailVerifiedAt) {
          return reply.code(409).send(ACCOUNT_EXISTS)
        }

        if (linkSentRecently(user, 'verify_email')) {
          return reply.code(429).send(WAIT_FOR_EMAIL)
        }

        if (!user.firstName && firstName) {
          await app.collections.users.updateOne({ _id: user._id }, { $set: { firstName } })
          user.firstName = firstName
        }
      } else {
        user = {
          _id: new ObjectId(),
          email,
          firstName,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: null,
          emailVerifiedAt: null,
        }

        try {
          await app.collections.users.insertOne(user)
          created = true
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            return reply.code(409).send(ACCOUNT_EXISTS)
          }

          throw error
        }
      }

      reportSignup(request, parsed.data, 'passkey')

      try {
        const result = await sendVerification(request.log, user, true)

        return reply.code(202).send({ ok: true, ...(result.devLink ? { devLink: result.devLink } : {}) })
      } catch (error) {
        request.log.error({ err: error, email }, 'Failed to send passkey sign-up email')

        if (created) {
          await app.collections.users.deleteOne({ _id: user._id })
        }

        return reply.code(503).send(EMAIL_FAILED)
      }
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
          .send({ message: 'Too many attempts. Try again in a few minutes or reset your password.' })
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

  app.post(
    '/verify-email/send',
    { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await app.collections.users.findOne({ _id: requireUserId(request) })

      if (!user) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      if (user.emailVerifiedAt) {
        return reply.code(409).send({ message: 'Your email is already confirmed.' })
      }

      if (linkSentRecently(user, 'verify_email')) {
        return reply.code(429).send(WAIT_FOR_EMAIL)
      }

      try {
        const result = await sendVerification(request.log, user, false)

        return { ok: true, ...(result.devLink ? { devLink: result.devLink } : {}) }
      } catch (error) {
        request.log.error({ err: error, email: user.email }, 'Failed to resend verification email')
        return reply.code(503).send(EMAIL_FAILED)
      }
    },
  )

  // Confirms the email and signs the person in (the link proves they own it).
  app.post(
    '/verify-email',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(tokenSchema, request.body)
      const invalid = { message: 'This confirmation link is invalid, expired or already used.' }
      const payload = parsed.ok ? await readLink(app, parsed.data.token, 'verify_email') : null
      const consumed = payload ? await consumeLink(app, payload, 'verify_email') : null

      if (!payload || !consumed) {
        return reply.code(400).send(invalid)
      }

      const now = new Date()
      const user = await app.collections.users.findOneAndUpdate(
        { _id: consumed._id },
        {
          $set: {
            emailVerifiedAt: consumed.emailVerifiedAt ?? now,
            lastLoginAt: now,
            updatedAt: now,
          },
        },
        { returnDocument: 'after' },
      )

      if (!user) {
        return reply.code(400).send(invalid)
      }

      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })

      return reply.send({
        user: serializeUser(user),
        intent: payload.it === 'passkey' ? 'passkey' : null,
      })
    },
  )

  // Always answers the same way, so it can't be used to find accounts.
  app.post(
    '/password/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(forgotSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a valid email address.' })
      }

      const user = await app.collections.users.findOne({ email: parsed.data.email })

      if (!user || linkSentRecently(user, 'reset_password')) {
        return { ok: true }
      }

      try {
        const url = await createLink(app, user, 'reset_password')
        const result = await deliverLinkEmail({
          log: request.log,
          to: recipient(user),
          link: url,
          content: passwordResetEmail({ firstName: user.firstName, url }),
        })

        return { ok: true, ...(result.devLink ? { devLink: result.devLink } : {}) }
      } catch (error) {
        request.log.error({ err: error, email: user.email }, 'Failed to send password reset email')
        return { ok: true }
      }
    },
  )

  // Sets a new password from a reset link. Proves email ownership, so it also
  // verifies the email; signs out every session and removes passkeys, which
  // is the safe reset if someone else had access.
  app.post(
    '/password/reset',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(resetSchema, request.body)
      const invalid = { message: 'This reset link is invalid, expired or already used.' }

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a new password.' })
      }

      const payload = await readLink(app, parsed.data.token, 'reset_password')

      if (!payload?.em) {
        return reply.code(400).send(invalid)
      }

      // Check the password before using up the link, so a typo keeps it valid.
      const problem = passwordProblem(parsed.data.newPassword, payload.em)

      if (problem) {
        return reply.code(400).send({ message: problem })
      }

      const consumed = await consumeLink(app, payload, 'reset_password')

      if (!consumed) {
        return reply.code(400).send(invalid)
      }

      const now = new Date()
      const [user, removedPasskeys] = await Promise.all([
        app.collections.users.findOneAndUpdate(
          { _id: consumed._id },
          {
            $set: {
              passwordHash: await hashPassword(parsed.data.newPassword),
              passwordUpdatedAt: now,
              emailVerifiedAt: consumed.emailVerifiedAt ?? now,
              failedLoginCount: 0,
              lockedUntil: null,
              lastLoginAt: now,
              updatedAt: now,
            },
          },
          { returnDocument: 'after' },
        ),
        app.collections.passkeys.deleteMany({ userId: consumed._id }),
        app.collections.refreshTokens.updateMany(
          { userId: consumed._id, revokedAt: null },
          { $set: { revokedAt: now } },
        ),
      ])

      if (!user) {
        return reply.code(400).send(invalid)
      }

      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })
      notifyPasswordChanged(request.log, user)

      return reply.send({ user: serializeUser(user), removedPasskeys: removedPasskeys.deletedCount })
    },
  )

  // Sets or changes the password while signed in. Changing requires the
  // current one; other sessions are signed out.
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

      if (user.passwordHash) {
        notifyPasswordChanged(request.log, user)
      }

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
