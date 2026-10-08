import type { FastifyInstance } from 'fastify'

import { env } from '../config/env.js'
import type { UserDocument } from '../types/mongo.js'
import { appUrl } from './locale.js'
import { toObjectId } from './object-id.js'
import { generateSecureToken, hashToken } from './tokens.js'

// One-time links sent by email. The JWT carries a nonce whose hash is stored
// on the user; using the link clears it, so each link works once and sending
// a new one voids the previous. 'handoff' and 'sign_in' sign the person in
// on another browser: from Instagram's or Facebook's in-app browser to the
// phone's own (where Apple Pay and saved cards work), and from the email
// that brings back an unfinished checkout.
export type LinkPurpose = 'verify_email' | 'reset_password' | 'handoff' | 'sign_in'

const LINKS = {
  verify_email: {
    nonceField: 'emailVerificationNonceHash',
    sentAtField: 'emailVerificationSentAt',
    ttl: () => env.VERIFY_EMAIL_TTL,
    path: '/verify-email',
  },
  reset_password: {
    nonceField: 'passwordResetNonceHash',
    sentAtField: 'passwordResetSentAt',
    ttl: () => env.PASSWORD_RESET_TTL,
    path: '/reset-password',
  },
  handoff: {
    nonceField: 'handoffNonceHash',
    sentAtField: 'handoffSentAt',
    ttl: () => env.HANDOFF_LINK_TTL,
    path: '/continue',
  },
  sign_in: {
    nonceField: 'signInNonceHash',
    sentAtField: 'signInSentAt',
    ttl: () => env.SIGN_IN_LINK_TTL,
    path: '/continue',
  },
} as const

// The ad ids of the browser the link came from, so a purchase made on the
// other one still reaches Meta and GA with them.
export type LinkAdIds = { fbp?: string; fbc?: string; gaClientId?: string }

const RESEND_COOLDOWN_MS = 60 * 1000

export type LinkPayload = {
  typ?: string
  sub?: string
  em?: string
  nn?: string
  it?: string
  // Sign-in links: where to land (a studio path), and the ad ids.
  nx?: string
  ad?: LinkAdIds
}

// Only paths inside the studio, so a link can't send anyone elsewhere.
export function safeNextPath(next: string | null | undefined) {
  return next && /^\/studio(?:[/?#]|$)/.test(next) && !next.includes('//') ? next.slice(0, 300) : '/studio'
}

export function linkSentRecently(user: UserDocument, purpose: LinkPurpose) {
  const sentAt = user[LINKS[purpose].sentAtField]

  return Boolean(sentAt && Date.now() - sentAt.getTime() < RESEND_COOLDOWN_MS)
}

export async function createLink(
  app: FastifyInstance,
  user: UserDocument,
  purpose: LinkPurpose,
  intent?: 'passkey',
  landing?: { next?: string; ads?: LinkAdIds },
) {
  const [url] = await createLinks(app, user, purpose, [landing?.next], { intent, ads: landing?.ads })
  return url!
}

// Several links in one email, one per button, each landing somewhere else.
// They share one nonce: separate createLink calls would void each other, so
// only the last button would work. Whichever is used first signs them in
// and voids the rest, like any used link.
export async function createLinks(
  app: FastifyInstance,
  user: UserDocument,
  purpose: LinkPurpose,
  nexts: (string | undefined)[],
  options: { intent?: 'passkey'; ads?: LinkAdIds } = {},
) {
  const config = LINKS[purpose]
  const nonce = generateSecureToken(24)
  const { intent, ads } = options

  await app.collections.users.updateOne(
    { _id: user._id },
    { $set: { [config.nonceField]: hashToken(nonce), [config.sentAtField]: new Date() } },
  )

  return Promise.all(
    nexts.map(async (next) => {
      const token = await app.jwt.sign(
        {
          typ: purpose,
          sub: user._id.toString(),
          em: user.email,
          nn: nonce,
          ...(intent ? { it: intent } : {}),
          ...(next ? { nx: safeNextPath(next) } : {}),
          ...(ads && Object.keys(ads).length > 0 ? { ad: ads } : {}),
        },
        { expiresIn: config.ttl() },
      )

      // In their language, so the page that opens is too.
      return `${appUrl(user.locale, config.path)}?token=${encodeURIComponent(token)}`
    }),
  )
}

// Checks signature, expiry and purpose without using up the link.
export async function readLink(app: FastifyInstance, token: string, purpose: LinkPurpose) {
  try {
    const payload = await app.jwt.verify<LinkPayload>(token)

    return payload.typ === purpose && payload.sub && payload.em && payload.nn ? payload : null
  } catch {
    return null
  }
}

// Uses up the link atomically. Returns the user, or null when the link was
// already used, replaced by a newer one, or the email changed.
export async function consumeLink(
  app: FastifyInstance,
  payload: LinkPayload,
  purpose: LinkPurpose,
) {
  const userId = toObjectId(payload.sub)

  if (!userId || !payload.em || !payload.nn) {
    return null
  }

  const field = LINKS[purpose].nonceField

  return app.collections.users.findOneAndUpdate(
    { _id: userId, email: payload.em, [field]: hashToken(payload.nn) },
    { $set: { [field]: null } },
    { returnDocument: 'after' },
  )
}
