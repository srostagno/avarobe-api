import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { AvatarDocument, LifecycleEmailKind, UserDocument } from '../../types/mongo.js'
import { deliverEmail } from '../../utils/email.js'
import { hmacSign, hmacVerify } from '../../utils/tokens.js'
import { billingState, isAdmin } from '../billing/entitlements.js'
import { LIFECYCLE_RULES, pickLifecycleEmail, type LifecycleState } from './schedule.js'
import {
  avatarNudgeEmail,
  looksNudgeEmail,
  upgradeLastCallEmail,
  upgradeOfferEmail,
  upgradeReminderEmail,
  welcomeEmail,
  type EmailContent,
  type WelcomeStage,
} from './templates.js'

const RUN_EVERY_MS = 10 * 60 * 1000
const FIRST_RUN_AFTER_MS = 60 * 1000
const BATCH = 500

// ---------------------------------------------------------------- unsubscribe

// The unsubscribe link works without signing in, so it carries the account
// id signed with the server secret.
function tokenSignature(userId: string) {
  return hmacSign(env.JWT_ACCESS_SECRET, `email-tips:${userId}`)
}

export function unsubscribeToken(userId: ObjectId) {
  const id = userId.toString()
  return `${id}.${tokenSignature(id)}`
}

export function userIdFromUnsubscribeToken(token: string) {
  const [id, signature] = token.split('.')

  if (!id || !signature || !ObjectId.isValid(id) || !hmacVerify(env.JWT_ACCESS_SECRET, `email-tips:${id}`, signature)) {
    return null
  }

  return new ObjectId(id)
}

// `sendId` credits the unsubscribe to the email it came from.
export function unsubscribeUrl(userId: ObjectId, sendId?: ObjectId) {
  const url = new URL('/email/unsubscribe', `${env.APP_URL}/`)
  url.searchParams.set('t', unsubscribeToken(userId))

  if (sendId) {
    url.searchParams.set('e', sendId.toString())
  }

  return url.toString()
}

// ---------------------------------------------------------------- tracking
// Opens come from a 1x1 image and clicks from a redirect, both on the API.
// Only links back to the app (tagged utm_source=email) are wrapped; the
// footer's preferences and unsubscribe links stay direct. The redirect is
// signed per link, so it can't be used to send people anywhere else.

const clickSignature = (sendId: string, target: string) =>
  hmacSign(env.JWT_ACCESS_SECRET, `email-click:${sendId}:${target}`)

export function trackedLink(sendId: ObjectId, target: string) {
  const id = sendId.toString()
  const url = new URL(`/api/v1/email/c/${id}`, `${env.API_PUBLIC_URL}/`)
  url.searchParams.set('u', target)
  url.searchParams.set('s', clickSignature(id, target))
  return url.toString()
}

// The destination of a tracked link, if the link is genuine and still
// points at the app.
export function clickTarget(sendId: string, target: string, signature: string) {
  if (!ObjectId.isValid(sendId) || !hmacVerify(env.JWT_ACCESS_SECRET, `email-click:${sendId}:${target}`, signature)) {
    return null
  }

  try {
    const url = new URL(target)
    const app = new URL(env.APP_URL)
    const host = (value: string) => value.replace(/^www\./, '')
    return host(url.hostname) === host(app.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

const unescapeHtml = (value: string) => value.replace(/&amp;/g, '&')
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const isAppLink = (url: string) => url.startsWith(env.APP_URL) && url.includes('utm_source=email')

export function trackContent(content: EmailContent, sendId: ObjectId): EmailContent {
  const pixel = `<img src="${escapeAttribute(`${env.API_PUBLIC_URL}/api/v1/email/o/${sendId.toString()}.gif`)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`
  const html = content.html
    .replace(/href="([^"]+)"/g, (match, raw: string) => {
      const url = unescapeHtml(raw)
      return isAppLink(url) ? `href="${escapeAttribute(trackedLink(sendId, url))}"` : match
    })
    .replace('</body>', `${pixel}\n</body>`)
  const text = content.text.replace(/https?:\/\/\S+/g, (url) => (isAppLink(url) ? trackedLink(sendId, url) : url))

  return { ...content, html, text }
}

export async function recordOpen(app: FastifyInstance, sendId: ObjectId) {
  const now = new Date()
  await app.collections.emailSends.updateOne({ _id: sendId }, { $inc: { opens: 1 }, $min: { firstOpenAt: now } })
}

export async function recordClick(app: FastifyInstance, sendId: ObjectId) {
  const now = new Date()
  // A click means it was opened too, even with images off.
  await app.collections.emailSends.updateOne(
    { _id: sendId },
    { $inc: { clicks: 1 }, $min: { firstClickAt: now, firstOpenAt: now }, $set: { lastClickAt: now } },
  )
}

export async function recordUnsubscribe(app: FastifyInstance, sendId: string, userId: ObjectId) {
  if (ObjectId.isValid(sendId)) {
    await app.collections.emailSends.updateOne(
      { _id: new ObjectId(sendId), userId },
      { $min: { unsubscribedAt: new Date() } },
    )
  }
}

// ---------------------------------------------------------------- sending

type AvatarFacts = Pick<AvatarDocument, 'userId' | 'status' | 'readyAt' | 'colorAnalysis'>
type LookFacts = { count: number; lastAt: Date | null }

function stateFor(user: UserDocument, avatar: AvatarFacts | undefined, looks: LookFacts): LifecycleState {
  const billing = billingState(user)
  const avatarReady = avatar?.status === 'ready'
  const sent = { ...(user.lifecycleEmails ?? {}) }
  // The first price list's offer counts as this one's.
  const legacyOffer = (user.lifecycleEmails as Record<string, Date> | undefined)?.kit_offer

  if (!sent.upgrade_offer && legacyOffer) {
    sent.upgrade_offer = legacyOffer
  }

  return {
    createdAt: user.createdAt,
    sent,
    lastSentAt: user.lifecycleEmailLastAt ?? null,
    avatarReadyAt: avatarReady ? (avatar.readyAt ?? user.createdAt) : null,
    looks: looks.count,
    lastLookAt: looks.lastAt,
    outOfFreeLooks: billing.credits <= 0 && !billing.proActive,
    paid: billing.paid || billing.comp,
    promotionsAllowed: Boolean(env.EMAIL_POSTAL_ADDRESS),
  }
}

// The email a given kind produces for this person (also used for previews).
export function lifecycleContentFor(
  kind: LifecycleEmailKind,
  user: UserDocument,
  avatar: AvatarFacts | undefined,
  looks: LookFacts,
  sendId?: ObjectId,
): EmailContent {
  const recipient = { firstName: user.firstName, email: user.email, unsubscribeUrl: unsubscribeUrl(user._id, sendId) }
  const analysis = avatar?.status === 'ready' ? avatar.colorAnalysis : null
  // Free accounts see their first three colors in the app; the emails show
  // the same ones, never the locked rest.
  const freeColors = analysis?.bestColors.slice(0, 3) ?? []

  switch (kind) {
    case 'welcome': {
      const stage: WelcomeStage = avatar?.status !== 'ready' ? 'new' : looks.count > 0 ? 'looks' : 'avatar'
      return welcomeEmail({ ...recipient, stage, season: analysis?.season ?? null })
    }
    case 'avatar_nudge':
      return avatarNudgeEmail(recipient)
    case 'looks_nudge':
      return looksNudgeEmail({ ...recipient, season: analysis?.season ?? null, colors: freeColors })
    case 'upgrade_offer':
      return upgradeOfferEmail(recipient)
    case 'upgrade_reminder':
      return upgradeReminderEmail({ ...recipient, season: analysis?.season ?? null, colors: freeColors })
    case 'upgrade_last_call':
      return upgradeLastCallEmail(recipient)
  }
}

// Marks the email as sent before sending, so two API processes (or a slow
// run overlapping the next) can never send it twice. A failed send is
// rolled back and retried on a later run.
async function sendOne(
  app: FastifyInstance,
  user: UserDocument,
  kind: LifecycleEmailKind,
  facts: { avatar: AvatarFacts | undefined; looks: LookFacts },
  now: Date,
) {
  const field = `lifecycleEmails.${kind}`
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false }, emailTipsOptOutAt: null },
    { $set: { [field]: now, lifecycleEmailLastAt: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()
  const content = lifecycleContentFor(kind, user, facts.avatar, facts.looks, sendId)

  try {
    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind,
      subject: content.subject,
      sentAt: now,
      opens: 0,
      clicks: 0,
    })

    const delivered = await deliverEmail({
      log: app.log,
      to: { email: user.email, name: user.firstName },
      content: trackContent(content, sendId),
    })
    app.log.info({ userId: user._id.toString(), kind, delivered }, 'Lifecycle email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString(), kind }, 'Lifecycle email failed; will retry')
    await Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne(
        { _id: user._id },
        user.lifecycleEmailLastAt
          ? { $unset: { [field]: '' }, $set: { lifecycleEmailLastAt: user.lifecycleEmailLastAt } }
          : { $unset: { [field]: '', lifecycleEmailLastAt: '' } },
      ),
    ])
    return false
  }
}

let running = false

// One pass: everyone who signed up recently and still wants tips gets the
// email they are due, if any.
export async function sendDueLifecycleEmails(app: FastifyInstance, now = new Date()) {
  if (running) {
    return { checked: 0, sent: 0 }
  }

  running = true

  try {
    const users = (
      await app.collections.users
        .find({ createdAt: { $gte: new Date(now.getTime() - LIFECYCLE_RULES.horizon) }, emailTipsOptOutAt: null })
        .limit(BATCH)
        .toArray()
    ).filter((user) => !isAdmin(user))

    if (users.length === 0) {
      return { checked: 0, sent: 0 }
    }

    const ids = users.map((user) => user._id)
    const [avatars, lookStats] = await Promise.all([
      app.collections.avatars
        .find({ userId: { $in: ids } }, { projection: { userId: 1, status: 1, readyAt: 1, colorAnalysis: 1 } })
        .toArray(),
      app.collections.looks
        .aggregate<{ _id: ObjectId; count: number; lastAt: Date | null }>([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
        ])
        .toArray(),
    ])
    const avatarByUser = new Map(avatars.map((avatar) => [avatar.userId.toString(), avatar]))
    const looksByUser = new Map(lookStats.map((stat) => [stat._id.toString(), { count: stat.count, lastAt: stat.lastAt }]))
    let sent = 0

    for (const user of users) {
      const id = user._id.toString()
      const avatar = avatarByUser.get(id)
      const looks = looksByUser.get(id) ?? { count: 0, lastAt: null }
      const kind = pickLifecycleEmail(stateFor(user, avatar, looks), now)

      if (kind && (await sendOne(app, user, kind, { avatar, looks }, now))) {
        sent += 1
      }
    }

    return { checked: users.length, sent }
  } finally {
    running = false
  }
}

export function startLifecycleEmails(app: FastifyInstance) {
  if (!env.LIFECYCLE_EMAILS) {
    app.log.info('Lifecycle emails are off (LIFECYCLE_EMAILS)')
    return
  }

  const run = () => {
    void sendDueLifecycleEmails(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Lifecycle email run crashed')
    })
  }

  setTimeout(run, FIRST_RUN_AFTER_MS).unref()
  setInterval(run, RUN_EVERY_MS).unref()
}
