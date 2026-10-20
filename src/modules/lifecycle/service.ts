import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { emailCopy } from '../../i18n/emails.js'
import type { AvatarDocument, ColorSwatch, EmailAsset, LifecycleEmailKind, LookDocument, PurchaseProduct, TeaserDocument, UserDocument } from '../../types/mongo.js'
import { deliverEmail, deliverLinkEmail } from '../../utils/email.js'
import { appUrl, type Locale } from '../../utils/locale.js'
import { withLocale } from '../../utils/request-locale.js'
import { localHour } from '../../utils/timezones.js'
import { hmacSign, hmacVerify } from '../../utils/tokens.js'
import { trackServerEvent } from '../analytics/service.js'
import { presentationOf } from '../avatar/body.js'
import { storedAdIds } from '../billing/conversions.js'
import { billingState, isAdmin } from '../billing/entitlements.js'
import { REGION_CURRENCY, regionalAmount, regionForCountry } from '../billing/pricing.js'
import { sendRefundReminders } from '../billing/refund-requests.js'
import { offerView } from '../feedback/rules.js'
import { EDITS, UPCOMING_EDITS } from '../looks/edits.js'
import { catalogTable, looksFor } from '../looks/icon-routes.js'
import { assetSlot, editOfIcon, editText, hasGenerator, startAsset } from './assets.js'
import {
  CROSS_SELL_RULES,
  addonEnding,
  editDue,
  latestEdit,
  pickCrossSell,
  proCreditDue,
  proTourLinkDue,
  proTourPath,
  type CrossSellKind,
  type CrossSellState,
} from './cross-sell.js'
import { LIFECYCLE_RULES, lastLifecycleEmailAt, pickLifecycleEmail, tooSoonAfter, type LifecycleState } from './schedule.js'
import {
  appLink,
  avatarNudgeEmail,
  checkoutRescueEmail,
  colorsReadyEmail,
  costumeOfferEmail,
  faceAgeLaunchEmail,
  halfLastCallEmail,
  teaserReadyEmail,
  proRescueEmail,
  proWelcomeEmail,
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
import { durationMs, emailLink, studioPathOf } from '../../utils/auth-links.js'
import { isPlaceholderEmail } from '../../utils/deleted-accounts.js'
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
// Links back to the app are wrapped: the ones tagged utm_source=email, and
// every studio page, which signs the person in when clicked
// (clickDestination). The unsubscribe link stays direct, and a link with a
// sign-in token in it is never wrapped (the redirect's address is logged).
// The redirect is signed per link, so it can't send people anywhere else.
// Oct 16, 2026: from Oct 14 the studio links were sign-in links made at
// sending, which this skipped (0 clicks counted), and the few tagged ones
// carried their token through the redirect.

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
const isAppLink = (url: string) =>
  url.startsWith(env.APP_URL) && !/[?&]token=/.test(url) && (url.includes('utm_source=email') || studioPathOf(url) !== null)

// Whether a click counts in Admin → Emails: not the footer's email
// preferences or a "manage your plan" line (the account page, untagged).
export function countsAsClick(target: string) {
  return target.includes('utm_source=email') || !studioPathOf(target)?.startsWith('/studio/account')
}

// Where a tracked click goes: a studio page signs its recipient in, with a
// sign-in link made now (emailLink: any browser, the email's ad ids), while
// the email is recent (EMAIL_LINK_TTL) and their password hasn't changed
// since it went out. Never for an admin or a deleted account; other pages,
// and everyone else, get the page as it is.
export async function clickDestination(app: FastifyInstance, sendId: string, target: string, now = Date.now()) {
  const path = studioPathOf(target)
  const send = path && ObjectId.isValid(sendId)
    ? await app.collections.emailSends.findOne({ _id: new ObjectId(sendId) }, { projection: { userId: 1, sentAt: 1, ads: 1 } })
    : null
  const user = send ? await app.collections.users.findOne({ _id: send.userId }) : null
  const ttl = durationMs(env.EMAIL_LINK_TTL) ?? 14 * 24 * 60 * 60 * 1000

  if (
    !path ||
    !send ||
    !user ||
    user.deletedAt ||
    isAdmin(user) ||
    send.sentAt.getTime() + ttl < now ||
    (user.passwordUpdatedAt && user.passwordUpdatedAt.getTime() > send.sentAt.getTime())
  ) {
    return target
  }

  // Missing: the account's stored Meta click; null: none (its browser
  // didn't allow tracking).
  const ads = send.ads === undefined ? storedAdIds(user) : (send.ads ?? undefined)

  return emailLink(app, user, path, { ads, ttl: '1d' })
}

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
  Partial<Pick<AvatarDocument, 'avatarKey' | 'colorsAt' | 'updatedAt' | 'drapePreview' | 'colorsNotify'>>
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
    colorsPending: Boolean(avatar?.colorsNotify && !avatar.colorsNotify.sentAt && !avatar.colorsNotify.gaveUpAt),
    // The Halloween flow: costumes picked to try next, or one tried on free.
    costumeFlow: Boolean(user.lookPicks?.at) || (user.freeTryOns ?? 0) > 0,
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
      return trialStartedEmail({ ...recipient, trialEnd: trialEndOf(user), days: trialDaysOf(user), free: Boolean(user.proTrialFree) })
    case 'trial_ending':
      return trialEndingEmail({ ...recipient, trialEnd: trialEndOf(user), looksLeft: billingState(user).credits })
    case 'checkout_rescue':
      return checkoutRescueEmail({ ...recipient, product: rescue?.product ?? 'color_report', url: rescue?.url ?? appUrl(locale, '/studio') })
    case 'checkout_link':
      // Sent the moment they tap Buy, by lifecycle/checkout-link.ts.
      throw new Error('checkout_link emails are built by sendCheckoutLink')
    case 'purchase_in_account':
      // Sent when a guest pays with this account's email, by billing/guest-checkout.ts.
      throw new Error('purchase_in_account emails are built by shareWithEmailOwner')
    case 'pro_welcome':
      return proWelcomeEmail({ ...recipient, hasColors: Boolean(analysis) })
    case 'face_age_launch':
      return faceAgeLaunchEmail(recipient)
    case 'report_unopened':
      return reportUnopenedEmail({ ...recipient, season: analysis?.season ?? null, url: rescue?.url ?? appUrl(locale, '/studio/report') })
    case 'costume_offer':
      // Needs the try-on it shows: sendCostumeOffers makes it.
      throw new Error('costume_offer emails are built by sendCostumeOffer')
    case 'teaser_ready':
    case 'half_offer_last_call':
      throw new Error(`${kind} emails are built by sendTeaserEmails`)
    case 'pro_rescue':
      throw new Error('pro_rescue emails are built by sendProRescues')
    case 'colors_ready':
      return colorsReadyEmail({ ...recipient, season: analysis?.season ?? null, url: rescue?.url ?? appUrl(locale, '/studio') })
    case 'look_reminder':
      // Her own numbers: look/reminders.ts makes it.
      throw new Error('look_reminder emails are built by sendLookReminders')
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

// What an advisor they just bought makes Pro annual cost (billing
// reportCreditFor): in their prices, as checkout charges it, while it has a
// day left. `since`: the purchase it counts from.
export type ProCreditOffer = {
  price: number
  regular: number
  credit: number
  currency: string
  from: 'color' | 'style' | 'both'
  since: Date
  until: Date
}

export function proCreditOffer(user: UserDocument, now: Date): ProCreditOffer | null {
  const billing = billingState(user, now.getTime())
  const credit = billing.reportCredit

  if (!credit || billing.comp || credit.until.getTime() - now.getTime() < CROSS_SELL_RULES.proCreditMinLeft) {
    return null
  }

  const regular = regionalAmount('pro_annual', regionForCountry(user.location?.country))
  const dates = credit.from.map((side) => (side === 'color' ? user.colorReportAt : user.styleReportAt)).filter((date): date is Date => Boolean(date))

  return {
    price: Math.max(0, regular - credit.amount),
    regular,
    credit: credit.amount,
    currency: credit.currency,
    from: credit.from.length > 1 ? 'both' : (credit.from[0] ?? 'color'),
    since: dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : now,
    until: credit.until,
  }
}

// What a cross-sell sells and for how much: the other report at the pair
// price while it lasts (the same check checkout makes), the rest at theirs,
// in the prices and currency of where they pay (billing/pricing.ts, as
// checkout prices it). Pro: annual with their report credit while it lasts
// (`credit`), monthly otherwise.
export function crossSellOffer(
  kind: CrossSellKind,
  user: UserDocument,
  now: Date,
  side: 'style' | 'color' | null = null,
  credit: ProCreditOffer | null = proCreditOffer(user, now),
): Offer {
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
      return credit
        ? { product: 'pro_annual', price: credit.price, regular: credit.regular, currency: credit.currency, until: credit.until, side: null }
        : once('pro_monthly')
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

// `credit`: the report credit the send priced with (null: none, or left
// out for the bundle's buyers); `proCreditUrl`: the Pro credit block's
// checkout, when this email carries it (proCreditDue); `proTourUrl`: the
// web's Pro tour under it (proTourLinkDue).
export type CrossSellLink = {
  url: string
  side: 'style' | 'color' | null
  credit?: ProCreditOffer | null
  proCreditUrl?: string | null
  proTourUrl?: string | null
} & CrossSellPersonal

export function crossSellContentFor(
  kind: CrossSellKind,
  user: UserDocument,
  avatar: AvatarFacts | undefined,
  link?: CrossSellLink,
  now = new Date(),
): CrossSellContent {
  const credit = link && 'credit' in link ? (link.credit ?? null) : proCreditOffer(user, now)
  const offer = crossSellOffer(kind, user, now, link?.side ?? null, credit)
  const billing = billingState(user, now.getTime())
  const analysis = avatar?.status === 'ready' ? avatar.colorAnalysis : null
  const url = link?.url ?? crossSellPage(kind, offer.product, user.locale, link?.edit?.id ?? null)
  // The Pro email sells annual with the credit; the others carry it as a
  // block with its own checkout.
  const proCreditUrl = kind === 'xsell_pro' && offer.product === 'pro_annual' ? url : (link?.proCreditUrl ?? null)

  return {
    kind,
    price: offer.price,
    regular: offer.regular,
    currency: offer.currency,
    until: offer.until,
    side: offer.side,
    owns: { color: billing.colorReport, style: billing.styleReport },
    url,
    season: analysis?.season ?? null,
    // They paid for their colors, so the email can show them.
    colors: billing.colorReport ? (analysis?.bestColors ?? []).slice(0, 4) : [],
    now,
    heroUrl: link?.heroUrl ?? null,
    gift: link?.gift ?? null,
    cut: link?.cut ?? null,
    edit: link?.edit ?? null,
    occasionUrls: link?.occasionUrls ?? [],
    proCredit:
      credit && proCreditUrl
        ? {
            price: credit.price,
            regular: credit.regular,
            credit: credit.credit,
            from: credit.from,
            until: credit.until,
            url: proCreditUrl,
            tourUrl: link?.proTourUrl ?? null,
          }
        : null,
  }
}

function trialEndOf(user: UserDocument) {
  return user.pro?.trialEnd ?? user.pro?.periodEnd ?? new Date(Date.now() + env.PRO_TRIAL_DAYS * 24 * 60 * 60 * 1000)
}

// How long her trial is (a colors_pro campaign's is shorter than the paid one).
function trialDaysOf(user: UserDocument) {
  const end = user.pro?.trialEnd
  const start = user.proTrialAt

  return end && start ? Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))) : env.PRO_TRIAL_DAYS
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
            url: appUrl(user.locale, `/studio?buy=color_report&from=${from}`),
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

  // Each person's latest checkout in the window.
  const events = await app.collections.analyticsEvents
    .find(
      { name: 'checkout_created', userId: { $ne: null }, at: { $gte: new Date(now.getTime() - RESCUE_WITHIN_MS), $lte: new Date(now.getTime() - RESCUE_AFTER_MS) } },
      { projection: { userId: 1, props: 1, at: 1 } },
    )
    .sort({ at: -1 })
    .limit(5000)
    .toArray()
  const checkouts = [
    ...new Map(
      events.filter((event) => event.userId).map((event) => [event.userId!.toString(), { _id: event.userId!, product: event.props.product, at: event.at }] as const).reverse(),
    ).values(),
  ]
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

    // Pro has its own rescue (sendProRescues).
    if (String(checkout.product ?? '').startsWith('pro_')) {
      continue
    }

    // Spaced from their other emails like the onboarding ones (the colors
    // offer often goes out the same hour). It still goes later in its
    // window if they haven't paid by then.
    if (tooSoonAfter(lastLifecycleEmailAt(user), now.getTime())) {
      continue
    }

    // Paid since (this checkout or anything else, here or in another
    // account of theirs): nothing to rescue.
    if (await paidSince(app, user._id, checkout.at)) {
      continue
    }

    if (await sendCheckoutRescue(app, user, String(checkout.product ?? 'color_report'), now)) {
      sent += 1
    }
  }

  return sent
}

// Paid since `at`, in this account or in another one of theirs: the same
// browser (visitor id) signed up again to pay. Oct 18, 2026: a woman in
// Australia tried Pro five times inside Instagram, then paid with a new
// account in Safari, and the old one got "your Pro is one step away".
async function paidSince(app: FastifyInstance, userId: ObjectId, at: Date) {
  if (await app.collections.purchases.findOne({ userId, createdAt: { $gte: at } })) {
    return true
  }

  const mine = await app.collections.analyticsEvents.find({ userId, visitorId: { $ne: null } }, { projection: { visitorId: 1 } }).limit(500).toArray()
  const visitors = [...new Set(mine.map((event) => event.visitorId).filter((id): id is string => Boolean(id)))]

  if (!visitors.length) {
    return false
  }

  const theirs = await app.collections.analyticsEvents.find({ visitorId: { $in: visitors }, userId: { $ne: null } }, { projection: { userId: 1 } }).limit(500).toArray()
  const others = [...new Map(theirs.filter((event) => event.userId && !event.userId.equals(userId)).map((event) => [event.userId!.toString(), event.userId!])).values()]

  return others.length > 0 && Boolean(await app.collections.purchases.findOne({ userId: { $in: others }, createdAt: { $gte: at } }))
}

// ---------------------------------------------------------------- Pro rescue

// Oct 19, 2026 (Silvio: "no tenemos rescate de pro? agreguémoslo"): Pro
// had only the generic "finish in your browser" email, once per account
// ever (so not for anyone a Color Advisor rescue had reached), with no
// picture and no price. Now, 45 minutes after a Pro checkout that wasn't
// paid: her best version drawn ahead, blurred, her half-price month if it's
// still open, and a link that signs her in and opens that same checkout.
// Once per account; promotional (opt-outs, the postal address); never to
// Pro, admins or guests, nor to anyone who paid since in another account.
const PRO_RESCUE_AFTER_MS = 45 * 60 * 1000
const PRO_RESCUE_WITHIN_MS = 48 * 60 * 60 * 1000

export async function sendProRescues(app: FastifyInstance, now = new Date()) {
  if (!env.EMAIL_POSTAL_ADDRESS) {
    return 0
  }

  const events = await app.collections.analyticsEvents
    .find(
      { name: 'checkout_created', userId: { $ne: null }, at: { $gte: new Date(now.getTime() - PRO_RESCUE_WITHIN_MS), $lte: new Date(now.getTime() - PRO_RESCUE_AFTER_MS) } },
      { projection: { userId: 1, props: 1, at: 1 } },
    )
    .sort({ at: -1 })
    .limit(BATCH)
    .toArray()
  const seen = new Set<string>()
  let sent = 0

  for (const event of events) {
    const product = String(event.props.product ?? '')

    if (!event.userId || !product.startsWith('pro_') || seen.has(event.userId.toString())) {
      continue
    }

    seen.add(event.userId.toString())
    const user = await app.collections.users.findOne({ _id: event.userId, ...eligibleFor('lifecycleEmails.pro_rescue') })

    if (!user || isAdmin(user) || billingState(user, now.getTime()).proLive || (await paidSince(app, user._id, event.at))) {
      continue
    }

    if (await sendProRescue(app, user, product, now)) {
      sent += 1
    }
  }

  return sent
}

async function sendProRescue(app: FastifyInstance, user: UserDocument, product: string, now: Date) {
  return sendOnce(app, user, 'pro_rescue', now, async (sendId) => {
    const locale = user.locale ?? 'en'
    const half = halfFor(user, now)
    const teaser = await app.collections.teasers.findOne({ userId: user._id, status: 'ready', unlockedAt: null, lockedKey: { $ne: null } }, { sort: { createdAt: -1 } })
    // Her free trial if she still has it (a colors_pro campaign); with her
    // half price open, the month it applies to; otherwise the plan she was
    // paying for.
    const trialDays = product === 'pro_annual' ? null : billingState(user).freeTrialDays
    const buy = trialDays ? 'pro_trial' : half ? 'pro_monthly' : product === 'pro_annual' ? 'pro_annual' : 'pro_monthly'

    return proRescueEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      half: half ? { price: half.price, amount: half.amount, currency: half.currency, hours: half.hours } : null,
      photoUrl: teaser ? emailImageUrl(user._id, now, `teaser-${teaser._id.toString()}`) : null,
      url: emailUrl(locale, `/studio?buy=${buy}&from=email_pro_rescue`, 'pro_rescue'),
      trialDays,
    })
  })
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
    const url = appUrl(user.locale, rescueNext(product))
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
      deletedAt: null,
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
    const url = appUrl(locale, '/studio/report')
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

// ---------------------------------------------------------------- pro welcome

// Pro started in the last days (Oct 16, 2026; Silvio: to everyone who
// subscribes): where to begin, once. A subscriber who uses only her colors
// in the first month is the one who cancels.
const PRO_WELCOME_WITHIN_MS = 3 * 24 * 60 * 60 * 1000

export async function sendProWelcomes(app: FastifyInstance, now = new Date()) {
  const since = new Date(now.getTime() - PRO_WELCOME_WITHIN_MS)
  const ids = await app.collections.purchases.distinct('userId', {
    product: { $in: ['pro_monthly', 'pro_annual', 'pro_trial'] },
    createdAt: { $gte: since },
  })

  if (ids.length === 0) {
    return 0
  }

  const users = await app.collections.users
    .find({
      _id: { $in: ids },
      'pro.status': { $in: ['active', 'trialing'] },
      'pro.subscriptionId': { $ne: SIMULATED_SUBSCRIPTION },
      'lifecycleEmails.pro_welcome': { $exists: false },
      deletedAt: null,
    })
    .limit(BATCH)
    .toArray()
  let sent = 0

  for (const user of users) {
    if (isAdmin(user) || isPlaceholderEmail(user.email)) {
      continue
    }

    if (await sendOneOff(app, user, 'pro_welcome', now)) {
      sent += 1
    }
  }

  return sent
}

// ---------------------------------------------------------------- face age launch

// Oct 2026, once each, while FACE_AGE_LAUNCH is on: Face Age to everyone
// registered without Pro (Silvio, Oct 16: all of them, not only buyers),
// in their daytime, a batch a run.
// Promotional: not to anyone who turned off tips, not where Face Age is
// closed (Illinois, Washington), not to anyone already using it.
const LAUNCH_BATCH = 2000

export async function sendFaceAgeLaunch(app: FastifyInstance, now = new Date()) {
  if (!env.FACE_AGE_LAUNCH) {
    return 0
  }

  const users = await app.collections.users
    .find({
      'pro.status': { $nin: ['active', 'trialing'] },
      'lifecycleEmails.face_age_launch': { $exists: false },
      lookGreat: { $exists: false },
      emailTipsOptOutAt: null,
      deletedAt: null,
      guest: { $ne: true },
    })
    // Everyone in one pass (~700 people): those outside their daytime are
    // skipped and come back on a later run.
    .limit(LAUNCH_BATCH)
    .toArray()
  let sent = 0

  for (const user of users) {
    if (isAdmin(user) || isPlaceholderEmail(user.email) || faceAgeClosed(user)) {
      continue
    }

    const hour = localHour(user.location, now)

    if (hour < CROSS_SELL_RULES.sendHours.from || hour >= CROSS_SELL_RULES.sendHours.to) {
      continue
    }

    if (await sendOneOff(app, user, 'face_age_launch', now)) {
      sent += 1
    }
  }

  return sent
}

// Face Age isn't offered in Illinois or Washington (modules/look).
function faceAgeClosed(user: UserDocument) {
  const where = user.location
  return where?.country === 'US' && (where.region === 'IL' || where.region === 'WA')
}

// One email of a kind, once: marked before sending (two processes never
// send it twice), rolled back if it fails, its studio links signing in.
async function sendOneOff(app: FastifyInstance, user: UserDocument, kind: 'pro_welcome' | 'face_age_launch', now: Date) {
  const field = `lifecycleEmails.${kind}`
  const claimed = await app.collections.users.updateOne({ _id: user._id, [field]: { $exists: false } }, { $set: { [field]: now } })

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    const avatar = await app.collections.avatars.findOne({ userId: user._id })
    const content = lifecycleContentFor(kind, user, avatar ?? undefined, { count: 0, lastAt: null }, sendId)

    await app.collections.emailSends.insertOne({ _id: sendId, userId: user._id, kind, subject: content.subject, sentAt: now, opens: 0, clicks: 0 })

    const delivered = await deliverEmail({
      log: app.log,
      to: { email: user.email, name: user.firstName },
      content: trackContent(content, sendId),
    })
    app.log.info({ userId: user._id.toString(), kind, delivered }, 'One-off email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString(), kind }, 'One-off email failed; will retry')
    await Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne({ _id: user._id }, { $unset: { [field]: '' } }),
    ])
    return false
  }
}

// ---------------------------------------------------------------- costume offer

// The Halloween flow (Oct 2026): a costume picked from the Halloween Edit, a
// selfie, their email, and that costume tried on free (looks.freeTryOn).
// Whoever doesn't have Pro gets one email an hour after the try-on was
// ready: it on top, the costumes they picked to try next (users.lookPicks),
// what Pro adds and the next Edits, with a link that signs them in on the
// Halloween Edit. Promotional: never to guests, admins, deleted accounts or
// anyone who turned off tips, and not before the postal address is set.
// Their first email: the welcome stays out of it (stateFor costumeFlow).
const COSTUME_OFFER_AFTER_MS = 60 * 60 * 1000
const COSTUME_OFFER_WITHIN_MS = 3 * 24 * 60 * 60 * 1000
const COSTUME_OFFER_DROPS = 2

// Every Edit look by id, and the costumes' ids (the costume Edits' looks).
const EDIT_LOOKS = new Map(EDITS.flatMap((edit) => edit.looks.map((look) => [look.id, look] as const)))
const COSTUME_IDS = EDITS.filter((edit) => edit.costumes).flatMap((edit) => edit.looks.map((look) => look.id))

// The costume and the picks in their language (i18n/catalog.*.ts, English
// from the Edits when missing), without the one they tried; and the next
// Edits (UPCOMING_EDITS), the ones still to drop in New York today.
export function costumeOfferNames(locale: Locale, costumeId: string, picks: string[], now: Date) {
  const table = withLocale(locale, () => catalogTable())
  const name = (id: string) => table?.looks[id]?.name ?? EDIT_LOOKS.get(id)?.name ?? null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)

  return {
    costume: name(costumeId) ?? costumeId,
    picks: [...new Set(picks)]
      .filter((id) => id !== costumeId)
      .map(name)
      .filter((value): value is string => Boolean(value)),
    next: UPCOMING_EDITS.filter((drop) => drop.at > today)
      .slice(0, COSTUME_OFFER_DROPS)
      .map((drop) => ({ ...drop, name: table?.upcoming[drop.name] ?? drop.name })),
  }
}

export async function sendCostumeOffers(app: FastifyInstance, now = new Date()) {
  if (!env.EMAIL_POSTAL_ADDRESS) {
    return 0
  }

  // Newest first: older try-ons in the window have mostly had theirs. The
  // createdAt bound (a day more than the window) keeps the scan on its index.
  const looks = await app.collections.looks
    .find(
      {
        createdAt: { $gte: new Date(now.getTime() - COSTUME_OFFER_WITHIN_MS - 24 * 60 * 60 * 1000) },
        freeTryOn: true,
        status: 'ready',
        iconId: { $in: COSTUME_IDS },
        readyAt: {
          $gte: new Date(now.getTime() - COSTUME_OFFER_WITHIN_MS),
          $lte: new Date(now.getTime() - COSTUME_OFFER_AFTER_MS),
        },
      },
      { projection: { userId: 1, iconId: 1, imageKey: 1 } },
    )
    .sort({ readyAt: -1 })
    .limit(BATCH)
    .toArray()
  const seen = new Set<string>()
  let sent = 0

  for (const look of looks) {
    const id = look.userId.toString()

    if (seen.has(id)) {
      continue
    }

    seen.add(id)
    const user = await app.collections.users.findOne({
      _id: look.userId,
      'lifecycleEmails.costume_offer': { $exists: false },
      guest: { $ne: true },
      deletedAt: null,
      emailTipsOptOutAt: null,
    })

    if (!user || isAdmin(user) || billingState(user, now.getTime()).proActive) {
      continue
    }

    if (await sendCostumeOffer(app, user, look, now)) {
      sent += 1
    }
  }

  return sent
}

async function sendCostumeOffer(
  app: FastifyInstance,
  user: UserDocument,
  look: Pick<LookDocument, '_id' | 'iconId' | 'imageKey'>,
  now: Date,
) {
  const field = 'lifecycleEmails.costume_offer'
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, [field]: { $exists: false }, emailTipsOptOutAt: null },
    { $set: { [field]: now, lifecycleEmailLastAt: now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    const locale = user.locale ?? 'en'
    const names = costumeOfferNames(locale, look.iconId ?? '', user.lookPicks?.ids ?? [], now)
    // Signed in from the email, in their own browser, on the Halloween Edit.
    const signIn = new URL(appUrl(locale, '/studio/halloween?from=email'))
    signIn.searchParams.set('utm_source', 'email')
    signIn.searchParams.set('utm_medium', 'lifecycle')
    signIn.searchParams.set('utm_campaign', 'costume_offer')
    // Their try-on, through a signed link (emailImageKey serves a ready look).
    const photoUrl = look.imageKey ? emailImageUrl(user._id, now, `look-${look._id.toString()}`) : null
    const content = costumeOfferEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      ...names,
      photoUrl,
      url: signIn.toString(),
    })

    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind: 'costume_offer',
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
      { userId: user._id.toString(), costume: look.iconId, picks: names.picks.length, photo: Boolean(photoUrl), delivered },
      'Costume offer email',
    )
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString() }, 'Costume offer email failed; will retry')
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

// ---------------------------------------------------------------- teasers

// Her best version drawn ahead (teasers/service.ts) and her half-price
// month (feedback/wow-offer.ts) after her first read (Oct 18, 2026): 9 in
// 10 sign-ups never come back the next day, so most would see neither. An
// hour after it's drawn, if it's still locked: the blurred picture and a
// link to it. A few hours before the half price ends, unused: a last call
// that opens checkout. Promotional (opt-outs, the postal address), never to
// Pro, admins or guests without an email; each once.
const TEASER_READY_AFTER_MS = 60 * 60 * 1000
const TEASER_READY_WITHIN_MS = 2 * 24 * 60 * 60 * 1000
const HALF_LAST_CALL_BEFORE_MS = 6 * 60 * 60 * 1000

const eligibleFor = (field: string) => ({ [field]: { $exists: false }, guest: { $ne: true }, deletedAt: null, emailTipsOptOutAt: null })

export async function sendTeaserEmails(app: FastifyInstance, now = new Date()) {
  if (!env.EMAIL_POSTAL_ADDRESS) {
    return 0
  }

  let sent = 0
  const teasers = await app.collections.teasers
    .find({ status: 'ready', unlockedAt: null, updatedAt: { $gte: new Date(now.getTime() - TEASER_READY_WITHIN_MS), $lte: new Date(now.getTime() - TEASER_READY_AFTER_MS) } })
    .sort({ updatedAt: -1 })
    .limit(BATCH)
    .toArray()
  const seen = new Set<string>()

  for (const teaser of teasers) {
    if (seen.has(teaser.userId.toString())) {
      continue
    }

    seen.add(teaser.userId.toString())
    const user = await app.collections.users.findOne({ _id: teaser.userId, ...eligibleFor('lifecycleEmails.teaser_ready') })

    if (user && !isAdmin(user) && !billingState(user, now.getTime()).proActive && (await sendTeaserReady(app, user, teaser, now))) {
      sent += 1
    }
  }

  const ending = await app.collections.users
    .find({
      'proHalfOffer.until': { $gt: now, $lte: new Date(now.getTime() + HALF_LAST_CALL_BEFORE_MS) },
      'proHalfOffer.usedAt': null,
      ...eligibleFor('lifecycleEmails.half_offer_last_call'),
    })
    .limit(BATCH)
    .toArray()

  for (const user of ending) {
    if (!isAdmin(user) && !billingState(user, now.getTime()).proActive && (await sendHalfLastCall(app, user, now))) {
      sent += 1
    }
  }

  return sent
}

// One lifecycle email, claimed on the account first and rolled back if it
// can't go (the next run tries again), like the costume offer.
async function sendOnce(
  app: FastifyInstance,
  user: UserDocument,
  kind: 'teaser_ready' | 'half_offer_last_call' | 'pro_rescue',
  now: Date,
  build: (sendId: ObjectId) => Promise<EmailContent | null>,
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
  const rollback = () =>
    Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne(
        { _id: user._id },
        user.lifecycleEmailLastAt
          ? { $unset: { [field]: '' }, $set: { lifecycleEmailLastAt: user.lifecycleEmailLastAt } }
          : { $unset: { [field]: '', lifecycleEmailLastAt: '' } },
      ),
    ])

  try {
    const content = await build(sendId)

    if (!content) {
      await rollback()
      return false
    }

    await app.collections.emailSends.insertOne({ _id: sendId, userId: user._id, kind, subject: content.subject, sentAt: now, opens: 0, clicks: 0 })
    const delivered = await deliverEmail({ log: app.log, to: { email: user.email, name: user.firstName }, content: trackContent(content, sendId) })
    app.log.info({ userId: user._id.toString(), kind, delivered }, 'Teaser email')
    return delivered
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString(), kind }, 'Teaser email failed; will retry')
    await rollback()
    return false
  }
}

function emailUrl(locale: Locale, path: string, campaign: string) {
  const url = new URL(appUrl(locale, path))
  url.searchParams.set('utm_source', 'email')
  url.searchParams.set('utm_medium', 'lifecycle')
  url.searchParams.set('utm_campaign', campaign)
  return url.toString()
}

function halfFor(user: UserDocument, now: Date) {
  const half = offerView(user.proHalfOffer, regionForCountry(user.location?.country), now.getTime())
  return half ? { price: half.price, amount: half.amount, currency: half.currency, hours: Math.max(1, Math.floor((Date.parse(half.until) - now.getTime()) / 3_600_000)) } : null
}

async function sendTeaserReady(app: FastifyInstance, user: UserDocument, teaser: TeaserDocument, now: Date) {
  return sendOnce(app, user, 'teaser_ready', now, async (sendId) => {
    const locale = user.locale ?? 'en'
    const fromPurchase = teaser.kind === 'perfect_haircut' && !(await app.collections.scoreChecks.findOne({ _id: teaser.sourceId }, { projection: { _id: 1 } }))

    return teaserReadyEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      kind: teaser.kind,
      name: teaser.kind === 'perfect_haircut' ? (teaser.plan?.name ?? null) : null,
      fromPurchase,
      photoUrl: teaser.lockedKey ? emailImageUrl(user._id, now, `teaser-${teaser._id.toString()}`) : null,
      half: halfFor(user, now),
      url: emailUrl(locale, `/studio/teasers/${teaser._id.toString()}?from=email`, 'teaser_ready'),
    })
  })
}

async function sendHalfLastCall(app: FastifyInstance, user: UserDocument, now: Date) {
  return sendOnce(app, user, 'half_offer_last_call', now, async (sendId) => {
    const half = halfFor(user, now)

    if (!half) {
      return null
    }

    const locale = user.locale ?? 'en'
    const teaser = await app.collections.teasers.findOne({ userId: user._id, status: 'ready', unlockedAt: null, lockedKey: { $ne: null } }, { sort: { createdAt: -1 } })

    return halfLastCallEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      price: half.price,
      amount: half.amount,
      currency: half.currency,
      photoUrl: teaser ? emailImageUrl(user._id, now, `teaser-${teaser._id.toString()}`) : null,
      // Checkout right away (components/upgrade ?buy=); the price is applied there.
      url: emailUrl(locale, '/studio?buy=pro_monthly&from=email_half_last_call', 'half_offer_last_call'),
    })
  })
}

// ---------------------------------------------------------------- colors ready

const COLORS_READY_SEND_TRIES = 3

// Their color read failed because the AI was busy or out of credits, they
// left their email, and it's done now (avatar/retry.ts): a sign-in link to
// their colors. They asked for it, so it goes out even to people who turned
// off tips. Marked on the avatar before sending, and on the account like
// any lifecycle email so the colors offer waits its gap; all of it rolled
// back if sending fails, for the next run to try again (given up after 3).
// The link has its own nonce ('colors'): the offer's sign-in link, a day
// later, doesn't void it within the 3 days the email promises.
export async function sendColorsReady(
  app: FastifyInstance,
  user: UserDocument,
  avatar: Pick<AvatarDocument, '_id' | 'colorAnalysis' | 'colorsNotify'>,
  now = new Date(),
) {
  const field = 'lifecycleEmails.colors_ready'
  const claimed = await app.collections.avatars.updateOne(
    { _id: avatar._id, 'colorsNotify.requestedAt': { $exists: true }, 'colorsNotify.sentAt': null },
    { $set: { 'colorsNotify.sentAt': now } },
  )

  if (claimed.modifiedCount === 0) {
    return false
  }

  const sendId = new ObjectId()

  try {
    await app.collections.users.updateOne({ _id: user._id }, { $set: { [field]: now, lifecycleEmailLastAt: now } })

    const locale = user.locale ?? 'en'
    const url = appUrl(locale, '/studio')
    const content = colorsReadyEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      season: avatar.colorAnalysis?.season ?? null,
      url,
    })

    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind: 'colors_ready',
      subject: content.subject,
      sentAt: now,
      opens: 0,
      clicks: 0,
    })

    const delivery = await deliverLinkEmail({
      log: app.log,
      to: { email: user.email, name: user.firstName },
      // Only for development, where nothing is sent: a link that signs in.
      link: await emailLink(app, user, '/studio', { ads: storedAdIds(user) }),
      content: trackContent(content, sendId),
    })
    app.log.info({ userId: user._id.toString(), sent: delivery.sent }, 'Colors ready email')
    void trackServerEvent(app, {
      name: 'colors_notify_sent',
      userId: user._id,
      props: avatar.colorsNotify ? { via: avatar.colorsNotify.via } : {},
    })
    return true
  } catch (error) {
    const failures = (avatar.colorsNotify?.sendFailures ?? 0) + 1
    const giveUp = failures >= COLORS_READY_SEND_TRIES

    app.log.error(
      { err: error, userId: user._id.toString(), failures },
      giveUp ? 'Colors ready email failed; given up' : 'Colors ready email failed; will retry',
    )

    if (giveUp) {
      void trackServerEvent(app, {
        name: 'colors_notify_gave_up',
        userId: user._id,
        props: { attempts: avatar.colorsNotify?.attempts ?? 0, reason: 'delivery' },
      })
    }

    await Promise.all([
      app.collections.avatars.updateOne(
        { _id: avatar._id, 'colorsNotify.sentAt': now },
        {
          $set: { 'colorsNotify.sentAt': null, ...(giveUp ? { 'colorsNotify.gaveUpAt': now } : {}) },
          $inc: { 'colorsNotify.sendFailures': 1 },
        },
      ),
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

const SLOT_PATTERN = /^(?:drape|xsell_[a-z_]{2,30}|edit:[a-z0-9-]{1,60}|look-[0-9a-f]{24}|teaser-[0-9a-f]{24})$/

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

  // A teaser: its blurred copy while it's locked, the picture once it's hers.
  if (slot.startsWith('teaser-')) {
    const teaser = await app.collections.teasers.findOne(
      { _id: new ObjectId(slot.slice('teaser-'.length)), userId, status: 'ready' },
      { projection: { key: 1, lockedKey: 1, resultId: 1 } },
    )
    return teaser?.lockedKey ?? (teaser?.resultId ? teaser.key : null)
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
    const signIn = new URL(appUrl(user.locale, '/studio?upgrade=palette'))
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
// `only`: just these buyers (scripts/pro-credit-e2e.ts, so a check against
// the development database leaves everyone else's emails alone).
export async function sendCrossSells(app: FastifyInstance, now = new Date(), only?: ObjectId[]) {
  if (!env.EMAIL_POSTAL_ADDRESS) {
    return 0
  }

  const buyers = await app.collections.purchases
    .aggregate<{ _id: ObjectId; lastAt: Date }>([
      {
        $match: {
          createdAt: { $gte: new Date(now.getTime() - CROSS_SELL_RULES.editHorizon) },
          refundedAt: null,
          ...(only ? { userId: { $in: only } } : {}),
        },
      },
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
    const [products, magazine, guide, avatar, bundle] = await Promise.all([
      app.collections.purchases.distinct('product', { userId: user._id }),
      app.collections.magazines.findOne({ userId: user._id }, { projection: { _id: 1 } }),
      app.collections.guideOrders.findOne({ $or: [{ userId: user._id }, { email: user.email.toLowerCase() }] }, { projection: { _id: 1 } }),
      app.collections.avatars.findOne({ userId: user._id }),
      env.PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE
        ? app.collections.purchases.findOne({ userId: user._id, product: 'advisors_bundle', refundedAt: null }, { projection: { _id: 1 } })
        : null,
    ])
    // Their report credit toward Pro annual, unless they bought the three
    // advisors together (PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE).
    const credit = bundle ? null : proCreditOffer(user, now)
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
      proCredit: credit ? { since: credit.since, until: credit.until } : null,
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

    if (await sendCrossSell(app, user, kind, { side, editId, avatar, asset, credit, withProCredit: proCreditDue(state, kind, at) }, now)) {
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
  // Their report credit toward Pro annual, and whether this email carries
  // it as a block (proCreditDue).
  credit: ProCreditOffer | null
  withProCredit: boolean
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

// The links for one email's buttons, tagged so the clicks are counted
// (trackContent); a click signs them in (clickDestination).
function signInLinks(user: UserDocument, kind: CrossSellKind, nexts: string[]) {
  return nexts.map((next) => {
    const url = new URL(appUrl(user.locale, next))
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
    const offer = crossSellOffer(kind, user, now, context.side, context.credit)
    // Signed in from the email, in their own browser (where Apple Pay
    // works): straight to that checkout, to the gift look, or to the Event
    // Stylist with the event they picked. The book needs no account. The
    // Pro credit block opens Pro annual's checkout, its own placement, and
    // under it the web's Pro tour for whom it plays.
    let url = crossSellPage(kind, offer.product, user.locale, edit)
    let gift: CrossSellPersonal['gift'] = null
    let occasionUrls: string[] = []
    const tour = proTourLinkDue({
      on: env.PRO_TOUR_EMAIL_LINK,
      withProCredit: context.withProCredit,
      colorReport: billingState(user, now.getTime()).colorReport,
      colorsRead: Boolean(context.avatar?.colorAnalysis),
      presentation: context.avatar ? presentationOf(context.avatar) : null,
    })
    const proNext = context.withProCredit
      ? [studioPath('/studio', { buy: 'pro_annual', from: `email_${kind}_pro` }), ...(tour ? [proTourPath(kind)] : [])]
      : []
    let proLinks: string[] = []

    if (kind === 'xsell_event') {
      const occasions = emailCopy(user.locale).crossSell.event.occasions.map((item) => studioPath('/studio/events', { occasion: item.occasion }))
      const links = signInLinks(user, kind, [...occasions, ...proNext])
      occasionUrls = links.slice(0, occasions.length)
      proLinks = links.slice(occasions.length)
    } else if (offer.product !== 'outfit_guide') {
      const target = crossSellTarget(kind, offer.product, edit)
      const giftLook = personal.giftLook
      const nexts = [studioPath(target.path, target.params), ...(giftLook ? [`/studio/looks/${giftLook.id}`] : [])]
      const links = signInLinks(user, kind, [...nexts, ...proNext])
      const [checkout, look] = links
      url = checkout!
      gift = giftLook && look ? { url: look, color: giftLook.color } : null
      proLinks = links.slice(nexts.length)
    } else if (proNext.length) {
      proLinks = signInLinks(user, kind, proNext)
    }

    const proCreditUrl = proLinks[0] ?? null
    const proTourUrl = tour ? (proLinks[1] ?? null) : null

    const content = lifecycleContentFor(
      kind,
      user,
      context.avatar ?? undefined,
      { count: 0, lastAt: null },
      sendId,
      undefined,
      undefined,
      undefined,
      {
        url,
        side: context.side,
        heroUrl: personal.heroUrl,
        gift,
        cut: personal.cut,
        edit: personal.edit,
        occasionUrls,
        credit: context.credit,
        proCreditUrl,
        proTourUrl,
      },
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
      {
        userId: user._id.toString(),
        kind,
        product: offer.product,
        photo: Boolean(personal.heroUrl),
        edit,
        proCredit: Boolean(proCreditUrl),
        proTour: Boolean(proTourUrl),
        delivered,
      },
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
              colorsNotify: 1,
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
    void sendProRescues(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Pro rescue run crashed')
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
    void sendCostumeOffers(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Costume offer run crashed')
    })
    void sendTeaserEmails(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Teaser emails run crashed')
    })
    void sendProWelcomes(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Pro welcome run crashed')
    })
    void sendFaceAgeLaunch(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Face Age launch run crashed')
    })
    // Refund requests: emails that didn't go out, and the founder's reminder
    // of requests waiting too long.
    void sendRefundReminders(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Refund reminders run crashed')
    })
  }

  setTimeout(run, FIRST_RUN_AFTER_MS).unref()
  setInterval(run, RUN_EVERY_MS).unref()
}
