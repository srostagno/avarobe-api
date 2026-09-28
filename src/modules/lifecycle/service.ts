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
  kitOfferEmail,
  looksNudgeEmail,
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

export function unsubscribeUrl(userId: ObjectId) {
  return `${env.APP_URL}/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId))}`
}

// ---------------------------------------------------------------- sending

type AvatarFacts = Pick<AvatarDocument, 'userId' | 'status' | 'readyAt' | 'colorAnalysis'>
type LookFacts = { count: number; lastAt: Date | null }

function stateFor(user: UserDocument, avatar: AvatarFacts | undefined, looks: LookFacts): LifecycleState {
  const billing = billingState(user)
  const avatarReady = avatar?.status === 'ready'

  return {
    createdAt: user.createdAt,
    sent: user.lifecycleEmails ?? {},
    lastSentAt: user.lifecycleEmailLastAt ?? null,
    avatarReadyAt: avatarReady ? (avatar.readyAt ?? user.createdAt) : null,
    looks: looks.count,
    lastLookAt: looks.lastAt,
    outOfFreeLooks: billing.credits <= 0 && !billing.kitActive && !billing.everHadKit && !billing.colorReport,
    promotionsAllowed: Boolean(env.EMAIL_POSTAL_ADDRESS),
  }
}

// The email a given kind produces for this person (also used for previews).
export function lifecycleContentFor(
  kind: LifecycleEmailKind,
  user: UserDocument,
  avatar: AvatarFacts | undefined,
  looks: LookFacts,
): EmailContent {
  const recipient = { firstName: user.firstName, email: user.email, unsubscribeUrl: unsubscribeUrl(user._id) }
  const analysis = avatar?.status === 'ready' ? avatar.colorAnalysis : null

  switch (kind) {
    case 'welcome': {
      const stage: WelcomeStage = avatar?.status !== 'ready' ? 'new' : looks.count > 0 ? 'looks' : 'avatar'
      return welcomeEmail({ ...recipient, stage, season: analysis?.season ?? null })
    }
    case 'avatar_nudge':
      return avatarNudgeEmail(recipient)
    case 'looks_nudge':
      // Free accounts see their first three colors in the app; the email
      // shows the same ones, never the locked rest.
      return looksNudgeEmail({ ...recipient, season: analysis?.season ?? null, colors: analysis?.bestColors.slice(0, 3) ?? [] })
    case 'kit_offer':
      return kitOfferEmail(recipient)
  }
}

// Marks the email as sent before sending, so two API processes (or a slow
// run overlapping the next) can never send it twice. A failed send is
// rolled back and retried on a later run.
async function sendOne(app: FastifyInstance, user: UserDocument, kind: LifecycleEmailKind, content: EmailContent, now: Date) {
  const field = `lifecycleEmails.${kind}`
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false }, emailTipsOptOutAt: null },
    { $set: { [field]: now, lifecycleEmailLastAt: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  try {
    const delivered = await deliverEmail({
      log: app.log,
      to: { email: user.email, name: user.firstName },
      content,
    })
    app.log.info({ userId: user._id.toString(), kind, delivered }, 'Lifecycle email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString(), kind }, 'Lifecycle email failed; will retry')
    await app.collections.users.updateOne(
      { _id: user._id },
      user.lifecycleEmailLastAt
        ? { $unset: { [field]: '' }, $set: { lifecycleEmailLastAt: user.lifecycleEmailLastAt } }
        : { $unset: { [field]: '', lifecycleEmailLastAt: '' } },
    )
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

      if (kind && (await sendOne(app, user, kind, lifecycleContentFor(kind, user, avatar, looks), now))) {
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
