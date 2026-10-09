import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { emailCopy } from '../../i18n/emails.js'
import type { AvatarDocument, ColorSwatch, EmailAsset, LifecycleEmailKind, PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { deliverEmail } from '../../utils/email.js'
import { appUrl, type Locale } from '../../utils/locale.js'
import { withLocale } from '../../utils/request-locale.js'
import { localHour } from '../../utils/timezones.js'
import { hmacSign, hmacVerify } from '../../utils/tokens.js'
import { presentationOf } from '../avatar/body.js'
import { billingState, isAdmin } from '../billing/entitlements.js'
import { REGION_CURRENCY, regionalAmount, regionForCountry } from '../billing/pricing.js'
import { EDITS } from '../looks/edits.js'
import { looksFor } from '../looks/icon-routes.js'
import { assetSlot, editOfIcon, editText, hasGenerator, startAsset } from './assets.js'
import {
  CROSS_SELL_RULES,
  addonEnding,
  editDue,
  latestEdit,
  pickCrossSell,
  type CrossSellKind,
  type CrossSellState,
} from './cross-sell.js'
import { LIFECYCLE_RULES, lastLifecycleEmailAt, pickLifecycleEmail, tooSoonAfter, type LifecycleState } from './schedule.js'
import {
  appLink,
  avatarNudgeEmail,
  checkoutRescueEmail,
  reportUnopenedEmail,
  crossSellEmail,
  looksNudgeEmail,
  priceDropEmail,
  trialEndingEmail,
  trialStartedEmail,
  upgradeLastCallEmail,
  upgradeOfferEmail,
  upgradeReminderEmail,
  welcomeEmail,
  type CrossSellContent,
  type EmailContent,
  type WelcomeStage,
} from './templates.js'
import { createLink, createLinks } from '../../utils/auth-links.js'
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
// How long the photos in the emails keep loading.
const EMAIL_IMAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000
// A cross-sell picture still being made after this long counts as failed:
// its email goes out with the stock picture, so none waits forever.
const ASSET_STALE_MS = 25 * 60 * 1000

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

// `sendId` credits the unsubscribe to the email it came from; the page
// opens in their language.
export function unsubscribeUrl(userId: ObjectId, sendId?: ObjectId, locale?: Locale) {
  const url = new URL(appUrl(locale, '/email/unsubscribe'))
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
  Partial<Pick<AvatarDocument, 'avatarKey' | 'colorsAt' | 'updatedAt' | 'drapePreview'>>
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
    lastSentAt: lastLifecycleEmailAt(user),
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
  // The colors offer's photo (null for none) and its one-tap checkout link.
  offer?: { heroUrl: string | null; url: string },
  // A cross-sell's one-tap checkout link, which pair price ends soon, and
  // what it shows of them (CrossSellPersonal).
  crossSell?: CrossSellLink,
  now = new Date(),
): EmailContent {
  // In their language, with the prices where they pay (billing/pricing.ts).
  const locale = user.locale ?? 'en'
  const recipient = {
    firstName: user.firstName,
    email: user.email,
    unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
    locale,
    region: regionForCountry(user.location?.country),
  }
  const analysis = avatar?.status === 'ready' ? avatar.colorAnalysis : null
  // Like the app, the emails show no best colors before they pay: the
  // season only (the palette card has no swatches then).
  const freeColors: ColorSwatch[] = []
  // Colors first (no look): the offer emails lead with their own photo and
  // pay from a sign-in link (sendOne makes both).
  const colorsPhoto =
    looks.count === 0 && analysis ? { heroUrl: offer?.heroUrl ?? null, ...(offer?.url ? { url: offer.url } : {}) } : null

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
        palette:
          looks.count === 0 && analysis
            ? { season: analysis.season, colors: freeColors, heroUrl: offer?.heroUrl ?? null, ...(offer?.url ? { url: offer.url } : {}) }
            : null,
      })
    case 'upgrade_reminder':
      return upgradeReminderEmail({ ...recipient, season: analysis?.season ?? null, colors: freeColors, photo: colorsPhoto })
    case 'upgrade_last_call':
      return upgradeLastCallEmail({ ...recipient, photo: colorsPhoto })
    case 'trial_started':
      return trialStartedEmail({ ...recipient, trialEnd: trialEndOf(user) })
    case 'trial_ending':
      return trialEndingEmail({ ...recipient, trialEnd: trialEndOf(user), looksLeft: billingState(user).credits })
    case 'checkout_rescue':
      return checkoutRescueEmail({ ...recipient, product: rescue?.product ?? 'color_report', url: rescue?.url ?? appUrl(locale, '/studio') })
    case 'checkout_link':
      // Sent the moment they tap Buy, by lifecycle/checkout-link.ts.
      throw new Error('checkout_link emails are built by sendCheckoutLink')
    case 'report_unopened':
      return reportUnopenedEmail({ ...recipient, season: analysis?.season ?? null, url: rescue?.url ?? appUrl(locale, '/studio/report') })
    case 'price_drop':
      return priceDropEmail({
        ...recipient,
        season: analysis?.season ?? null,
        colors: freeColors,
        heroUrl: priceDrop?.heroUrl ?? null,
        url: priceDrop?.url ?? appLink('/studio', 'price_drop', { upgrade: 'palette' }, locale),
      })
    case 'xsell_style':
    case 'xsell_color':
    case 'xsell_addon_last_call':
    case 'xsell_hair':
    case 'xsell_magazine':
    case 'xsell_event':
    case 'xsell_guide':
    case 'xsell_pro':
    case 'xsell_edit':
      return crossSellEmail({ ...recipient, ...crossSellContentFor(kind, user, avatar, crossSell, now) })
  }
}

// ---------------------------------------------------------------- cross-sell

type Offer = {
  product: PurchaseProduct
  price: number
  regular: number | null
  currency: string
  until: Date | null
  side: 'style' | 'color' | null
}

// What a cross-sell sells and for how much: the other report at the pair
// price while it lasts (the same check checkout makes), the rest at theirs,
// in the prices and currency of where they pay (billing/pricing.ts, as
// checkout prices it).
export function crossSellOffer(kind: CrossSellKind, user: UserDocument, now: Date, side: 'style' | 'color' | null = null): Offer {
  const billing = billingState(user, now.getTime())
  const region = regionForCountry(user.location?.country)
  const currency = REGION_CURRENCY[region]
  const live = (until: Date | null) => (until && until.getTime() > now.getTime() ? until : null)
  const report = (which: 'style' | 'color'): Omit<Offer, 'side'> => {
    const until = live(which === 'style' ? billing.styleAddonUntil : billing.colorAddonUntil)
    const regular = regionalAmount(`${which}_report`, region)

    return until
      ? { product: `${which}_addon`, price: regionalAmount(`${which}_addon`, region), regular, currency, until }
      : { product: `${which}_report`, price: regular, regular: null, currency, until: null }
  }
  const once = (product: PurchaseProduct): Offer => ({
    product,
    price: regionalAmount(product, region),
    regular: null,
    currency,
    until: null,
    side: null,
  })

  switch (kind) {
    case 'xsell_style':
      return { ...report('style'), side: null }
    case 'xsell_color':
      return { ...report('color'), side: null }
    case 'xsell_addon_last_call': {
      const which = side ?? (live(billing.styleAddonUntil) ? 'style' : 'color')
      return { ...report(which), side: which }
    }
    case 'xsell_hair':
      return once('hair_advisor')
    case 'xsell_magazine':
      return once('magazine')
    case 'xsell_event':
      return once('event_pass')
    case 'xsell_guide':
      return once('outfit_guide')
    case 'xsell_pro':
    case 'xsell_edit':
      return once('pro_monthly')
  }
}

// Where a cross-sell's button lands in the studio: its checkout (?buy=),
// over the Edits (on the one the email showed) for Pro.
function crossSellTarget(kind: CrossSellKind, product: PurchaseProduct, editId: string | null = null) {
  const params: Record<string, string> = { buy: product, from: `email_${kind}` }

  return product.startsWith('pro_')
    ? { path: '/studio/try-on', params: editId ? { edit: editId, ...params } : params }
    : { path: '/studio', params }
}

// The book sells on its own page; the rest open their checkout in the
// studio (?buy=), signed in when the email carries a sign-in link.
function crossSellPage(kind: CrossSellKind, product: PurchaseProduct, locale?: Locale, editId: string | null = null) {
  if (product === 'outfit_guide') {
    return appLink('/guide', kind, {}, locale)
  }

  const target = crossSellTarget(kind, product, editId)
  return appLink(target.path, kind, target.params, locale)
}

// What a cross-sell shows of them (sendCrossSell works it out): their own
// picture once it's ready, with what's in it, and the extra links.
export type CrossSellPersonal = Pick<CrossSellContent, 'heroUrl' | 'gift' | 'cut' | 'edit' | 'occasionUrls'>

export type CrossSellLink = { url: string; side: 'style' | 'color' | null } & CrossSellPersonal

export function crossSellContentFor(
  kind: CrossSellKind,
  user: UserDocument,
  avatar: AvatarFacts | undefined,
  link?: CrossSellLink,
  now = new Date(),
): CrossSellContent {
  const offer = crossSellOffer(kind, user, now, link?.side ?? null)
  const billing = billingState(user, now.getTime())
  const analysis = avatar?.status === 'ready' ? avatar.colorAnalysis : null

  return {
    kind,
    price: offer.price,
    regular: offer.regular,
    currency: offer.currency,
    until: offer.until,
    side: offer.side,
    owns: { color: billing.colorReport, style: billing.styleReport },
    url: link?.url ?? crossSellPage(kind, offer.product, user.locale, link?.edit?.id ?? null),
    season: analysis?.season ?? null,
    // They paid for their colors, so the email can show them.
    colors: billing.colorReport ? (analysis?.bestColors ?? []).slice(0, 4) : [],
    now,
    heroUrl: link?.heroUrl ?? null,
    gift: link?.gift ?? null,
    cut: link?.cut ?? null,
    edit: link?.edit ?? null,
    occasionUrls: link?.occasionUrls ?? [],
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
// Where each colors offer email opens checkout from, for the funnel.
const OFFER_FROM = { upgrade_offer: 'email_colors', upgrade_reminder: 'email_reminder', upgrade_last_call: 'email_last_call' } as const

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

  try {
    // The colors offer, its reminder and its last call open checkout signed
    // in, on their own photo.
    const from = OFFER_FROM[kind as keyof typeof OFFER_FROM]
    const offer =
      from && facts.looks.count === 0 && facts.avatar?.colorAnalysis
        ? {
            url: await createLink(app, user, 'sign_in', undefined, { next: `/studio?buy=color_report&from=${from}` }),
            heroUrl: facts.avatar.drapePreview?.status === 'ready' && facts.avatar.drapePreview.lockedKey ? emailImageUrl(user._id, now) : null,
          }
        : undefined
    const content = lifecycleContentFor(kind, user, facts.avatar, facts.looks, sendId, undefined, undefined, offer)

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

  if (product === 'magazine') {
    return '/studio/magazine'
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

    // Spaced from their other emails like the onboarding ones (the colors
    // offer often goes out the same hour). It still goes later in its
    // window if they haven't paid by then.
    if (tooSoonAfter(lastLifecycleEmailAt(user), now.getTime())) {
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
    { $set: { [field]: now, lifecycleEmailLastAt: now } },
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

// ---------------------------------------------------------------- unopened report

// The Color Advisor's report is written the first time its owner opens it.
// Someone who paid and left before opening it (Oct 8: a buyer watched the
// next advisors' videos and closed the page) gets one email an hour later,
// with a link that signs them in on it.
const REPORT_REMINDER_AFTER_MS = 60 * 60 * 1000
const REPORT_REMINDER_WITHIN_MS = 3 * 24 * 60 * 60 * 1000

export async function sendReportReminders(app: FastifyInstance, now = new Date()) {
  const buyers = await app.collections.users
    .find({
      colorReportAt: {
        $gte: new Date(now.getTime() - REPORT_REMINDER_WITHIN_MS),
        $lte: new Date(now.getTime() - REPORT_REMINDER_AFTER_MS),
      },
      'lifecycleEmails.report_unopened': { $exists: false },
    })
    .limit(BATCH)
    .toArray()
  let sent = 0

  for (const user of buyers) {
    if (isAdmin(user)) {
      continue
    }

    const avatar = await app.collections.avatars.findOne(
      { userId: user._id },
      { projection: { colorReport: 1, colorAnalysis: 1 } },
    )

    // Opened it (or there are no colors to write it from yet).
    if (!avatar?.colorAnalysis || avatar.colorReport) {
      continue
    }

    if (await sendReportReminder(app, user, avatar.colorAnalysis.season ?? null, now)) {
      sent += 1
    }
  }

  return sent
}

async function sendReportReminder(app: FastifyInstance, user: UserDocument, season: string | null, now: Date) {
  const field = 'lifecycleEmails.report_unopened'
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false } },
    { $set: { [field]: now, lifecycleEmailLastAt: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    const locale = user.locale ?? 'en'
    const url = await createLink(app, user, 'sign_in', undefined, { next: '/studio/report' })
    const content = reportUnopenedEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      season,
      url,
    })

    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind: 'report_unopened',
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
    app.log.info({ userId: user._id.toString(), delivered }, 'Unopened report email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString() }, 'Unopened report email failed; will retry')
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

// ---------------------------------------------------------------- price drop

// Their own pictures in an email, served by the API through a link signed
// for this account and picture that stops working after two weeks (email
// clients fetch images without signing in). A slot names the picture:
// 'drape' is their drape photo's locked copy (best side blurred); a
// cross-sell kind or 'edit:<id>' is that email's picture (users.xsellAssets);
// 'look-<id>' is one of their looks.
const imageSignature = (subject: string, expires: number) =>
  hmacSign(env.JWT_ACCESS_SECRET, `email-image:${subject}:${expires}`)

const SLOT_PATTERN = /^(?:drape|xsell_[a-z_]{2,30}|edit:[a-z0-9-]{1,60}|look-[0-9a-f]{24})$/

export function emailImageUrl(userId: ObjectId, now = new Date(), slot = 'drape') {
  const id = userId.toString()
  const expires = Math.floor((now.getTime() + EMAIL_IMAGE_TTL_MS) / 1000)
  const url = new URL(`/api/v1/email/i/${id}/${encodeURIComponent(slot)}.jpg`, `${env.API_PUBLIC_URL}/`)
  url.searchParams.set('e', String(expires))
  url.searchParams.set('s', imageSignature(`${id}:${slot}`, expires))
  return url.toString()
}

// The account and picture a signed image link shows, while it's valid.
export function emailImageTarget(id: string, file: string, expires: string, signature: string, now = new Date()) {
  const slot = file.replace(/\.jpg$/, '')
  const seconds = Number(expires)

  if (!ObjectId.isValid(id) || !SLOT_PATTERN.test(slot) || !Number.isFinite(seconds) || seconds * 1000 < now.getTime()) {
    return null
  }

  return hmacVerify(env.JWT_ACCESS_SECRET, `email-image:${id}:${slot}:${seconds}`, signature)
    ? { userId: new ObjectId(id), slot }
    : null
}

// Links from before slots (/email/i/<uid>.jpg, until Oct 2026): their drape
// photo. Emails already sent keep loading it.
export function emailImageUser(file: string, expires: string, signature: string, now = new Date()) {
  const id = file.replace(/\.jpg$/, '')
  const seconds = Number(expires)

  if (!ObjectId.isValid(id) || !Number.isFinite(seconds) || seconds * 1000 < now.getTime()) {
    return null
  }

  return hmacVerify(env.JWT_ACCESS_SECRET, `email-image:${id}:${seconds}`, signature) ? new ObjectId(id) : null
}

// The stored file behind a slot, while it's there.
export async function emailImageKey(app: FastifyInstance, userId: ObjectId, slot: string): Promise<string | null> {
  if (slot === 'drape') {
    const avatar = await app.collections.avatars.findOne({ userId }, { projection: { drapePreview: 1 } })
    return avatar?.drapePreview?.lockedKey ?? null
  }

  if (slot.startsWith('look-')) {
    const look = await app.collections.looks.findOne(
      { _id: new ObjectId(slot.slice('look-'.length)), userId, status: 'ready' },
      { projection: { imageKey: 1 } },
    )
    return look?.imageKey ?? null
  }

  const user = await app.collections.users.findOne({ _id: userId }, { projection: { [`xsellAssets.${slot}`]: 1 } })
  const asset = user?.xsellAssets?.[slot]
  return asset?.status === 'ready' ? asset.key : null
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
    const lastSentAt = lastLifecycleEmailAt(user)

    if (lastSentAt && now.getTime() - lastSentAt.getTime() < PRICE_DROP.gap) {
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

// ---------------------------------------------------------------- cross-sell sending

// The Edits a buyer can try on (with looks for how they dress), for the
// Pro and new-Edit emails.
function tryableEdits(avatar: Pick<AvatarDocument, 'body' | 'presentation'> | null): CrossSellState['edits'] {
  const presentation = avatar ? presentationOf(avatar) : null

  return EDITS.filter((edit) => looksFor(edit.looks, presentation).length > 0).map((edit) => ({
    id: edit.id,
    droppedAt: new Date(`${edit.droppedAt}T00:00:00Z`),
    costume: edit.looks.every((look) => look.mood === 'Costume party'),
  }))
}

// Every run: buyers whose latest purchase is recent get the next thing they
// don't have, when one is due (lifecycle/cross-sell.ts). Its picture is
// made first, whatever the hour (lifecycle/assets.ts); the email goes out in
// their daytime once the picture is ready, failed or late. Promotional, so
// never to anyone who opted out or before the postal address is set.
export async function sendCrossSells(app: FastifyInstance, now = new Date()) {
  if (!env.EMAIL_POSTAL_ADDRESS) {
    return 0
  }

  const buyers = await app.collections.purchases
    .aggregate<{ _id: ObjectId; lastAt: Date }>([
      { $match: { createdAt: { $gte: new Date(now.getTime() - CROSS_SELL_RULES.editHorizon) }, refundedAt: null } },
      { $group: { _id: '$userId', lastAt: { $max: '$createdAt' } } },
    ])
    .toArray()
  let sent = 0
  let started = 0

  for (const buyer of buyers) {
    const user = await app.collections.users.findOne({ _id: buyer._id, emailTipsOptOutAt: null })

    if (!user || isAdmin(user)) {
      continue
    }

    const billing = billingState(user, now.getTime())
    const [products, magazine, guide, avatar] = await Promise.all([
      app.collections.purchases.distinct('product', { userId: user._id }),
      app.collections.magazines.findOne({ userId: user._id }, { projection: { _id: 1 } }),
      app.collections.guideOrders.findOne({ $or: [{ userId: user._id }, { email: user.email.toLowerCase() }] }, { projection: { _id: 1 } }),
      app.collections.avatars.findOne({ userId: user._id }),
    ])
    const state: CrossSellState = {
      lastPurchaseAt: buyer.lastAt,
      owns: {
        color: billing.colorReport,
        style: billing.styleReport,
        hair: billing.hairAdvisor,
        magazine: billing.magazineCredits > 0 || Boolean(magazine) || products.includes('magazine'),
        // Pro styles an event with its looks.
        event: billing.proActive || billing.eventCredits > 0 || products.includes('event_pass'),
        guide: Boolean(guide) || products.includes('outfit_guide'),
        pro: billing.proLive,
      },
      addonUntil: { color: billing.colorAddonUntil, style: billing.styleAddonUntil },
      sent: user.lifecycleEmails ?? {},
      lastSentAt: lastLifecycleEmailAt(user),
      promotionsAllowed: true,
      edits: tryableEdits(avatar),
      editEmails: user.editEmails ?? [],
    }
    const kind = pickCrossSell(state, now)

    if (!kind) {
      continue
    }

    // Pro shows the newest Edit; the new-Edit email, the one it's about.
    const at = now.getTime()
    const editId = kind === 'xsell_edit' ? editDue(state, at) : kind === 'xsell_pro' ? latestEdit(state.edits, at) : null
    const asset = env.XSELL_PERSONAL_IMAGES ? user.xsellAssets?.[assetSlot(kind, editId)] : undefined

    // Its picture first. Past the run's cap, it starts on a later run.
    if (env.XSELL_PERSONAL_IMAGES && !asset && hasGenerator(kind)) {
      if (started < env.XSELL_IMAGE_STARTS_PER_RUN && (await startAsset(app, user, kind, editId, now))) {
        started += 1
      }

      continue
    }

    if (asset?.status === 'processing' && at - asset.startedAt.getTime() < ASSET_STALE_MS) {
      continue
    }

    const hour = localHour(user.location, now)

    if (hour < CROSS_SELL_RULES.sendHours.from || hour >= CROSS_SELL_RULES.sendHours.to) {
      continue
    }

    const side = kind === 'xsell_addon_last_call' ? addonEnding(state, at) : null

    if (await sendCrossSell(app, user, kind, { side, editId, avatar, asset }, now)) {
      sent += 1
    }
  }

  return sent
}

type CrossSellContext = {
  side: 'style' | 'color' | null
  // The Edit the Pro or new-Edit email is about.
  editId: string | null
  avatar: AvatarDocument | null
  // Its picture (users.xsellAssets), when pictures are on.
  asset: EmailAsset | undefined
}

type Personal = {
  heroUrl: string | null
  // xsell_style: the gift look and the color it's built around.
  giftLook: { id: string; color: string } | null
  cut: string | null
  edit: { id: string; name: string; tagline: string } | null
}

// What a cross-sell shows of them: its picture once it's ready (the stock
// one otherwise) and what's in it. Only reads; links come after the claim.
async function crossSellPersonal(
  app: FastifyInstance,
  user: UserDocument,
  kind: CrossSellKind,
  context: CrossSellContext,
  now: Date,
): Promise<Personal> {
  const none: Personal = { heroUrl: null, giftLook: null, cut: null, edit: null }
  const { asset, avatar } = context
  const ready = asset?.status === 'ready' && asset.key ? asset : null
  const refId = ready?.ref && ObjectId.isValid(ready.ref) ? new ObjectId(ready.ref) : null
  const picture = (slot: string) => emailImageUrl(user._id, now, slot)
  const slot = assetSlot(kind, context.editId)
  const readyLook = (id: ObjectId | null) =>
    id ? app.collections.looks.findOne({ _id: id, userId: user._id, status: 'ready' }, { projection: { iconId: 1 } }) : null

  switch (kind) {
    case 'xsell_style': {
      const color = avatar?.colorAnalysis?.bestColors[0]
      const look = color ? await readyLook(refId) : null
      return look && color ? { ...none, heroUrl: picture(slot), giftLook: { id: look._id.toString(), color: color.name } } : none
    }

    case 'xsell_color':
      // Their drape photo, best side blurred: made with their colors.
      return env.XSELL_PERSONAL_IMAGES && avatar?.drapePreview?.status === 'ready' && avatar.drapePreview.lockedKey
        ? { ...none, heroUrl: picture('drape') }
        : none

    case 'xsell_hair': {
      const hairstyle = refId
        ? await app.collections.hairstyles.findOne({ _id: refId, userId: user._id, status: 'ready' }, { projection: { name: 1 } })
        : null
      return hairstyle ? { ...none, heroUrl: picture(slot), cut: hairstyle.name } : none
    }

    case 'xsell_pro':
    case 'xsell_edit': {
      // The Edit their try-on came from (a newer one may have dropped since),
      // else the one it was for.
      const look = await readyLook(refId)
      const edit = editOfIcon(look?.iconId) ?? EDITS.find((item) => item.id === context.editId) ?? null
      return { ...none, heroUrl: look ? picture(slot) : null, edit: edit ? withLocale(user.locale ?? 'en', () => editText(edit)) : null }
    }

    case 'xsell_event': {
      // Their latest look, nothing to make.
      const look = env.XSELL_PERSONAL_IMAGES
        ? await app.collections.looks.findOne(
            { userId: user._id, status: 'ready', imageKey: { $ne: null } },
            { sort: { readyAt: -1 }, projection: { _id: 1 } },
          )
        : null
      return look ? { ...none, heroUrl: picture(`look-${look._id.toString()}`) } : none
    }

    case 'xsell_magazine':
      return ready ? { ...none, heroUrl: picture(slot) } : none

    default:
      return none
  }
}

// Sign-in links for one email's buttons (they share one nonce), tagged so
// the clicks are counted (trackContent).
async function signInLinks(app: FastifyInstance, user: UserDocument, kind: CrossSellKind, nexts: string[]) {
  const links = await createLinks(app, user, 'sign_in', nexts)

  return links.map((link) => {
    const url = new URL(link)
    url.searchParams.set('utm_source', 'email')
    url.searchParams.set('utm_medium', 'lifecycle')
    url.searchParams.set('utm_campaign', kind)
    return url.toString()
  })
}

const studioPath = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`

async function sendCrossSell(app: FastifyInstance, user: UserDocument, kind: CrossSellKind, context: CrossSellContext, now: Date) {
  const field = `lifecycleEmails.${kind}`
  const personal = await crossSellPersonal(app, user, kind, context, now)
  // The Edit it shows reaches them once (users.editEmails).
  const edit = kind === 'xsell_pro' || kind === 'xsell_edit' ? (personal.edit?.id ?? null) : null
  const recurring = kind === 'xsell_edit'

  if (recurring && !edit) {
    return false
  }

  // Claimed only if no other email went out within the gap meanwhile (the
  // other loops run at the same time). Each goes out once; the new-Edit
  // email, once per Edit.
  const claimed = await app.collections.users.updateOne(
    {
      _id: user._id,
      ...(recurring ? { editEmails: { $ne: edit! } } : { [field]: { $exists: false } }),
      emailTipsOptOutAt: null,
      $or: [{ lifecycleEmailLastAt: null }, { lifecycleEmailLastAt: { $lt: new Date(now.getTime() - LIFECYCLE_RULES.gap) } }],
    },
    { $set: { [field]: now, lifecycleEmailLastAt: now }, ...(edit ? { $addToSet: { editEmails: edit } } : {}) },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    const offer = crossSellOffer(kind, user, now, context.side)
    // Signed in from the email, in their own browser (where Apple Pay
    // works): straight to that checkout, to the gift look, or to the Event
    // Stylist with the event they picked. The book needs no account.
    let url = crossSellPage(kind, offer.product, user.locale, edit)
    let gift: CrossSellPersonal['gift'] = null
    let occasionUrls: string[] = []

    if (kind === 'xsell_event') {
      occasionUrls = await signInLinks(
        app,
        user,
        kind,
        emailCopy(user.locale).crossSell.event.occasions.map((item) => studioPath('/studio/events', { occasion: item.occasion })),
      )
    } else if (offer.product !== 'outfit_guide') {
      const target = crossSellTarget(kind, offer.product, edit)
      const giftLook = personal.giftLook
      const [checkout, look] = await signInLinks(app, user, kind, [
        studioPath(target.path, target.params),
        ...(giftLook ? [`/studio/looks/${giftLook.id}`] : []),
      ])
      url = checkout!
      gift = giftLook && look ? { url: look, color: giftLook.color } : null
    }

    const content = lifecycleContentFor(
      kind,
      user,
      context.avatar ?? undefined,
      { count: 0, lastAt: null },
      sendId,
      undefined,
      undefined,
      undefined,
      { url, side: context.side, heroUrl: personal.heroUrl, gift, cut: personal.cut, edit: personal.edit, occasionUrls },
      now,
    )

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
    app.log.info(
      { userId: user._id.toString(), kind, product: offer.product, photo: Boolean(personal.heroUrl), edit, delivered },
      'Cross-sell email',
    )
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString(), kind }, 'Cross-sell email failed; will retry')
    // Back as it was: the new-Edit email's previous date, and the Edit off
    // the list unless it was already there.
    const previous = recurring ? user.lifecycleEmails?.[kind] : undefined
    const set: Record<string, Date> = {}
    const unset: Record<string, ''> = {}

    if (previous) {
      set[field] = previous
    } else {
      unset[field] = ''
    }

    if (user.lifecycleEmailLastAt) {
      set.lifecycleEmailLastAt = user.lifecycleEmailLastAt
    } else {
      unset.lifecycleEmailLastAt = ''
    }

    const pull = edit && !(user.editEmails ?? []).includes(edit) ? edit : null

    await Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne(
        { _id: user._id },
        {
          ...(Object.keys(set).length > 0 ? { $set: set } : {}),
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
          ...(pull ? { $pull: { editEmails: pull } } : {}),
        },
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
        .find(
          { userId: { $in: ids } },
          {
            projection: {
              userId: 1,
              status: 1,
              readyAt: 1,
              colorAnalysis: 1,
              avatarKey: 1,
              colorsAt: 1,
              updatedAt: 1,
              'drapePreview.status': 1,
              'drapePreview.lockedKey': 1,
            },
          },
        )
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
    void sendCrossSells(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Cross-sell run crashed')
    })
    void sendReportReminders(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Unopened report run crashed')
    })
  }

  setTimeout(run, FIRST_RUN_AFTER_MS).unref()
  setInterval(run, RUN_EVERY_MS).unref()
}
