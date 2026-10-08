import type { FastifyBaseLogger, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { REFRESH_TOKEN_COOKIE } from '../../constants/auth.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { UserDocument } from '../../types/mongo.js'
import { consumeLink, createLink, linkSentRecently, readLink, safeNextPath, type LinkPayload } from '../../utils/auth-links.js'
import {
  clearAuthCookies,
  issueAuthSession,
  rotateAuthSession,
} from '../../utils/auth-session.js'
import {
  continueInBrowserEmail,
  deliverLinkEmail,
  passwordChangedEmail,
  passwordResetEmail,
  savedEmail,
  sendNotice,
  signInLinkEmail,
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
import { appUrl, requestLocale } from '../../utils/locale.js'
import { hashToken } from '../../utils/tokens.js'
import { signupLocation } from '../analytics/geo.js'
import { acquisitionSchema, optionalUserId, toAcquisition, trackServerEvent } from '../analytics/service.js'
import { attributionMetadata, reportRegistration } from '../billing/conversions.js'
import { recordRegisteredClick } from '../events/service.js'
import { GuestLimitError, claimGuest, createGuest } from './guests.js'

const emailField = z.string().trim().toLowerCase().email().max(254)
const passwordField = z.string().min(1).max(MAX_PASSWORD_LENGTH)
const firstNameField = z.string().trim().max(60).optional()
const tokenField = z.string().min(20).max(2_000)

// Meta's _fbc carries the whole ad click id, often well over 200
// characters. An id that still doesn't fit is dropped: measurement must
// never be the reason a sign-up fails (it cost Meta sign-ups in Sep 2026).
const idField = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,1024}$/)
  .optional()
  .catch(undefined)

// Analytics ids from the browser (absent when the visitor opted out), and
// the id the pixel used for this sign-up, so Meta merges both reports.
const signupTracking = {
  attribution: z.object({ gaClientId: idField, fbp: idField, fbc: idField }).optional().catch(undefined),
  eventId: z.string().uuid().optional().catch(undefined),
  // First-party analytics: the visitor's first touch (channel, campaign).
  acquisition: acquisitionSchema.optional().catch(undefined),
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
// Trying first (guests): only where they came from; then their email to save.
const guestSchema = z.object({ acquisition: signupTracking.acquisition })
const claimSchema = z.object({
  email: emailField,
  firstName: firstNameField,
  ...signupTracking,
})
const tokenSchema = z.object({ token: tokenField })
const resetSchema = z.object({ token: tokenField, newPassword: passwordField })
// Another browser, signed in: where to land, and this browser's ad ids.
const handoffSchema = z.object({
  next: z.string().max(300).optional(),
  attribution: signupTracking.attribution,
})

const BOT_AGENT = /bot\b|crawl|spider|slurp|facebookexternalhit|headless/i

const MAX_FAILED_LOGINS = 10
const LOCKOUT_MS = 15 * 60 * 1000
const ACCOUNT_EXISTS = { message: 'An account with this email already exists. Sign in instead.' }
const EMAIL_TAKEN = {
  code: 'email_taken',
  message: 'You already have an Avarobe account with this email. Sign in to continue there.',
}
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
    method: 'password' | 'passkey' | 'guest',
    userId: ObjectId,
  ) {
    const metadata = attributionMetadata(data.attribution, request)

    void trackServerEvent(app, { name: 'signup_completed', userId, props: { method } })

    if (data.eventId) {
      void reportRegistration(app, { metadata, eventId: data.eventId, method })
    }

    void recordRegisteredClick(app, data.attribution?.fbc, userId).catch((error: unknown) =>
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
        resetUrl: appUrl(user.locale, '/login?mode=forgot'),
      }),
    })
  }

  // Who this browser is signed in as, even with an expired access token (the
  // refresh cookie still says): signing up while trying as a guest saves the
  // guest instead of starting an empty account.
  async function sessionUserId(request: FastifyRequest) {
    const fromAccess = await optionalUserId(request)

    if (fromAccess) {
      return fromAccess
    }

    const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE]
    const stored = refreshToken ? await app.collections.refreshTokens.findOne({ tokenHash: hashToken(refreshToken) }) : null

    return stored && !stored.revokedAt && stored.expiresAt.getTime() > Date.now() ? stored.userId : null
  }

  async function signedInGuest(request: FastifyRequest) {
    const userId = await sessionUserId(request)
    const user = userId ? await app.collections.users.findOne({ _id: userId }, { projection: { guest: 1 } }) : null

    return user?.guest ? user._id : null
  }

  // The link that confirms a saved guest's email and signs them back in.
  async function sendSaved(log: FastifyBaseLogger, user: UserDocument) {
    const url = await createLink(app, user, 'verify_email')

    return deliverLinkEmail({ log, to: recipient(user), link: url, content: savedEmail({ firstName: user.firstName, url }) })
  }

  // Try first: a guest session, so the selfie and colors come before any
  // form. Someone already signed in keeps their account.
  app.post(
    '/guest',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const current = await sessionUserId(request)
      const existing = current ? await app.collections.users.findOne({ _id: current }) : null

      if (existing) {
        return reply.send({ user: serializeUser(existing) })
      }

      // Crawlers that run scripts (and follow links, like Googlebot) would
      // each start a guest account.
      if (BOT_AGENT.test(request.headers['user-agent'] ?? '')) {
        return reply.code(403).send({ message: 'Create a free account to continue.' })
      }

      const parsed = parseBody(guestSchema, request.body ?? {})
      let user: UserDocument

      try {
        user = await createGuest(app, request, parsed.ok ? parsed.data.acquisition : undefined)
      } catch (error) {
        if (error instanceof GuestLimitError) {
          return reply.code(429).send({ code: 'guest_limit', message: 'Create a free account to continue.' })
        }

        throw error
      }

      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })

      return reply.code(201).send({ user: serializeUser(user) })
    },
  )

  // A guest saves with their email (to buy, or to keep their colors): the
  // same account, now theirs, with no password. The email confirms it and
  // is how they sign back in. It counts as the sign-up (Meta, analytics).
  app.post(
    '/claim',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(claimSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a valid email address.' })
      }

      const result = await claimGuest(app, requireUserId(request), {
        email: parsed.data.email,
        firstName: parsed.data.firstName ?? '',
        acquisition: toAcquisition(parsed.data.acquisition),
        locale: requestLocale(request),
      })

      if (!result.ok) {
        return result.reason === 'email_taken'
          ? reply.code(409).send(EMAIL_TAKEN)
          : reply.code(409).send({ code: 'not_guest', message: 'Your account is already saved.' })
      }

      const { user } = result

      try {
        await sendSaved(request.log, user)
      } catch (error) {
        request.log.error({ err: error, email: user.email }, 'Failed to send the saved email')
      }

      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })
      reportSignup(request, parsed.data, 'guest', user._id)

      return reply.send({ user: serializeUser(user) })
    },
  )

  // Signing in without a password (saved guests have none): a one-time link
  // by email. Always answers the same way, so it can't be used to find
  // accounts.
  app.post(
    '/link/email',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(forgotSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Enter a valid email address.' })
      }

      const user = await app.collections.users.findOne({ email: parsed.data.email })

      if (!user || user.guest || linkSentRecently(user, 'sign_in')) {
        return { ok: true }
      }

      try {
        const url = await createLink(app, user, 'sign_in', undefined, { next: '/studio' })
        const result = await deliverLinkEmail({
          log: request.log,
          to: recipient(user),
          link: url,
          content: signInLinkEmail({ firstName: user.firstName, url }),
        })

        return { ok: true, ...(result.devLink ? { devLink: result.devLink } : {}) }
      } catch (error) {
        request.log.error({ err: error, email: user.email }, 'Failed to send the sign-in link')
        return { ok: true }
      }
    },
  )

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
      const guestId = await signedInGuest(request)

      // Trying as a guest, then signing up: their colors come along.
      if (guestId) {
        const claimed = await claimGuest(app, guestId, {
          email,
          firstName,
          passwordHash,
          acquisition: toAcquisition(parsed.data.acquisition),
          locale: requestLocale(request),
        })

        if (!claimed.ok) {
          return reply.code(409).send(ACCOUNT_EXISTS)
        }

        const verification = await sendVerification(request.log, claimed.user, false).catch((error: unknown) => {
          request.log.error({ err: error, email }, 'Failed to send verification email')
          return { sent: false }
        })

        await issueAuthSession(app, reply, request, { id: claimed.user._id.toString(), email: claimed.user.email })
        reportSignup(request, parsed.data, 'password', claimed.user._id)

        return reply.code(201).send({ user: serializeUser(claimed.user), verification })
      }

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
            credits: env.SIGNUP_CREDITS,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
            emailVerifiedAt: null,
            passwordHash,
            passwordUpdatedAt: now,
            locale: requestLocale(request),
            acquisition: toAcquisition(parsed.data.acquisition),
            location: signupLocation(request, now),
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
      reportSignup(request, parsed.data, 'password', user._id)

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
          credits: env.SIGNUP_CREDITS,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: null,
          emailVerifiedAt: null,
          locale: requestLocale(request),
          acquisition: toAcquisition(parsed.data.acquisition),
          location: signupLocation(request, now),
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

      reportSignup(request, parsed.data, 'passkey', user._id)

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

  // From Instagram's or Facebook's in-app browser to the phone's own one,
  // where Apple Pay and saved cards work (nobody has finished a checkout
  // inside those browsers): a one-time link that opens there signed in, on
  // the same page, with this browser's ad ids so the purchase still reaches
  // Meta. It expires in minutes (HANDOFF_LINK_TTL).
  app.post(
    '/handoff',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await app.collections.users.findOne({ _id: requireUserId(request) })
      const parsed = parseBody(handoffSchema, request.body ?? {})

      if (!user) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const url = await createLink(app, user, 'handoff', undefined, {
        next: parsed.data.next,
        ads: parsed.data.attribution,
      })
      void trackServerEvent(app, { name: 'handoff_link_created', userId: user._id, props: { next: safeNextPath(parsed.data.next) } })

      return { url }
    },
  )

  // The same link by email, for when the in-app browser won't let go: it
  // opens from the mail app in the phone's own browser.
  app.post(
    '/handoff/email',
    { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await app.collections.users.findOne({ _id: requireUserId(request) })
      const parsed = parseBody(handoffSchema, request.body ?? {})

      if (!user) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      if (linkSentRecently(user, 'sign_in')) {
        return reply.code(429).send(WAIT_FOR_EMAIL)
      }

      try {
        const url = await createLink(app, user, 'sign_in', undefined, {
          next: parsed.data.next,
          ads: parsed.data.attribution,
        })
        const result = await deliverLinkEmail({
          log: request.log,
          to: recipient(user),
          link: url,
          content: continueInBrowserEmail({ firstName: user.firstName, url }),
        })
        void trackServerEvent(app, { name: 'handoff_email_sent', userId: user._id, props: { next: safeNextPath(parsed.data.next) } })

        return { ok: true, ...(result.devLink ? { devLink: result.devLink } : {}) }
      } catch (error) {
        request.log.error({ err: error, email: user.email }, 'Failed to send the continue link')
        return reply.code(503).send(EMAIL_FAILED)
      }
    },
  )

  // Uses a handoff or sign-in link: signs the person in on this browser and
  // says where to go, with the ad ids the link carried. An emailed link also
  // confirms the email (it proves they own it); a handoff link doesn't.
  app.post(
    '/link',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(tokenSchema, request.body)
      const invalid = { message: 'This link is invalid, expired or already used.' }
      let payload: LinkPayload | null = null

      if (parsed.ok) {
        payload = (await readLink(app, parsed.data.token, 'handoff')) ?? (await readLink(app, parsed.data.token, 'sign_in'))
      }

      const purpose = payload?.typ === 'sign_in' ? 'sign_in' : 'handoff'
      const consumed = payload ? await consumeLink(app, payload, purpose) : null

      if (!payload || !consumed) {
        return reply.code(400).send(invalid)
      }

      const now = new Date()
      const user = await app.collections.users.findOneAndUpdate(
        { _id: consumed._id },
        {
          $set: {
            ...(purpose === 'sign_in' ? { emailVerifiedAt: consumed.emailVerifiedAt ?? now } : {}),
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
      void trackServerEvent(app, { name: 'handoff_link_used', userId: user._id, props: { purpose } })

      return reply.send({ user: serializeUser(user), next: safeNextPath(payload.nx), attribution: payload.ad ?? null })
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
