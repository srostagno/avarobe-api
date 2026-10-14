import type { FastifyInstance } from 'fastify'

import { env } from '../config/env.js'
import { isAdmin } from '../modules/billing/entitlements.js'
import type { UserDocument } from '../types/mongo.js'
import { appUrl, LOCALE_PREFIXES } from './locale.js'
import { toObjectId } from './object-id.js'
import { generateSecureToken, hashToken } from './tokens.js'

// One-time links sent by email. The JWT carries a nonce whose hash is stored
// on the user; using the link clears it, so each link works once and sending
// a new one voids the previous. 'handoff' and 'sign_in' sign the person in
// on another browser: from Instagram's or Facebook's in-app browser to the
// phone's own (where Apple Pay and saved cards work), and from the email
// that brings back an unfinished checkout. 'checkout' is the link emailed
// the moment they tap Buy inside those browsers: its own nonce, so the
// other emails' sign-in links (offers, rescue) don't void it. 'colors' is
// the link to their colors after a read the AI did late, its own for the
// same reason: the colors offer follows it within a day.
export type LinkPurpose = 'verify_email' | 'reset_password' | 'handoff' | 'sign_in' | 'checkout' | 'colors'

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
  checkout: {
    nonceField: 'checkoutLinkNonceHash',
    sentAtField: 'checkoutLinkSentAt',
    ttl: () => env.SIGN_IN_LINK_TTL,
    path: '/continue',
  },
  colors: {
    nonceField: 'colorsLinkNonceHash',
    sentAtField: 'colorsLinkSentAt',
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
  // Email links: when the password last changed (0 for none), so changing it
  // voids them.
  pw?: number
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


// ---------------------------------------------------------------- email links

// The sign-in links in our emails (Oct 14, 2026). The one-time links above
// broke in real life: an email opened in Gmail's own browser, then again in
// Safari, found its link used up; each new email voided the last one's; and
// a guest has no password to sign in with. On Oct 13 a US buyer lost her
// session that way and her Buy taps went nowhere until she reset a password
// she never had. These work until EMAIL_LINK_TTL, as often as needed and in
// any browser. A password change voids them (pw), a deleted account's email
// is an alias so they stop matching (em), and an admin never gets one.
export async function emailLink(
  app: FastifyInstance,
  user: Pick<UserDocument, '_id' | 'email' | 'locale' | 'passwordUpdatedAt'>,
  next: string,
  options: { ads?: LinkAdIds; ttl?: string } = {},
) {
  const path = safeNextPath(next)

  if (isAdmin(user)) {
    return appUrl(user.locale, path)
  }

  const token = await app.jwt.sign(
    {
      typ: 'email',
      sub: user._id.toString(),
      em: user.email,
      pw: passwordStamp(user),
      nx: path,
      ...(options.ads && Object.keys(options.ads).length > 0 ? { ad: options.ads } : {}),
    },
    { expiresIn: options.ttl ?? env.EMAIL_LINK_TTL },
  )

  return `${appUrl(user.locale, '/continue')}?token=${encodeURIComponent(token)}`
}

function passwordStamp(user: Pick<UserDocument, 'passwordUpdatedAt'>) {
  return user.passwordUpdatedAt ? user.passwordUpdatedAt.getTime() : 0
}

// An email link's person, when it still holds: signature, expiry, the same
// email and password, the account not deleted. Never used up.
export async function readEmailLink(app: FastifyInstance, token: string) {
  let payload: LinkPayload

  try {
    payload = await app.jwt.verify<LinkPayload>(token)
  } catch {
    return null
  }

  const userId = payload.typ === 'email' ? toObjectId(payload.sub) : null

  if (!userId || !payload.em) {
    return null
  }

  const user = await app.collections.users.findOne({ _id: userId, email: payload.em })

  if (!user || user.deletedAt || (payload.pw ?? 0) !== passwordStamp(user) || isAdmin(user)) {
    return null
  }

  return { payload, user }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Every link to the studio in an email to someone with an account, made an
// email link to the same page, so whichever browser opens it lands signed
// in: one link per address. Admins' and deleted accounts' links stay plain.
export async function signInStudioLinks<T extends { html: string; text: string }>(
  app: FastifyInstance,
  user: Pick<UserDocument, '_id' | 'email' | 'locale' | 'passwordUpdatedAt' | 'deletedAt'>,
  content: T,
  options: { ads?: LinkAdIds } = {},
): Promise<T> {
  if (user.deletedAt || isAdmin(user)) {
    return content
  }

  const prefixes = LOCALE_PREFIXES.filter(Boolean).map(escapeRegExp).join('|')
  const pattern = new RegExp(`${escapeRegExp(env.APP_URL)}(?:${prefixes})?(/studio(?:[/?#][^"'\\s<>)]*)?)`, 'g')
  const links = new Map<string, string>()

  for (const field of ['html', 'text'] as const) {
    for (const match of content[field].matchAll(pattern)) {
      const path = match[1]!.replace(/&amp;/g, '&')

      if (!links.has(path)) {
        links.set(path, await emailLink(app, user, path, options))
      }
    }
  }

  if (links.size === 0) {
    return content
  }

  const swap = (value: string, html: boolean) =>
    value.replace(pattern, (whole, path: string) => {
      const url = links.get(path.replace(/&amp;/g, '&'))
      return url ? (html ? url.replace(/&/g, '&amp;') : url) : whole
    })

  return { ...content, html: swap(content.html, true), text: swap(content.text, false) }
}

