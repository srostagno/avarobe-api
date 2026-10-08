import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'
import { Binary, ObjectId as MongoObjectId } from 'mongodb'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AuthChallengeDocument, PasskeyDocument } from '../../types/mongo.js'
import { issueAuthSession } from '../../utils/auth-session.js'
import { passkeyAddedEmail, sendNotice } from '../../utils/email.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { appUrl } from '../../utils/locale.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { toObjectId } from '../../utils/object-id.js'
import { serializeUser } from '../../utils/serializers.js'
import { generateSecureToken } from '../../utils/tokens.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_PASSKEYS = 10
const EMAIL_NOT_VERIFIED = {
  message: 'Confirm your email before adding a passkey.',
  code: 'email_not_verified',
}

// The browser's credential JSON; SimpleWebAuthn validates the details.
const credentialSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    rawId: z.string().min(1).max(1_024),
    type: z.literal('public-key'),
    response: z.record(z.unknown()),
  })
  .passthrough()

const registerVerifySchema = z.object({
  challengeId: z.string().min(10).max(100),
  response: credentialSchema,
  name: z.string().trim().max(60).optional(),
})

const loginVerifySchema = z.object({
  challengeId: z.string().min(10).max(100),
  response: credentialSchema,
})

// A readable default name, e.g. "iPhone" or "Mac", from the user agent.
function deviceName(request: FastifyRequest) {
  const agent = request.headers['user-agent'] ?? ''
  const devices: [RegExp, string][] = [
    [/iPhone/i, 'iPhone'],
    [/iPad/i, 'iPad'],
    [/Android/i, 'Android device'],
    [/Macintosh|Mac OS X/i, 'Mac'],
    [/Windows/i, 'Windows PC'],
    [/CrOS/i, 'Chromebook'],
    [/Linux/i, 'Linux computer'],
  ]

  return devices.find(([pattern]) => pattern.test(agent))?.[1] ?? 'Passkey'
}

async function saveChallenge(
  app: FastifyInstance,
  purpose: AuthChallengeDocument['purpose'],
  challenge: string,
  userId: ObjectId | null,
) {
  const challengeId = generateSecureToken(24)

  await app.collections.authChallenges.insertOne({
    _id: challengeId,
    purpose,
    userId,
    challenge,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  })

  return challengeId
}

// Challenges are single use: taking one deletes it.
async function takeChallenge(
  app: FastifyInstance,
  challengeId: string,
  purpose: AuthChallengeDocument['purpose'],
  userId: ObjectId | null,
) {
  const challenge = await app.collections.authChallenges.findOneAndDelete({
    _id: challengeId,
    purpose,
    ...(userId ? { userId } : {}),
  })

  return challenge && challenge.expiresAt.getTime() > Date.now() ? challenge : null
}

function toTransports(values: string[]) {
  return values as AuthenticatorTransportFuture[]
}

function serializePasskey(passkey: PasskeyDocument) {
  return {
    id: passkey._id.toString(),
    name: passkey.name,
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
  }
}

const passkeyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticate }, async (request) => {
    const passkeys = await app.collections.passkeys
      .find({ userId: requireUserId(request) })
      .sort({ createdAt: -1 })
      .toArray()

    return { passkeys: passkeys.map(serializePasskey) }
  })

  app.post(
    '/register/options',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await app.collections.users.findOne({ _id: requireUserId(request) })

      if (!user) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      if (!user.emailVerifiedAt) {
        return reply.code(403).send(EMAIL_NOT_VERIFIED)
      }

      const existing = await app.collections.passkeys.find({ userId: user._id }).toArray()

      if (existing.length >= MAX_PASSKEYS) {
        return reply
          .code(409)
          .send({ message: `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.` })
      }

      const options = await generateRegistrationOptions({
        rpName: 'Avarobe',
        rpID: env.WEBAUTHN_RP_ID,
        userName: user.email,
        userDisplayName: user.firstName || user.email,
        userID: new TextEncoder().encode(user._id.toString()),
        attestationType: 'none',
        excludeCredentials: existing.map((passkey) => ({
          id: passkey.credentialId,
          transports: toTransports(passkey.transports),
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      })
      const challengeId = await saveChallenge(app, 'passkey_register', options.challenge, user._id)

      return { challengeId, options }
    },
  )

  app.post(
    '/register/verify',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await app.collections.users.findOne({ _id: requireUserId(request) })
      const parsed = parseBody(registerVerifySchema, request.body)

      if (!user) {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      if (!user.emailVerifiedAt) {
        return reply.code(403).send(EMAIL_NOT_VERIFIED)
      }

      if (!parsed.ok) {
        return reply.code(400).send({ message: 'Invalid passkey response.' })
      }

      const userId = user._id

      const challenge = await takeChallenge(app, parsed.data.challengeId, 'passkey_register', userId)

      if (!challenge) {
        return reply.code(400).send({ message: 'That took too long. Please try again.' })
      }

      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>

      try {
        verification = await verifyRegistrationResponse({
          response: parsed.data.response as unknown as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: env.WEBAUTHN_ORIGINS,
          expectedRPID: env.WEBAUTHN_RP_ID,
          requireUserVerification: false,
        })
      } catch (error) {
        request.log.warn({ err: errorMessage(error) }, 'Passkey registration rejected')
        return reply.code(400).send({ message: 'We could not verify that passkey.' })
      }

      if (!verification.verified) {
        return reply.code(400).send({ message: 'We could not verify that passkey.' })
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
      const passkey: PasskeyDocument = {
        _id: new MongoObjectId(),
        userId,
        credentialId: credential.id,
        publicKey: new Binary(Buffer.from(credential.publicKey)),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: parsed.data.name || deviceName(request),
        createdAt: new Date(),
        lastUsedAt: null,
      }

      try {
        await app.collections.passkeys.insertOne(passkey)
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return reply.code(409).send({ message: 'This passkey is already saved.' })
        }

        throw error
      }

      void sendNotice({
        log: request.log,
        to: { email: user.email, name: user.firstName },
        content: passkeyAddedEmail({
          firstName: user.firstName,
          deviceName: passkey.name,
          accountUrl: appUrl(user.locale, '/studio/account'),
          locale: user.locale,
        }),
      })

      return reply.code(201).send({ passkey: serializePasskey(passkey) })
    },
  )

  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const passkeyId = toObjectId((request.params as { id?: string }).id)
    const result = passkeyId
      ? await app.collections.passkeys.deleteOne({ _id: passkeyId, userId: requireUserId(request) })
      : null

    if (!result?.deletedCount) {
      return reply.code(404).send({ message: 'Passkey not found.' })
    }

    return { ok: true }
  })

  // Usernameless sign-in: the browser offers whichever Avarobe passkeys the
  // device holds, so there is no email to type.
  app.post(
    '/login/options',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async () => {
      const options = await generateAuthenticationOptions({
        rpID: env.WEBAUTHN_RP_ID,
        userVerification: 'preferred',
      })
      const challengeId = await saveChallenge(app, 'passkey_login', options.challenge, null)

      return { challengeId, options }
    },
  )

  app.post(
    '/login/verify',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = parseBody(loginVerifySchema, request.body)
      const failed = { message: 'We could not sign you in with that passkey.' }

      if (!parsed.ok) {
        return reply.code(400).send(failed)
      }

      const challenge = await takeChallenge(app, parsed.data.challengeId, 'passkey_login', null)

      if (!challenge) {
        return reply.code(400).send({ message: 'That took too long. Please try again.' })
      }

      const passkey = await app.collections.passkeys.findOne({
        credentialId: parsed.data.response.id,
      })

      if (!passkey) {
        return reply.code(401).send({
          message: "This passkey isn't linked to an account anymore. Sign in another way.",
        })
      }

      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>

      try {
        verification = await verifyAuthenticationResponse({
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
          requireUserVerification: false,
        })
      } catch (error) {
        request.log.warn({ err: errorMessage(error) }, 'Passkey login rejected')
        return reply.code(401).send(failed)
      }

      if (!verification.verified) {
        return reply.code(401).send(failed)
      }

      const user = await app.collections.users.findOne({ _id: passkey.userId })

      if (!user) {
        return reply.code(401).send(failed)
      }

      const now = new Date()

      await app.collections.passkeys.updateOne(
        { _id: passkey._id },
        {
          $set: {
            counter: verification.authenticationInfo.newCounter,
            backedUp: verification.authenticationInfo.credentialBackedUp,
            lastUsedAt: now,
          },
        },
      )
      await app.collections.users.updateOne(
        { _id: user._id },
        { $set: { lastLoginAt: now, updatedAt: now } },
      )
      await issueAuthSession(app, reply, request, { id: user._id.toString(), email: user.email })

      return reply.send({ user: serializeUser(user) })
    },
  )
}

export default passkeyRoutes
