import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { AvatarDocument, ColorSwatch, LifecycleEmailKind, UserDocument } from '../../types/mongo.js'
import { deliverEmail } from '../../utils/email.js'
import { hmacSign, hmacVerify } from '../../utils/tokens.js'
import { billingState, isAdmin } from '../billing/entitlements.js'
import { LIFECYCLE_RULES, pickLifecycleEmail, type LifecycleState } from './schedule.js'
import {
  appLink,
  avatarNudgeEmail,
  checkoutRescueEmail,
  looksNudgeEmail,
  priceDropEmail,
  trialEndingEmail,
  trialStartedEmail,
  upgradeLastCallEmail,
  upgradeOfferEmail,
  upgradeReminderEmail,
  welcomeEmail,
  type EmailContent,
  type WelcomeStage,
} from './templates.js'
import { createLink } from '../../utils/auth-links.js'
import { focusOf } from '../../utils/serializers.js'

const RUN_EVERY_MS = 10 * 60 * 1000
const FIRST_RUN_AFTER_MS = 60 * 1000
const BATCH = 500
// The trial reminder goes out this long before the first monthly charge.
const TRIAL_REMINDER_BEFORE_MS = 48 * 60 * 60 * 1000
// Admins' simulated plans never reach Stripe, or their inbox.
const SIMULATED_SUBSCRIPTION = 'sim_admin'
// An unpaid checkout gets its rescue email after this long, within two days.
const RESCUE_AFTER_MS = 60 * 60 * 1000
const RESCUE_WITHIN_MS = 48 * 60 * 60 * 1000
// The 2-Oct-2026 price cut ($14.90 → $4.99): one email to people who opened
// an offer at the old price (since the 28-Sep price list) and bought
// nothing. It goes out between 10:00 and 20:00 New York time, at least
// `gap` after their last onboarding email, until `until`.
const PRICE_DROP = {
  cutAt: new Date('2026-10-02T09:25:00Z'),
  offersSince: new Date('2026-09-28T00:00:00Z'),
  until: new Date('2026-10-05T04:00:00Z'),
  gap: 18 * 60 * 60 * 1000,
  hours: { from: 10, to: 20 },
}
// How long the photo in that email keeps loading.
const EMAIL_IMAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000

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

type AvatarFacts = Pick<AvatarDocument, 'userId' | 'status' | 'readyAt' | 'colorAnalysis'> &
  Partial<Pick<AvatarDocument, 'avatarKey' | 'colorsAt' | 'updatedAt'>>
type LookFacts = { count: number; lastAt: Date | null }

// Exported for scripts/lifecycle-dry-run.ts.
export function stateFor(user: UserDocument, avatar: AvatarFacts | undefined, looks: LookFacts): LifecycleState {
  const billing = billingState(user)
  // Colors first leaves a ready read with no avatar yet: they still get
  // the nudge to make it.
  const avatarReady = avatar?.status === 'ready' && Boolean(avatar.avatarKey)
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
    // Reads made before colorsAt existed go by the avatar's own times.
    colorsAt: avatar?.colorAnalysis ? (avatar.colorsAt ?? avatar.readyAt ?? avatar.updatedAt ?? user.createdAt) : null,
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
  // The rescue email's checkout and its sign-in link.
  rescue?: { product: string; url: string },
  // The price-drop email's photo (null for none) and its sign-in link.
  priceDrop?: { heroUrl: string | null; url: string },
): EmailContent {
  const recipient = { firstName: user.firstName, email: user.email, unsubscribeUrl: unsubscribeUrl(user._id, sendId) }
  const analysis = avatar?.status === 'ready' ? avatar.colorAnalysis : null
  // Like the app, the emails show no best colors before they pay: the
  // season only (the palette card has no swatches then).
  const freeColors: ColorSwatch[] = []

  switch (kind) {
    case 'welcome': {
      const stage: WelcomeStage = avatar?.status !== 'ready' || !avatar.avatarKey ? 'new' : looks.count > 0 ? 'looks' : 'avatar'
      return welcomeEmail({ ...recipient, stage, season: analysis?.season ?? null, focus: focusOf(user) })
    }
    case 'avatar_nudge':
      return avatarNudgeEmail({ ...recipient, focus: focusOf(user) })
    case 'looks_nudge':
      return looksNudgeEmail({ ...recipient, season: analysis?.season ?? null, colors: freeColors })
    case 'upgrade_offer':
      // No look made: they came for their colors, so it leads with them.
      return upgradeOfferEmail({
        ...recipient,
        palette: looks.count === 0 && analysis ? { season: analysis.season, colors: freeColors } : null,
      })
    case 'upgrade_reminder':
      return upgradeReminderEmail({ ...recipient, season: analysis?.season ?? null, colors: freeColors })
    case 'upgrade_last_call':
      return upgradeLastCallEmail(recipient)
    case 'trial_started':
      return trialStartedEmail({ ...recipient, trialEnd: trialEndOf(user) })
    case 'trial_ending':
      return trialEndingEmail({ ...recipient, trialEnd: trialEndOf(user), looksLeft: billingState(user).credits })
    case 'checkout_rescue':
      return checkoutRescueEmail({ ...recipient, product: rescue?.product ?? 'color_report', url: rescue?.url ?? `${env.APP_URL}/studio` })
    case 'price_drop':
      return priceDropEmail({
        ...recipient,
        season: analysis?.season ?? null,
        colors: freeColors,
        heroUrl: priceDrop?.heroUrl ?? null,
        url: priceDrop?.url ?? appLink('/studio', 'price_drop', { upgrade: 'palette' }),
      })
  }
}

function trialEndOf(user: UserDocument) {
  return user.pro?.trialEnd ?? user.pro?.periodEnd ?? new Date(Date.now() + env.PRO_TRIAL_DAYS * 24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------- trial notices

type TrialNotice = 'trial_started' | 'trial_ending'

// Billing notices: once each, whatever the tips preference, and apart from
// the onboarding emails' spacing. A failed send is rolled back and retried.
async function sendTrialNotice(app: FastifyInstance, user: UserDocument, kind: TrialNotice, now: Date) {
  const field = `lifecycleEmails.${kind}`
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false } },
    { $set: { [field]: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()
  const content = lifecycleContentFor(kind, user, undefined, { count: 0, lastAt: null }, sendId)

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
    app.log.info({ userId: user._id.toString(), kind, delivered }, 'Trial notice')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString(), kind }, 'Trial notice failed; will retry')
    await Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne({ _id: user._id }, { $unset: { [field]: '' } }),
    ])
    return false
  }
}

// Right after a trial starts: its terms (what was paid, when it renews and
// how to cancel), as card networks ask for trials.
export async function sendTrialStartedEmail(app: FastifyInstance, userId: ObjectId) {
  const user = await app.collections.users.findOne({ _id: userId })

  if (!user || user.pro?.status !== 'trialing' || user.pro.subscriptionId === SIMULATED_SUBSCRIPTION) {
    return false
  }

  return sendTrialNotice(app, user, 'trial_started', new Date())
}

// Every run: the reminder before the first monthly charge (skipped once
// they cancel), and the start notice if it didn't go out when they paid.
export async function sendTrialNotices(app: FastifyInstance, now = new Date()) {
  const trialing = await app.collections.users
    .find({
      'pro.status': 'trialing',
      'pro.subscriptionId': { $ne: SIMULATED_SUBSCRIPTION },
      'pro.trialEnd': { $gt: now },
      $or: [
        { 'lifecycleEmails.trial_started': { $exists: false } },
        {
          'lifecycleEmails.trial_ending': { $exists: false },
          'pro.cancelAtPeriodEnd': false,
          'pro.trialEnd': { $gt: now, $lte: new Date(now.getTime() + TRIAL_REMINDER_BEFORE_MS) },
        },
      ],
    })
    .limit(BATCH)
    .toArray()
  let sent = 0

  for (const user of trialing) {
    const trialEnd = user.pro?.trialEnd
    const due: TrialNotice | null = !user.lifecycleEmails?.trial_started
      ? 'trial_started'
      : !user.pro?.cancelAtPeriodEnd && trialEnd && trialEnd.getTime() - now.getTime() <= TRIAL_REMINDER_BEFORE_MS
        ? 'trial_ending'
        : null

    if (due && (await sendTrialNotice(app, user, due, now))) {
      sent += 1
    }
  }

  return sent
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

// ---------------------------------------------------------------- checkout rescue

// Where a rescue link lands: the offer they were paying for.
function rescueNext(product: string) {
  if (product === 'color_mirror') {
    return '/studio?upgrade=mirror'
  }

  if (product === 'hair_advisor') {
    return '/studio?upgrade=hair'
  }

  if (product === 'advisors_bundle') {
    return '/studio/advisors'
  }

  if (product === 'event_pass') {
    return '/studio/events'
  }

  if (/^color_|reports_bundle/.test(product)) {
    return '/studio?upgrade=palette'
  }

  if (/^style_/.test(product)) {
    return '/studio?upgrade=style'
  }

  return product === 'look_pack' ? '/studio?upgrade=look' : '/studio?upgrade=plan'
}

// Every run: people who opened a checkout an hour to two days ago and paid
// nothing since get one email with a sign-in link to finish it in their own
// browser. Once per account; promotional, so never to anyone who opted out
// or before the postal address is set.
export async function sendCheckoutRescues(app: FastifyInstance, now = new Date()) {
  if (!env.EMAIL_POSTAL_ADDRESS) {
    return 0
  }

  const checkouts = await app.collections.analyticsEvents
    .aggregate<{ _id: ObjectId; product: string; at: Date }>([
      {
        $match: {
          name: 'checkout_created',
          userId: { $ne: null },
          at: { $gte: new Date(now.getTime() - RESCUE_WITHIN_MS), $lte: new Date(now.getTime() - RESCUE_AFTER_MS) },
        },
      },
      { $sort: { at: -1 } },
      { $group: { _id: '$userId', product: { $first: '$props.product' }, at: { $first: '$at' } } },
    ])
    .toArray()
  let sent = 0

  for (const checkout of checkouts) {
    const user = await app.collections.users.findOne({
      _id: checkout._id,
      'lifecycleEmails.checkout_rescue': { $exists: false },
      emailTipsOptOutAt: null,
    })

    if (!user || isAdmin(user) || billingState(user).proLive) {
      continue
    }

    // Paid since (this checkout or anything else): nothing to rescue.
    if (await app.collections.purchases.findOne({ userId: user._id, createdAt: { $gte: checkout.at } })) {
      continue
    }

    if (await sendCheckoutRescue(app, user, String(checkout.product ?? 'color_report'), now)) {
      sent += 1
    }
  }

  return sent
}

async function sendCheckoutRescue(app: FastifyInstance, user: UserDocument, product: string, now: Date) {
  const field = 'lifecycleEmails.checkout_rescue'
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false }, emailTipsOptOutAt: null },
    { $set: { [field]: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    const url = await createLink(app, user, 'sign_in', undefined, { next: rescueNext(product) })
    const content = lifecycleContentFor('checkout_rescue', user, undefined, { count: 0, lastAt: null }, sendId, { product, url })

    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind: 'checkout_rescue',
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
    app.log.info({ userId: user._id.toString(), product, delivered }, 'Checkout rescue email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString() }, 'Checkout rescue email failed; will retry')
    await Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne({ _id: user._id }, { $unset: { [field]: '' } }),
    ])
    return false
  }
}

// ---------------------------------------------------------------- price drop

// Their drape photo in an email: the locked copy (best side blurred), served
// by the API through a link signed for this account that stops working
// after two weeks. Email clients fetch images without signing in.
const imageSignature = (userId: string, expires: number) =>
  hmacSign(env.JWT_ACCESS_SECRET, `email-image:${userId}:${expires}`)

export function emailImageUrl(userId: ObjectId, now = new Date()) {
  const id = userId.toString()
  const expires = Math.floor((now.getTime() + EMAIL_IMAGE_TTL_MS) / 1000)
  const url = new URL(`/api/v1/email/i/${id}.jpg`, `${env.API_PUBLIC_URL}/`)
  url.searchParams.set('e', String(expires))
  url.searchParams.set('s', imageSignature(id, expires))
  return url.toString()
}

// The account whose photo a signed image link shows, while it's valid.
export function emailImageUser(file: string, expires: string, signature: string, now = new Date()) {
  const id = file.replace(/\.jpg$/, '')
  const seconds = Number(expires)

  if (!ObjectId.isValid(id) || !Number.isFinite(seconds) || seconds * 1000 < now.getTime()) {
    return null
  }

  return hmacVerify(env.JWT_ACCESS_SECRET, `email-image:${id}:${seconds}`, signature) ? new ObjectId(id) : null
}

const newYorkHour = (now: Date) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now))

// Every run while the window is open: the price-drop email to whoever is
// due. Promotional, so never to anyone who opted out or without the postal
// address; never to someone who bought anything, or before they've seen
// their colors.
export async function sendPriceDropEmails(app: FastifyInstance, now = new Date()) {
  const hour = newYorkHour(now)

  if (!env.EMAIL_POSTAL_ADDRESS || now >= PRICE_DROP.until || hour < PRICE_DROP.hours.from || hour >= PRICE_DROP.hours.to) {
    return 0
  }

  const viewers = await app.collections.analyticsEvents.distinct('userId', {
    name: 'paywall_offer',
    at: { $gte: PRICE_DROP.offersSince, $lt: PRICE_DROP.cutAt },
    userId: { $ne: null },
  })
  const users = await app.collections.users
    .find({ _id: { $in: viewers as ObjectId[] }, emailTipsOptOutAt: null, 'lifecycleEmails.price_drop': { $exists: false } })
    .limit(BATCH)
    .toArray()
  let sent = 0

  for (const user of users) {
    const billing = billingState(user, now.getTime())

    if (isAdmin(user) || billing.paid || billing.comp || billing.proLive || billing.colorReport) {
      continue
    }

    // Spaced from their other emails, like the onboarding ones.
    if (user.lifecycleEmailLastAt && now.getTime() - user.lifecycleEmailLastAt.getTime() < PRICE_DROP.gap) {
      continue
    }

    const avatar = await app.collections.avatars.findOne({ userId: user._id })

    if (avatar?.status !== 'ready' || !avatar.colorAnalysis) {
      continue
    }

    if (await sendPriceDrop(app, user, avatar, now)) {
      sent += 1
    }
  }

  return sent
}

async function sendPriceDrop(app: FastifyInstance, user: UserDocument, avatar: AvatarDocument, now: Date) {
  const field = 'lifecycleEmails.price_drop'
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false }, emailTipsOptOutAt: null },
    { $set: { [field]: now, lifecycleEmailLastAt: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    // Signed in from the email, straight to the Color Advisor offer, in
    // their own browser (where Apple Pay works).
    const signIn = new URL(await createLink(app, user, 'sign_in', undefined, { next: '/studio?upgrade=palette' }))
    signIn.searchParams.set('utm_source', 'email')
    signIn.searchParams.set('utm_medium', 'lifecycle')
    signIn.searchParams.set('utm_campaign', 'price_drop')
    const heroUrl = avatar.drapePreview?.lockedKey ? emailImageUrl(user._id, now) : null
    const content = lifecycleContentFor('price_drop', user, avatar, { count: 0, lastAt: null }, sendId, undefined, {
      heroUrl,
      url: signIn.toString(),
    })

    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind: 'price_drop',
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
    app.log.info({ userId: user._id.toString(), delivered, photo: Boolean(heroUrl) }, 'Price drop email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString() }, 'Price drop email failed; will retry')
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
        .find({ userId: { $in: ids } }, { projection: { userId: 1, status: 1, readyAt: 1, colorAnalysis: 1, avatarKey: 1, colorsAt: 1, updatedAt: 1 } })
        .toArray(),
      app.collections.looks
        .aggregate<{ _id: ObjectId; count: number; lastAt: Date | null }>([
          { $match: { userId: { $in: ids }, status: { $ne: 'locked' } } },
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
    void sendTrialNotices(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Trial notices run crashed')
    })
    void sendCheckoutRescues(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Checkout rescue run crashed')
    })
    void sendPriceDropEmails(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Price drop run crashed')
    })
  }

  setTimeout(run, FIRST_RUN_AFTER_MS).unref()
  setInterval(run, RUN_EVERY_MS).unref()
}
