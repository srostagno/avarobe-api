import { createHash, randomBytes } from 'node:crypto'

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { type Filter, ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { emailCopy, formatMoney } from '../../i18n/emails.js'
import type {
  BrazilBasis,
  GuideOrderDocument,
  ProSubscription,
  PurchaseDocument,
  PurchaseProduct,
  RefundCover,
  RefundReason,
  RefundRejectCode,
  RefundRequestDocument,
  RefundRequestFlag,
  RefundRequestHistory,
  RefundUsage,
  UserDocument,
} from '../../types/mongo.js'
import { isGuestEmail } from '../../utils/guests.js'
import { errorMessage } from '../../utils/http.js'
import { InvalidImageError, normalizeScreenshot } from '../../utils/images.js'
import { type Locale, requestLocale } from '../../utils/locale.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { currentLocale } from '../../utils/request-locale.js'
import { storage } from '../../utils/storage.js'
import { translateMessage } from '../../utils/translate-message.js'
import { trackServerEvent } from '../analytics/service.js'
import { shortProductName } from '../lifecycle/checkout-link.js'
import { adminUserIds, isAdmin, proIsLive } from './entitlements.js'
import { regionForCountry, toUsdCents } from './pricing.js'
import {
  type CoverToRefund,
  type RefundDeps,
  PRO_PRODUCTS,
  STRIPE_REFUNDS,
  brazilWithdrawalUntil,
  creditUsed,
  earlierAttempt,
  firstProAt,
  guideRefundableUntil,
  hasRefundablePayment,
  isPro,
  proFirstWeek,
  refundCovers,
  refundableUntil,
} from './refunds.js'
import { decisionEmailFor, founderEmail, receivedEmailFor, refundKind, reminderDigest, sendClaimedEmail } from './refund-notify.js'
import { PRODUCTS, type PaymentFacts, paymentFacts, productCopy, setProCancellation, stripeConfigured, stripeTestMode } from './stripe.js'

// Refund requests (Oct 12, 2026: the founder's decision). Refunds are no
// longer instant: the customer asks, with a reason and an explanation in
// their own words (and a screenshot if they like), and the request is
// stored here with what it covers, how much was used and their history. The
// founder is emailed at REFUNDS_EMAIL and decides in Admin → Refunds:
// approving refunds in Stripe and takes back what the purchase gave
// (billing/refunds.ts refundCovers); rejecting says why. The customer is
// emailed when it arrives and when it's decided, in their language. Nothing
// is ever approved or rejected on its own: the flags only inform.
//
// Brazil (CDC art. 49; Decreto 7.962/2013 art. 5): a purchase withdrawn
// within 7 days must be refunded, whatever the reason. Those requests are
// `statutory`: a shorter explanation is enough, the admin shows "must
// refund", and rejecting one takes an explicit override.

export { refundKind }

export const REVIEW_BUSINESS_DAYS = 2
export const MIN_CHARS = 80
export const MIN_CHARS_WITHDRAWAL = 20
export const MAX_CHARS = 2000
export const MIN_WORDS = 8
export const MIN_WORDS_WITHDRAWAL = 3
export const MAX_REQUESTS_30D = 3
export const SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
export const REMIND_AFTER_MS = 24 * HOUR_MS
export const REMIND_AFTER_STATUTORY_MS = 12 * HOUR_MS
export const STALE_APPROVAL_MS = 10 * 60 * 1000
// An email that didn't go out is tried again by the lifecycle tick after
// this long, for a day.
const RETRY_EMAIL_AFTER_MS = 5 * 60 * 1000

export const REFUND_CATEGORIES: RefundReason[] = ['not_accurate', 'quality', 'technical', 'not_expected', 'duplicate', 'mistake', 'other']
export const REJECT_CODES: RefundRejectCode[] = ['resolved', 'works_as_described', 'used', 'outside_policy', 'duplicate', 'withdrawn', 'other']

// The request routes' limit per IP (5 in 10 minutes), answered in the
// page's language (the plugin's own sentence is English with a time in it).
// Translated here: the plugin's error is answered by Fastify's own error
// reply, which the message translation hook doesn't see.
export const RATE_LIMIT_MESSAGE = 'Too many tries in a few minutes. Wait a little and try again.'

export const REQUEST_RATE_LIMIT = {
  max: 5,
  timeWindow: '10 minutes',
  errorResponseBuilder: (request: FastifyRequest, context: { statusCode: number }) =>
    Object.assign(new Error(translateMessage(RATE_LIMIT_MESSAGE, requestLocale(request))), { statusCode: context.statusCode }),
}

// What the web needs to build the form (GET /billing/purchases). `mode`
// tells the new web this API reviews refunds (production's older API has
// no `refunds`, and the web falls back to an email to hello@).
export const REFUND_SETTINGS = {
  mode: 'request',
  minChars: MIN_CHARS,
  minCharsWithdrawal: MIN_CHARS_WITHDRAWAL,
  maxChars: MAX_CHARS,
  minWords: MIN_WORDS,
  minWordsWithdrawal: MIN_WORDS_WITHDRAWAL,
  screenshotMaxBytes: SCREENSHOT_MAX_BYTES,
  reviewDays: REVIEW_BUSINESS_DAYS,
} as const

const OPEN_STATUSES = ['pending', 'failed', 'approved'] as const
const DECIDABLE = ['pending', 'failed'] as const

// A refusal the routes answer with: the status, the customer's message
// (translated on the way out) and, for analytics, why a request was blocked.
export class RefundRequestError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429 | 502,
    message: string,
    readonly blocked?: 'window' | 'limit' | 'decided' | 'validation' | 'email',
    readonly current?: RefundRequestDocument | null,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------- rules

// Unicode letter runs of two or more, lowercased: "my colors" → {my, colors}.
export function distinctWords(text: string) {
  return new Set(text.toLowerCase().match(/\p{L}{2,}/gu) ?? [])
}

// What they wrote, tidied: no control characters, Windows line breaks
// made plain, no blank space around it.
export function cleanExplanation(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\P{C}\n\t]/gu, '')
    .trim()
}

// `brief`: the shorter minimum applies (Brazil's withdrawal, or a reader in
// Brazilian Portuguese, whose copy promises it).
export type RequestInput = { category: unknown; explanation: unknown; acknowledge: unknown; brief: boolean }

// The form's rules, the same as the web's (lib/refund-request.ts): a
// category, an explanation in their own words (80 characters and 8
// different words; 20 and 3 for a Brazilian withdrawal, whose right
// doesn't depend on the reason), and that they know what a refund removes.
export function validateRequestInput(input: RequestInput):
  | { ok: true; category: RefundReason; explanation: string }
  | { ok: false; message: string } {
  if (typeof input.category !== 'string' || !REFUND_CATEGORIES.includes(input.category as RefundReason)) {
    return { ok: false, message: 'Choose what happened.' }
  }

  const explanation = typeof input.explanation === 'string' ? cleanExplanation(input.explanation) : ''

  if (explanation.length > MAX_CHARS) {
    return { ok: false, message: 'Your explanation is too long: keep it under 2,000 characters.' }
  }

  const minChars = input.brief ? MIN_CHARS_WITHDRAWAL : MIN_CHARS
  const minWords = input.brief ? MIN_WORDS_WITHDRAWAL : MIN_WORDS
  const letters = new Set(explanation.toLowerCase().replace(/\s/g, ''))
  const junk = letters.size < 4 || !/\p{L}/u.test(explanation)

  if (junk || explanation.length < minChars || distinctWords(explanation).size < minWords) {
    return { ok: false, message: 'Tell us a bit more about what happened, in your own words.' }
  }

  if (input.acknowledge !== true && input.acknowledge !== 'true' && input.acknowledge !== 'on') {
    return { ok: false, message: 'Confirm that you understand what a refund removes.' }
  }

  return { ok: true, category: input.category as RefundReason, explanation }
}

export type BrazilSignals = {
  currency: string | null
  signupCountry: string | null
  cardCountry: string | null
  // The account's language and the page's: our pt-BR copy promises the right.
  locale: Locale | null | undefined
  pageLocale?: Locale | null
}

// Why a purchase counts as Brazilian: paid in reais, signed up there, a
// Brazilian card (the hard signals), or only the language: Avarobe used in
// Brazilian Portuguese, whose copy promises 7 days to withdraw.
export function brazilBasis(signals: BrazilSignals): BrazilBasis[] {
  const basis: BrazilBasis[] = []

  if (signals.currency?.toLowerCase() === 'brl') basis.push('currency')
  if (signals.signupCountry?.toUpperCase() === 'BR') basis.push('signup')
  if (signals.cardCountry?.toUpperCase() === 'BR') basis.push('card')
  if (signals.locale === 'pt-BR' || signals.pageLocale === 'pt-BR') basis.push('language')

  return basis
}

// Bought in Brazil, as far as we can tell (any basis, the language too).
export function brazilian(signals: BrazilSignals) {
  return brazilBasis(signals).length > 0
}

// A hard signal of Brazil, not only the language. A request stored before
// the basis was kept counts as hard.
export function hardBrazil(statutory: Pick<NonNullable<RefundRequestDocument['statutory']>, 'basis'> | null | undefined) {
  return Boolean(statutory) && (!statutory?.basis || statutory.basis.some((basis) => basis !== 'language'))
}

// Brazil's right of withdrawal applies: a Brazilian purchase, asked within
// its 7 days (`until`, brazilWithdrawalUntil). What counts is when they
// asked, not when it's decided. Kept with its basis, so the admin and the
// founder's email say when it's only the language (the request limit
// applies to those).
export function statutoryFor(signals: BrazilSignals, requestedAt: Date, until: Date): RefundRequestDocument['statutory'] {
  const basis = brazilBasis(signals)
  return basis.length > 0 && requestedAt.getTime() <= until.getTime() ? { law: 'br_cdc_49', until, basis } : null
}

export function isStatutory(signals: BrazilSignals, requestedAt: Date, until: Date) {
  return statutoryFor(signals, requestedAt, until) !== null
}

// Until when a refund of this purchase can be requested (null: it can't).
export function requestWindow(
  purchase: Parameters<typeof refundableUntil>[0],
  context: { firstProAt?: Date | null; brazil?: boolean },
  now = Date.now(),
) {
  return refundableUntil(purchase, context, now)
}

export const COLOR_PRODUCTS = new Set<PurchaseProduct>(['color_report', 'color_addon', 'reports_bundle', 'advisors_bundle', 'color_mirror'])
const ADVISOR_PRODUCTS = new Set<PurchaseProduct>([
  'color_report',
  'style_report',
  'reports_bundle',
  'color_addon',
  'style_addon',
  'color_mirror',
  'hair_advisor',
  'advisors_bundle',
])

// The core of what they bought was used: the report opened, the cuts tried,
// the event styled, the magazine made, the looks made, the PDF downloaded.
export function usedCore(product: PurchaseProduct, usage: RefundUsage) {
  const color = Boolean(usage.colorReportOpenedAt || usage.drapeAt)
  const style = Boolean(usage.styleReportOpenedAt)

  switch (product) {
    case 'color_report':
    case 'color_addon':
    case 'color_mirror':
      return color
    case 'style_report':
    case 'style_addon':
      return style
    case 'reports_bundle':
      return color || style
    case 'hair_advisor':
      return usage.hairstylesMade > 0
    case 'advisors_bundle':
      return color || style || usage.hairstylesMade > 0
    case 'event_pass':
      return usage.eventsStyled > 0
    case 'magazine':
      return usage.magazinesMade > 0
    case 'look_pack':
      return usage.looksWithCredit > 0
    case 'outfit_guide':
      return (usage.guideDownloads ?? 0) > 0
    default:
      // Pro: looks, events, checks or magazines made since paying.
      return usage.looksWithCredit > 0 || usage.eventsStyled > 0 || usage.checksMade > 0 || usage.magazinesMade > 0
  }
}

// At least half the looks it gave were used, or the PDF downloaded 3 times.
export function heavyUse(usage: RefundUsage) {
  return (usage.creditsGiven > 0 && usage.looksWithCredit * 2 >= usage.creditsGiven) || (usage.guideDownloads ?? 0) >= 3
}

export type FlagFacts = {
  product: PurchaseProduct
  purchasedAt: Date
  creditUsed: boolean
  disputed: boolean
  chargedDuringReview: boolean
  oldGuarantee: boolean
}

// The signals for the founder's review, in the order the admin shows them.
// They never reject anything on their own.
export function flagsFor(usage: RefundUsage, history: RefundRequestHistory, facts: FlagFacts): RefundRequestFlag[] {
  const flags: RefundRequestFlag[] = []

  if (facts.oldGuarantee) flags.push('old_guarantee')
  if (history.refundsBefore > 0) flags.push('repeat')
  if (history.requestsBefore > 0) flags.push('requested_before')
  if (facts.creditUsed) flags.push('credit_used')
  if (usedCore(facts.product, usage)) flags.push('used')
  if (heavyUse(usage)) flags.push('heavy_use')
  if (history.cardSeenOn > 0) flags.push('card_seen')
  if (history.openRequests >= 2) flags.push('many_open')
  if (history.accountCreatedAt && facts.purchasedAt.getTime() - history.accountCreatedAt.getTime() < HOUR_MS) flags.push('new_account')
  if (facts.chargedDuringReview) flags.push('charged_during_review')
  if (facts.disputed) flags.push('disputed')

  return flags
}

// Paid under the Terms before REFUND_TERMS_SINCE, whose 7-day guarantee
// covered the advisors, the Event Stylist and the magazine once per person,
// and a look pack or the first Pro payment with 5 looks or fewer used. Those purchases keep that promise: the admin says "approve".
export function oldGuarantee(
  purchase: { product: PurchaseProduct; paidAt: Date; firstPro: boolean },
  usage: Pick<RefundUsage, 'looksWithCredit'>,
  history: Pick<RefundRequestHistory, 'refundsBefore'>,
  termsSince: Date,
) {
  if (purchase.paidAt.getTime() >= termsSince.getTime()) {
    return false
  }

  if (ADVISOR_PRODUCTS.has(purchase.product) || purchase.product === 'event_pass' || purchase.product === 'magazine') {
    return history.refundsBefore === 0
  }

  if (purchase.product === 'look_pack' || (isPro(purchase.product) && purchase.firstPro)) {
    return usage.looksWithCredit <= 5
  }

  return false
}

const WEEKDAY = (timeZone: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone })

// When a request is due: `days` business days after it arrived, skipping
// Saturdays and Sundays where the founder is.
export function businessDueAt(createdAt: Date, days = REVIEW_BUSINESS_DAYS, timeZone = 'America/Santiago') {
  const weekday = WEEKDAY(timeZone)
  let due = createdAt.getTime()
  let counted = 0

  while (counted < days) {
    due += DAY_MS
    const day = weekday.format(new Date(due))

    if (day !== 'Sat' && day !== 'Sun') {
      counted += 1
    }
  }

  return new Date(due)
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

// "R-7F3K2Q": short enough to read out, for emails, support and the admin.
export function newRef() {
  const bytes = randomBytes(6)
  return `R-${[...bytes].map((byte) => CROCKFORD[byte % 32]).join('')}`
}

export function emailHash(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

// When a request should be decided by: 2 business days, 1 for a Brazilian
// withdrawal (the issuer is told at once, Decreto 7.962 art. 5 §3).
export function dueAt(request: Pick<RefundRequestDocument, 'createdAt' | 'statutory'>) {
  return businessDueAt(request.createdAt, request.statutory ? 1 : REVIEW_BUSINESS_DAYS)
}

// ---------------------------------------------------------------- reading

function coverOf(purchase: PurchaseDocument, guideOrderId: ObjectId | null = null): RefundCover {
  return {
    purchaseId: purchase._id,
    guideOrderId,
    product: purchase.product as PurchaseProduct,
    amount: purchase.amountTotal,
    currency: purchase.currency,
    paidAt: purchase.createdAt,
    stripePaymentIntentId: purchase.stripePaymentIntentId,
    stripeInvoiceId: purchase.stripeSessionId.startsWith('in_') ? purchase.stripeSessionId : null,
  }
}

function guideCover(order: GuideOrderDocument): RefundCover {
  return {
    purchaseId: null,
    guideOrderId: order._id,
    product: 'outfit_guide',
    amount: order.amount,
    currency: order.currency,
    paidAt: order.createdAt,
    stripePaymentIntentId: order.paymentIntentId ?? null,
    stripeInvoiceId: null,
  }
}

const hoursBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / HOUR_MS))

// How much of what they bought they used, since the earliest payment it
// covers: for the founder, and to flag it. Never a reason on its own.
export async function refundUsage(
  app: FastifyInstance,
  input: { userId: ObjectId | null; guideOrder: GuideOrderDocument | null; since: Date; covers: RefundCover[]; now?: Date },
): Promise<RefundUsage> {
  const now = input.now ?? new Date()
  const userId = input.userId
  const purchaseIds = input.covers.map((cover) => cover.purchaseId).filter((id): id is ObjectId => Boolean(id))
  const since = { $gte: input.since }
  const [user, avatar, looks, looksWithCredit, hairstyles, events, magazines, checks, purchases, lastEvent, recent] = await Promise.all([
    userId ? app.collections.users.findOne({ _id: userId }, { projection: { credits: 1, pro: 1 } }) : null,
    userId ? app.collections.avatars.findOne({ userId }, { projection: { colorReport: 1, styleProfile: 1, hairProfile: 1, drape: 1 } }) : null,
    userId ? app.collections.looks.countDocuments({ userId, createdAt: since }) : 0,
    userId ? app.collections.looks.countDocuments({ userId, createdAt: since, creditSpent: true }) : 0,
    userId ? app.collections.hairstyles.countDocuments({ userId, createdAt: since }) : 0,
    userId ? app.collections.styleEvents.countDocuments({ userId, createdAt: since }) : 0,
    userId ? app.collections.magazines.countDocuments({ userId, createdAt: since }) : 0,
    userId ? app.collections.colorChecks.countDocuments({ userId, createdAt: since }) : 0,
    purchaseIds.length ? app.collections.purchases.find({ _id: { $in: purchaseIds } }, { projection: { credits: 1, stripeSessionId: 1, product: 1 } }).toArray() : [],
    userId ? app.collections.analyticsEvents.findOne({ userId }, { sort: { at: -1 }, projection: { at: 1 } }) : null,
    userId
      ? app.collections.analyticsEvents.find({ userId, at: since }, { projection: { name: 1 } }).sort({ at: -1 }).limit(5000).toArray()
      : [],
  ])
  const bookSession = purchases.find((purchase) => purchase.product === 'outfit_guide')?.stripeSessionId
  const guideOrder = input.guideOrder ?? (bookSession ? await app.collections.guideOrders.findOne({ sessionId: bookSession }) : null)
  const counts: Record<string, number> = {}

  for (const event of recent) {
    counts[event.name] = (counts[event.name] ?? 0) + 1
  }

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
  const hair = avatar?.hairProfile?.status === 'ready' ? avatar.hairProfile.updatedAt : null

  return {
    at: now,
    hoursSincePurchase: hoursBetween(input.since, now),
    colorReportOpenedAt: avatar?.colorReport?.createdAt ?? null,
    styleReportOpenedAt: avatar?.styleProfile?.createdAt ?? null,
    hairReadAt: hair,
    drapeAt: avatar?.drape?.status === 'ready' ? avatar.drape.updatedAt : null,
    looksMade: looks,
    looksWithCredit,
    creditsGiven: purchases.reduce((sum, purchase) => sum + (purchase.credits ?? 0), 0),
    creditsLeft: user ? (user.credits ?? null) : null,
    hairstylesMade: hairstyles,
    eventsStyled: events,
    magazinesMade: magazines,
    checksMade: checks,
    avatarRuns: user?.pro?.avatarRuns ?? null,
    guideDownloads: guideOrder ? guideOrder.downloads : null,
    guideLastDownloadAt: guideOrder?.lastDownloadAt ?? null,
    lastSeenAt: lastEvent?.at ?? null,
    events: Object.fromEntries(top),
  }
}

// Who's asking, for the founder: earlier refunds and requests (by account
// or email), what they paid, how they came, and the same card on someone
// else's request.
export async function refundHistory(
  app: FastifyInstance,
  input: { userId: ObjectId | null; email: string | null; emailHash: string; fingerprint: string | null; excludeId?: ObjectId | null },
): Promise<RefundRequestHistory> {
  const userId = input.userId
  const others = { $or: [...(userId ? [{ userId }] : []), { emailHash: input.emailHash }], ...(input.excludeId ? { _id: { $ne: input.excludeId } } : {}) }
  const [user, purchases, guestOrders, requests, cardSeen] = await Promise.all([
    userId ? app.collections.users.findOne({ _id: userId }, { projection: { createdAt: 1, acquisition: 1 } }) : null,
    userId
      ? app.collections.purchases.find({ userId, amountTotal: { $gt: 0 } }, { projection: { amountTotal: 1, amountUsd: 1, currency: 1, refundedAt: 1, refund: 1 } }).toArray()
      : [],
    input.email
      ? app.collections.guideOrders.find({ email: input.email.toLowerCase(), userId: null, amount: { $gt: 0 } }, { projection: { amount: 1, currency: 1, refundedAt: 1, refund: 1 } }).toArray()
      : [],
    app.collections.refundRequests.find(others, { projection: { status: 1, covers: 1, decision: 1 } }).toArray(),
    input.fingerprint
      ? app.collections.refundRequests.find(
          { 'market.card.fingerprint': input.fingerprint, emailHash: { $ne: input.emailHash } },
          { projection: { emailHash: 1 } },
        ).toArray()
      : [],
  ])
  // Each refunded payment once, however it's known: their purchases, a
  // guest's book orders, and refunded requests (an account deleted since).
  // Not this request's own refund (an approval that stopped halfway marked
  // its purchases already).
  const ours = (refund: { requestId?: ObjectId | null } | null | undefined) => Boolean(input.excludeId && refund?.requestId?.equals(input.excludeId))
  const refunded = new Set<string>([
    ...purchases.filter((purchase) => purchase.refundedAt && !ours(purchase.refund)).map((purchase) => `p:${purchase._id.toString()}`),
    ...guestOrders.filter((order) => order.refundedAt && !ours(order.refund)).map((order) => `g:${order._id.toString()}`),
    ...requests
      .filter((request) => request.status === 'refunded')
      .flatMap((request) =>
        request.covers.map((cover) => (cover.purchaseId ? `p:${cover.purchaseId.toString()}` : `g:${cover.guideOrderId?.toString() ?? cover.paidAt.toISOString()}`)),
      ),
  ])

  return {
    refundsBefore: refunded.size,
    requestsBefore: requests.length,
    approvedBefore: requests.filter((request) => request.status === 'refunded').length,
    rejectedBefore: requests.filter((request) => request.status === 'rejected').length,
    openRequests: requests.filter((request) => (OPEN_STATUSES as readonly string[]).includes(request.status)).length,
    purchases: purchases.length + guestOrders.length,
    paidUsd:
      purchases.reduce((sum, purchase) => sum + (purchase.amountUsd ?? toUsdCents(purchase.amountTotal, purchase.currency)), 0) +
      guestOrders.reduce((sum, order) => sum + toUsdCents(order.amount, order.currency), 0),
    accountCreatedAt: user?.createdAt ?? null,
    channel: user?.acquisition?.channel ?? null,
    campaign: user?.acquisition?.campaign ?? null,
    cardSeenOn: new Set(cardSeen.map((request) => request.emailHash)).size,
  }
}

// Pro charges made after the request (renewal paused but charged anyway, a
// switch): refunded with it if approved, and flagged.
async function chargedDuringReview(app: FastifyInstance, request: RefundRequestDocument) {
  if (!request.userId || !request.covers.some((cover) => isPro(cover.product))) {
    return []
  }

  const covered = new Set(request.covers.map((cover) => cover.purchaseId?.toString()).filter(Boolean))
  // While it was open: a renewal after a rejection isn't one.
  const until = request.status === 'rejected' && request.decision ? { $lt: request.decision.at } : {}
  const later = await app.collections.purchases
    .find({ userId: request.userId, product: { $in: [...PRO_PRODUCTS] }, amountTotal: { $gt: 0 }, createdAt: { $gte: request.createdAt, ...until } })
    .sort({ createdAt: 1 })
    .toArray()

  return later.filter((purchase) => !covered.has(purchase._id.toString()) && hasRefundablePayment(purchase))
}

// ---------------------------------------------------------------- the plan

export type RefundPlanPayment = {
  purchaseId: string | null
  guideOrderId: string | null
  product: string
  amount: number
  currency: string
  paidAt: string
  via: 'payment' | 'invoice' | 'snapshot'
  // Refunded elsewhere (Stripe's dashboard, another approval): left out.
  alreadyRefunded: boolean
  // Refunded by this request's approval that stopped halfway: not refunded
  // again, but approving finishes it (takes back what it gave, closes it).
  refundedByRequest: boolean
  duringReview: boolean
}

export type RefundPlan = {
  total: number
  currency: string
  payments: RefundPlanPayment[]
  endsPro: boolean
  // In English, for the admin: "Color Advisor: report and access".
  removes: string[]
  warnings: string[]
  card: { brand: string | null; last4: string | null; country: string | null } | null
}

type Lang = 'en' | 'es'

const UNLOCK_LINES: Record<Lang, Record<'color' | 'style' | 'hair' | 'mirror', string>> = {
  en: {
    color: 'Color Advisor: report and access',
    style: 'Style Advisor: report and access',
    hair: 'Hair & Grooming Advisor: every cut and access',
    mirror: 'Color mirror',
  },
  es: {
    color: 'el Asesor de Color (reporte y acceso)',
    style: 'el Asesor de Estilo (reporte y acceso)',
    hair: 'el Asesor de Cabello y Barba (todos los cortes y acceso)',
    mirror: 'el espejo de color',
  },
}

// What approving takes away, said for the admin (English) or the founder's
// email (Spanish): the advisors it unlocked, the looks, passes and
// magazines (as far as they're left) and the book's link. Nothing when the
// account is gone.
export function describeRemoves(
  items: { product: string; credits: number }[],
  user: Pick<UserDocument, 'credits' | 'eventCredits' | 'magazineCredits'> | null,
  lang: Lang,
) {
  if (!user && !items.some((item) => item.product === 'outfit_guide')) {
    return []
  }

  const lines: string[] = []
  const unlocks = { color: false, style: false, hair: false, mirror: false }
  let credits = 0
  let events = 0
  let magazines = 0

  for (const item of items) {
    const config = PRODUCTS[item.product as PurchaseProduct]
    unlocks.color ||= Boolean(config?.unlocks?.color)
    unlocks.style ||= Boolean(config?.unlocks?.style)
    unlocks.hair ||= Boolean(config?.unlocks?.hair)
    unlocks.mirror ||= Boolean(config?.unlocks?.mirror)
    credits += item.credits
    events += config?.events ?? 0
    magazines += config?.magazines ?? 0
  }

  if (user) {
    for (const key of ['color', 'style', 'hair', 'mirror'] as const) {
      if (unlocks[key]) lines.push(UNLOCK_LINES[lang][key])
    }

    const left = (have: number | undefined) => have ?? 0

    if (credits > 0) {
      lines.push(lang === 'en' ? `Looks: up to ${credits} (has ${left(user.credits)} left)` : `hasta ${credits} looks (le quedan ${left(user.credits)})`)
    }

    if (events > 0) {
      lines.push(lang === 'en' ? `${events} event pass (has ${left(user.eventCredits)} left)` : `${events} pase de evento (le quedan ${left(user.eventCredits)})`)
    }

    if (magazines > 0) {
      lines.push(lang === 'en' ? `${magazines} magazine (has ${left(user.magazineCredits)} left)` : `${magazines} revista (le quedan ${left(user.magazineCredits)})`)
    }
  }

  if (items.some((item) => item.product === 'outfit_guide')) {
    lines.push(lang === 'en' ? 'Book download link' : 'el enlace de descarga del libro')
  }

  return lines
}

const adminMoney = (amount: number, currency: string) => formatMoney(amount, currency, 'en')
const adminDay = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })

// When Pro's paused subscription ends (its trial or its period) before the
// review is due, or ended during it: a rejection can't put it back then.
// Null when its renewal isn't paused by this request or isn't at risk.
export function proPauseEnd(
  request: Pick<RefundRequestDocument, 'proPause' | 'status' | 'createdAt' | 'statutory'>,
  pro: Pick<ProSubscription, 'subscriptionId' | 'status' | 'periodEnd' | 'trialEnd'> | null | undefined,
  now: Date,
): { at: Date; trial: boolean; ended: boolean; due: Date } | null {
  const pause = request.proPause

  if (!pause || pause.restoredAt || pause.wasCancelAtPeriodEnd || !pro || pro.subscriptionId !== pause.subscriptionId || !pro.periodEnd) {
    return null
  }

  if (request.status !== 'pending' && request.status !== 'failed' && request.status !== 'approved') {
    return null
  }

  const due = dueAt(request)
  const ended = pro.periodEnd.getTime() <= now.getTime()

  // A trial (still trialing, or ended at its trial's end).
  const trial = pro.status === 'trialing' || Boolean(pro.trialEnd && Math.abs(pro.trialEnd.getTime() - pro.periodEnd.getTime()) < 60_000)

  return ended || pro.periodEnd.getTime() < due.getTime() ? { at: pro.periodEnd, trial, ended, due } : null
}

function proPauseWarning(request: RefundRequestDocument, pro: ProSubscription | null, now: Date) {
  const end = proPauseEnd(request, pro, now)

  if (!end) {
    return null
  }

  const what = end.trial ? 'trial' : 'period'

  return end.ended
    ? `Pro’s ${what} ended ${adminDay(end.at)} during the review (its renewal was paused): rejecting won’t bring it back, and the customer is told so.`
    : `Pro’s ${what} ends ${adminDay(end.at)}, before this review is due (${adminDay(end.due)}): decide by then, or a rejection finds Pro ended (the customer is told so).`
}

// Exactly what approving does now: each payment (the request's, and any Pro
// charge made since), what's already refunded in Stripe, the total, what it
// takes away and what to look out for. The admin approves this total
// (expectedAmount), so nothing changes between reading it and approving.
export async function planFor(app: FastifyInstance, request: RefundRequestDocument, now = new Date()) {
  const later = await chargedDuringReview(app, request)
  const covers: (RefundCover & { duringReview: boolean })[] = [
    ...request.covers.map((cover) => ({ ...cover, duringReview: false })),
    ...later.map((purchase) => ({ ...coverOf(purchase), duringReview: true })),
  ]
  const purchaseIds = covers.map((cover) => cover.purchaseId).filter((id): id is ObjectId => Boolean(id))
  const orderIds = covers.map((cover) => cover.guideOrderId).filter((id): id is ObjectId => Boolean(id))
  const [purchases, orders, user] = await Promise.all([
    purchaseIds.length ? app.collections.purchases.find({ _id: { $in: purchaseIds } }).toArray() : [],
    orderIds.length ? app.collections.guideOrders.find({ _id: { $in: orderIds } }).toArray() : [],
    request.userId
      ? app.collections.users.findOne({ _id: request.userId }, { projection: { credits: 1, eventCredits: 1, magazineCredits: 1, pro: 1 } })
      : null,
  ])
  const purchaseById = new Map(purchases.map((purchase) => [purchase._id.toString(), purchase]))
  const orderById = new Map(orders.map((order) => [order._id.toString(), order]))
  const payments: RefundPlanPayment[] = []
  const toRefund: CoverToRefund[] = []
  const removable: { product: string; credits: number }[] = []
  const warnings: string[] = []

  let total = 0

  for (const cover of covers) {
    const purchase = cover.purchaseId ? purchaseById.get(cover.purchaseId.toString()) : undefined
    const order = cover.guideOrderId ? orderById.get(cover.guideOrderId.toString()) : undefined
    // Marked by this request's own approval that stopped halfway (a crash
    // between marking it and closing the request): finished, not skipped.
    const marked = purchase ?? order
    const earlier = marked ? earlierAttempt(marked, request._id) : null
    const alreadyRefunded = !earlier && Boolean(marked?.refundedAt)
    const via = purchase ? (purchase.stripePaymentIntentId ? 'payment' : 'invoice') : order ? 'payment' : 'snapshot'
    const label = `${shortProductName(cover.product, 'en')} ${adminMoney(cover.amount, cover.currency)}`

    payments.push({
      purchaseId: cover.purchaseId?.toString() ?? null,
      guideOrderId: cover.guideOrderId?.toString() ?? null,
      product: cover.product,
      amount: cover.amount,
      currency: cover.currency,
      paidAt: cover.paidAt.toISOString(),
      via,
      alreadyRefunded,
      refundedByRequest: earlier === 'refunded',
      duringReview: cover.duringReview,
    })

    if (alreadyRefunded) {
      warnings.push(`Already refunded in Stripe: ${label}`)
      continue
    }

    toRefund.push(cover)

    if (!purchase?.refund?.revokedAt) {
      removable.push({ product: cover.product, credits: purchase?.credits ?? 0 })
    }

    if (earlier === 'refunded') {
      warnings.push(`Refunded by this request on ${adminDay(marked?.refundedAt ?? now)}, but the approval stopped halfway: approving finishes it (no second refund).`)
    } else {
      total += cover.amount
    }

    if (earlier === 'unsent') {
      warnings.push(`An approval stopped before Stripe answered for ${label}: approving asks Stripe again (a refund that went through counts once).`)
    }

    if (cover.duringReview) {
      warnings.push(`Charged during review: ${label} on ${adminDay(cover.paidAt)}`)
    }
  }

  const proWarning = proPauseWarning(request, user?.pro ?? null, now)

  if (proWarning) {
    warnings.push(proWarning)
  }

  const accountGone = Boolean(request.userId) && !user

  if (accountGone) {
    warnings.push('Account deleted: money back only')
  }

  if (request.market.disputed) {
    warnings.push('Disputed charge: a refund may pay back twice')
  }

  if (request.flags.includes('credit_used')) {
    warnings.push(`Credit used: Pro annual stays discounted by ${adminMoney(request.amount, request.currency)}`)
  }

  if (request.refund?.partial) {
    warnings.push('Partly refunded before: the rest is in Stripe')
  }

  const plan: RefundPlan = {
    total,
    currency: request.currency,
    payments,
    endsPro: toRefund.some((cover) => isPro(cover.product)),
    removes: describeRemoves(removable, user, 'en'),
    warnings,
    card: request.market.card ? { brand: request.market.card.brand, last4: request.market.card.last4, country: request.market.card.country } : null,
  }

  return { plan, covers: toRefund, chargedDuringReview: later.length > 0, accountGone, user, removable, now }
}

export async function planRefund(app: FastifyInstance, request: RefundRequestDocument, now = new Date()) {
  return (await planFor(app, request, now)).plan
}

// ---------------------------------------------------------------- views

export type CustomerRequestView = {
  id: string
  ref: string
  purchaseId: string | null
  product: string
  name: string
  amount: number
  currency: string
  status: 'pending' | 'approved' | 'refunded' | 'rejected'
  createdAt: string
  decidedAt: string | null
  category: RefundReason
  rejection: { code: RefundRejectCode; text: string; note: string | null } | null
  statutory: boolean
}

// What the customer sees of a request: a failed refund is still "under
// review" to them; the rejection's reason in their language.
export function customerView(request: RefundRequestDocument, locale: Locale): CustomerRequestView {
  const rejected = request.status === 'rejected' && request.decision
  const code = rejected ? (request.decision?.code ?? 'other') : null

  return {
    id: request._id.toString(),
    ref: request.ref,
    purchaseId: request.purchaseId?.toString() ?? null,
    product: request.product,
    name: productCopy(request.product, locale).name,
    amount: request.amount,
    currency: request.currency,
    status: request.status === 'failed' ? 'pending' : request.status,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.status === 'refunded' || request.status === 'rejected' ? (request.decision?.at.toISOString() ?? null) : null,
    category: request.reasonCategory,
    rejection: code ? { code, text: rejectionText(code, locale), note: request.decision?.note ?? null } : null,
    statutory: Boolean(request.statutory),
  }
}

// The rejection's reason as the customer reads it ('other': only the note).
export function rejectionText(code: RefundRejectCode, locale: Locale) {
  return code === 'other' ? '' : emailRefundCopy(locale).codes[code]
}

// The card's country of the purchases a refund can still be requested for
// and that nothing else marks as Brazilian (reais, signed up in Brazil),
// asked of Stripe once each (quick, in parallel, best effort) and kept on
// the purchase: a Brazilian card opens Brazil's withdrawal on the account
// page as it does in the request (finding the same card).
async function lookUpCardCountries(
  app: FastifyInstance,
  purchases: PurchaseDocument[],
  context: { signupCountry: string | null; firstPro: Date | null; requested: Set<string> },
  deps: Pick<RequestDeps, 'paymentFacts'>,
  now: number,
) {
  if (context.signupCountry?.toUpperCase() === 'BR') {
    return
  }

  const pending = purchases
    .filter(
      (purchase) =>
        purchase.cardCountry === undefined &&
        purchase.currency.toLowerCase() !== 'brl' &&
        !context.requested.has(purchase._id.toString()) &&
        requestWindow(purchase, { firstProAt: context.firstPro, brazil: true }, now),
    )
    .slice(0, 5)

  await Promise.all(
    pending.map(async (purchase) => {
      const cover = coverOf(purchase)

      try {
        const facts = await deps.paymentFacts({ paymentIntentId: cover.stripePaymentIntentId, invoiceId: cover.stripeInvoiceId })
        const country = facts?.country ? facts.country.toUpperCase() : null

        purchase.cardCountry = country
        await rememberCardCountry(app, 'purchase', purchase._id, country)
      } catch (error) {
        app.log.warn({ err: errorMessage(error), purchaseId: purchase._id.toString() }, 'Purchases: no card country from Stripe')
      }
    }),
  )
}

// A book order's card country, as lookUpCardCountries does for purchases:
// asked of Stripe once while its refund can be requested and nothing else
// marks it as Brazilian, and kept on the order.
export async function orderCardCountry(
  app: FastifyInstance,
  order: GuideOrderDocument,
  context: { signupCountry: string | null; requested: boolean },
  deps: Pick<RequestDeps, 'paymentFacts'> = STRIPE_REQUESTS,
  now = Date.now(),
) {
  if (order.cardCountry !== undefined) {
    return order.cardCountry
  }

  const skip =
    context.requested ||
    !order.paymentIntentId ||
    order.currency.toLowerCase() === 'brl' ||
    context.signupCountry?.toUpperCase() === 'BR' ||
    !guideRefundableUntil(order, now, true) ||
    (deps === STRIPE_REQUESTS && !stripeConfigured())

  if (skip) {
    return null
  }

  try {
    const facts = await deps.paymentFacts({ paymentIntentId: order.paymentIntentId })
    const country = facts?.country ? facts.country.toUpperCase() : null

    await rememberCardCountry(app, 'order', order._id, country)
    return country
  } catch (error) {
    app.log.warn({ err: errorMessage(error), guideOrderId: order._id.toString() }, 'Book order: no card country from Stripe')
    return null
  }
}

// The account page's purchases, newest first: whether a refund can still be
// requested (`refundableUntil`, null once requested, refunded or past it,
// so an older web never offers a one-tap refund), the request if there is
// one, and Brazil's withdrawal while it lasts (the card's country looked up
// once, so the page asks what the request will: lookUpCardCountries).
export async function purchasesFor(
  app: FastifyInstance,
  userId: ObjectId,
  now = Date.now(),
  deps: Pick<RequestDeps, 'paymentFacts'> = STRIPE_REQUESTS,
) {
  const [purchases, firstPro, user, requests] = await Promise.all([
    app.collections.purchases.find({ userId, amountTotal: { $gt: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
    firstProAt(app, userId),
    app.collections.users.findOne({ _id: userId }, { projection: { location: 1, locale: 1 } }),
    app.collections.refundRequests.find({ userId }).sort({ createdAt: -1 }).limit(100).toArray(),
  ])
  // Named in the language of the page asking.
  const locale = currentLocale() ?? user?.locale ?? 'en'
  const byPurchase = new Map<string, RefundRequestDocument>()

  for (const request of requests) {
    for (const id of [request.purchaseId, ...request.covers.map((cover) => cover.purchaseId)]) {
      if (id && !byPurchase.has(id.toString())) {
        byPurchase.set(id.toString(), request)
      }
    }
  }

  const signupCountry = user?.location?.country ?? null

  // Without Stripe's keys (local development) there's no one to ask.
  if (deps !== STRIPE_REQUESTS || stripeConfigured()) {
    await lookUpCardCountries(app, purchases, { signupCountry, firstPro, requested: new Set(byPurchase.keys()) }, deps, now)
  }

  const brazil = (purchase: PurchaseDocument) =>
    brazilian({ currency: purchase.currency, signupCountry, cardCountry: purchase.cardCountry ?? null, locale: user?.locale, pageLocale: currentLocale() })
  const weekEnd = firstPro ? firstPro.getTime() + 7 * DAY_MS : 0
  // Pro's first week is requested as a whole: each of its payments says the
  // whole amount.
  const proWeek = purchases
    .filter((purchase) => isPro(purchase.product) && !purchase.refundedAt && purchase.createdAt.getTime() < weekEnd)
    .reduce((sum, purchase) => sum + purchase.amountTotal, 0)

  return purchases.map((purchase) => {
    const request = byPurchase.get(purchase._id.toString()) ?? null
    const br = brazil(purchase)
    const until = request ? null : requestWindow(purchase, { firstProAt: firstPro, brazil: br }, now)
    const withdrawal = br && !purchase.refundedAt ? requestWindow(purchase, { firstProAt: firstPro, brazil: true }, now) : null
    const proFirst = isPro(purchase.product) && purchase.createdAt.getTime() < weekEnd

    return {
      id: purchase._id.toString(),
      product: purchase.product,
      name: purchase.product in PRODUCTS ? productCopy(purchase.product as PurchaseProduct, locale).name : purchase.product,
      amount: purchase.amountTotal,
      currency: purchase.currency,
      createdAt: purchase.createdAt.toISOString(),
      refundedAt: purchase.refundedAt?.toISOString() ?? null,
      refundableUntil: until?.toISOString() ?? null,
      // What a refund of it gives back.
      refundAmount: proFirst && proWeek > 0 ? proWeek : purchase.amountTotal,
      refundRequest: request ? customerView(request, locale) : null,
      withdrawal: withdrawal ? { law: 'br_cdc_49' as const, until: brazilWithdrawalUntil(purchase.createdAt).toISOString() } : null,
    }
  })
}

// Their requests, newest first (the account page).
export async function customerRequests(app: FastifyInstance, userId: ObjectId, locale: Locale) {
  const requests = await app.collections.refundRequests.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray()
  return requests.map((request) => customerView(request, locale))
}

// A book order's request (from its email's link or the account page).
export async function guideOrderRequest(app: FastifyInstance, orderId: ObjectId) {
  return app.collections.refundRequests.findOne(
    { $or: [{ guideOrderId: orderId }, { 'covers.guideOrderId': orderId }] },
    { sort: { createdAt: -1 } },
  )
}

// ---------------------------------------------------------------- asking

// The market a payment was made in: its currency's, or (dollars) where they
// signed up or are.
function regionOf(currency: string, country: string | null) {
  const byCurrency: Record<string, string> = { brl: 'br', mxn: 'mx', cop: 'co' }
  return byCurrency[currency.toLowerCase()] ?? regionForCountry(country)
}

// What creating a request goes through, so tests can stand in for Stripe.
export type RequestDeps = {
  paymentFacts: (source: { paymentIntentId?: string | null; invoiceId?: string | null }) => Promise<PaymentFacts | null>
  setProCancellation: (app: FastifyInstance, subscriptionId: string, cancel: boolean) => Promise<unknown>
  now?: () => Date
}

export const STRIPE_REQUESTS: RequestDeps = { paymentFacts, setProCancellation }

const blocked = (app: FastifyInstance, userId: ObjectId | null, reason: string, product: string) =>
  void trackServerEvent(app, { name: 'refund_request_blocked', userId, props: { reason, product } })

const WRITE_TO_US = {
  purchaseWindow: 'This purchase is past the 7 days to request a refund. Write to us at hello@avarobe.com.',
  orderWindow: 'This order is past the 7 days to request a refund. Write to us at hello@avarobe.com.',
  decided: 'We already answered a refund request for this purchase. Write to us at hello@avarobe.com.',
  limit: 'You’ve sent several refund requests recently. Write to us at hello@avarobe.com.',
  noEmail: 'Your account has no email for us to answer you at. Write to us at hello@avarobe.com.',
  orderNoEmail: 'This order has no email to answer to. Write to us at hello@avarobe.com.',
}

// The card's country, kept on the purchase or book order once Stripe gave
// it (null: Stripe has none), so the account page knows a Brazilian card
// without asking Stripe again.
async function rememberCardCountry(app: FastifyInstance, kind: 'purchase' | 'order', id: ObjectId, country: string | null) {
  const set = { $set: { cardCountry: country ? country.toUpperCase() : null } }

  try {
    if (kind === 'purchase') {
      await app.collections.purchases.updateOne({ _id: id }, set)
    } else {
      await app.collections.guideOrders.updateOne({ _id: id }, set)
    }
  } catch (error) {
    app.log.warn({ err: errorMessage(error) }, 'Refund request: card country not kept')
  }
}

async function factsOf(cover: RefundCover, deps: RequestDeps, app: FastifyInstance) {
  try {
    return await deps.paymentFacts({ paymentIntentId: cover.stripePaymentIntentId, invoiceId: cover.stripeInvoiceId })
  } catch (error) {
    app.log.warn({ err: errorMessage(error) }, 'Refund request: no card details from Stripe')
    return null
  }
}

async function screenshotOf(input: Buffer | null | undefined) {
  if (!input || input.length === 0) {
    return null
  }

  if (input.length > SCREENSHOT_MAX_BYTES) {
    throw new RefundRequestError(400, 'The screenshot must be an image under 8 MB.', 'validation')
  }

  try {
    return await normalizeScreenshot(input)
  } catch (error) {
    if (error instanceof InvalidImageError) {
      throw new RefundRequestError(400, 'The screenshot must be an image under 8 MB.', 'validation')
    }

    throw error
  }
}

// Everything a new request is made of, before what's computed from it.
type Draft = {
  source: RefundRequestDocument['source']
  userId: ObjectId | null
  guideOrder: GuideOrderDocument | null
  purchaseId: ObjectId | null
  product: PurchaseProduct
  covers: RefundCover[]
  email: string | null
  firstName: string
  locale: Locale
  targetKey: string
  market: RefundRequestDocument['market']
  statutory: RefundRequestDocument['statutory']
  firstPro: boolean
  creditUsed: boolean
  category: RefundReason
  explanation: string
  screenshot: Buffer | null
  user: Pick<UserDocument, 'email' | 'pro'> | null
}

// The open request for this target, if there is one; refuses a target whose
// request was already decided (409: write to hello@).
async function existingRequest(app: FastifyInstance, targetKey: string, userId: ObjectId | null, product: string) {
  const open = await app.collections.refundRequests.findOne({ openKey: targetKey })

  if (open) {
    return open
  }

  const decided = await app.collections.refundRequests.findOne({ targetKey, status: { $in: ['refunded', 'rejected'] } }, { projection: { _id: 1 } })

  if (decided) {
    blocked(app, userId, 'decided', product)
    throw new RefundRequestError(409, WRITE_TO_US.decided, 'decided')
  }

  return null
}

// At most a few new requests a month per person (account or email), except
// a Brazilian withdrawal on a hard signal (reais, signed up there, a
// Brazilian card), which the law gives them regardless. Only the page's
// language isn't enough to skip it.
async function overLimit(app: FastifyInstance, draft: Pick<Draft, 'userId' | 'email' | 'statutory'>, now: Date) {
  if (hardBrazil(draft.statutory)) {
    return false
  }

  const since = new Date(now.getTime() - 30 * DAY_MS)
  const who = [...(draft.userId ? [{ userId: draft.userId }] : []), ...(draft.email ? [{ emailHash: emailHash(draft.email) }] : [])]

  if (who.length === 0) {
    return false
  }

  const recent = await app.collections.refundRequests.countDocuments({ $or: who, createdAt: { $gte: since } })
  return recent >= MAX_REQUESTS_30D
}

// A new request, stored: usage, history and flags computed, one open request
// per target (a double tap or two tabs get the same one), the screenshot
// kept, Pro's renewal paused, the founder and the customer emailed.
async function recordRequest(app: FastifyInstance, draft: Draft, deps: RequestDeps, now: Date) {
  const since = draft.covers.reduce((earliest, cover) => (cover.paidAt < earliest ? cover.paidAt : earliest), draft.covers[0]!.paidAt)
  const hash = emailHash(draft.email ?? `account:${draft.userId?.toString() ?? 'unknown'}`)
  const [usage, history] = await Promise.all([
    refundUsage(app, { userId: draft.userId, guideOrder: draft.guideOrder, since, covers: draft.covers, now }),
    refundHistory(app, { userId: draft.userId, email: draft.email, emailHash: hash, fingerprint: draft.market.card?.fingerprint ?? null }),
  ])
  const old = oldGuarantee({ product: draft.product, paidAt: since, firstPro: draft.firstPro }, usage, history, env.REFUND_TERMS_SINCE)
  const flags = flagsFor(usage, history, {
    product: draft.product,
    purchasedAt: since,
    creditUsed: draft.creditUsed,
    disputed: draft.market.disputed,
    chargedDuringReview: false,
    oldGuarantee: old,
  })
  const amount = draft.covers.reduce((sum, cover) => sum + cover.amount, 0)
  const currency = draft.covers[0]!.currency
  const base: Omit<RefundRequestDocument, '_id' | 'ref'> = {
    source: draft.source,
    userId: draft.userId,
    guideOrderId: draft.guideOrder?._id ?? null,
    purchaseId: draft.purchaseId,
    product: draft.product,
    covers: draft.covers,
    amount,
    currency,
    amountUsd: toUsdCents(amount, currency),
    purchasedAt: since,
    email: draft.email,
    emailHash: hash,
    firstName: draft.firstName,
    locale: draft.locale,
    targetKey: draft.targetKey,
    openKey: draft.targetKey,
    market: draft.market,
    within7d: true,
    statutory: draft.statutory,
    oldGuarantee: old,
    reasonCategory: draft.category,
    explanation: draft.explanation,
    attachment: null,
    usage,
    history,
    flags,
    proPause: null,
    status: 'pending',
    decision: null,
    attempts: [],
    refund: null,
    internalNote: null,
    emails: { founderAt: null, receivedAt: null, decisionAt: null, reminderAt: null },
    createdAt: now,
    updatedAt: now,
  }
  let request: RefundRequestDocument | null = null

  for (let attempt = 0; attempt < 5 && !request; attempt += 1) {
    const candidate: RefundRequestDocument = { _id: new ObjectId(), ref: newRef(), ...base }

    try {
      await app.collections.refundRequests.insertOne(candidate)
      request = candidate
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error
      }

      // Asked twice at once: the other one's request.
      const open = await app.collections.refundRequests.findOne({ openKey: draft.targetKey })

      if (open) {
        return { request: open, created: false, notified: Promise.resolve() }
      }
    }
  }

  if (!request) {
    throw new Error('Could not store the refund request.')
  }

  const notes: string[] = []

  if (draft.screenshot && draft.userId) {
    const key = `users/${draft.userId.toString()}/refund-${request._id.toString()}.jpg`

    try {
      await storage.put(key, draft.screenshot, 'image/jpeg')
      request.attachment = { key, bytes: draft.screenshot.length }
      await app.collections.refundRequests.updateOne({ _id: request._id }, { $set: { attachment: request.attachment } })
    } catch (error) {
      app.log.error({ err: errorMessage(error), requestId: request._id.toString() }, 'Refund request: the screenshot was not stored')
      notes.push('The screenshot they sent could not be stored.')
    }
  }

  const pause = await pausePro(app, request, draft.user, deps, now)

  if (pause.pause) {
    request.proPause = pause.pause
  }

  if (pause.note) {
    notes.push(pause.note)
  }

  if (pause.pause || notes.length) {
    request.internalNote = notes.length ? notes.join(' ') : null
    await app.collections.refundRequests.updateOne({ _id: request._id }, { $set: { proPause: request.proPause, internalNote: request.internalNote } })
  }

  const stored = request
  // Not awaited by the routes: the customer gets their answer at once.
  const notified = notifyReceived(app, stored).catch((error: unknown) => {
    app.log.error({ err: errorMessage(error), requestId: stored._id.toString() }, 'Refund request emails failed')
  })

  void trackServerEvent(app, {
    name: 'refund_requested',
    userId: stored.userId,
    props: {
      product: stored.product,
      category: stored.reasonCategory,
      amount: stored.amount,
      currency: stored.currency,
      hours: usage.hoursSincePurchase,
      statutory: Boolean(stored.statutory),
      oldGuarantee: stored.oldGuarantee,
      source: stored.source,
      chars: stored.explanation.length,
      attachment: Boolean(stored.attachment),
      ...(flags.length ? { flags: flags.join(',') } : {}),
    },
  })

  return { request: stored, created: true, notified }
}

// Pro under review doesn't renew: a trial doesn't turn into a monthly charge
// and a month doesn't renew while the founder decides. What it was set to
// before is kept, so a rejection puts it back. Best effort: a failure is
// noted for the founder (a charge during review is refunded with it).
async function pausePro(
  app: FastifyInstance,
  request: RefundRequestDocument,
  user: Pick<UserDocument, 'pro'> | null,
  deps: RequestDeps,
  now: Date,
): Promise<{ pause: RefundRequestDocument['proPause']; note: string | null }> {
  const pro = user?.pro

  if (!request.covers.some((cover) => isPro(cover.product)) || !pro?.subscriptionId || pro.subscriptionId === 'sim_admin' || !proIsLive(pro, now.getTime())) {
    return { pause: null, note: null }
  }

  const pause = { subscriptionId: pro.subscriptionId, wasCancelAtPeriodEnd: Boolean(pro.cancelAtPeriodEnd), at: now, restoredAt: null }

  if (pause.wasCancelAtPeriodEnd) {
    return { pause, note: null }
  }

  try {
    await deps.setProCancellation(app, pro.subscriptionId, true)
    return { pause, note: null }
  } catch (error) {
    app.log.error({ err: errorMessage(error), requestId: request._id.toString() }, 'Refund request: Pro renewal not paused')
    return { pause: null, note: 'Pro’s renewal could not be paused: it may renew during the review (refunded with it if approved).' }
  }
}

// A refund request from the account page: the purchase (Pro: its first
// week), checked, stored and emailed. Returns the open request already
// there when they ask again.
export async function createRefundRequest(
  app: FastifyInstance,
  input: {
    userId: ObjectId
    purchaseId: ObjectId
    category: unknown
    explanation: unknown
    acknowledge: unknown
    screenshot?: Buffer | null
    locale: Locale
    requestCountry: string | null
  },
  deps: RequestDeps = STRIPE_REQUESTS,
) {
  const now = deps.now?.() ?? new Date()
  const [purchase, firstPro, user] = await Promise.all([
    app.collections.purchases.findOne({ _id: input.purchaseId, userId: input.userId }),
    firstProAt(app, input.userId),
    app.collections.users.findOne({ _id: input.userId }),
  ])

  if (!purchase || !user) {
    throw new RefundRequestError(404, 'We could not find this purchase.')
  }

  if (purchase.refundedAt) {
    throw new RefundRequestError(409, 'This purchase was already refunded.')
  }

  const product = purchase.product as PurchaseProduct
  const pro = isPro(product)
  const targetKey = pro ? `pro:${input.userId.toString()}` : `p:${purchase._id.toString()}`
  const existing = await existingRequest(app, targetKey, input.userId, product)

  if (existing) {
    return { request: existing, created: false, notified: Promise.resolve() }
  }

  // Brazil's window counts calendar days: it's open at least as long.
  const atNow = now.getTime()
  const generic = requestWindow(purchase, { firstProAt: firstPro }, atNow)
  const withBrazil = requestWindow(purchase, { firstProAt: firstPro, brazil: true }, atNow)

  if (!withBrazil) {
    blocked(app, input.userId, 'window', product)
    throw new RefundRequestError(409, WRITE_TO_US.purchaseWindow, 'window')
  }

  const week = pro && firstPro ? await proFirstWeek(app, input.userId, firstPro) : []
  const guideOrder = product === 'outfit_guide' ? await app.collections.guideOrders.findOne({ sessionId: purchase.stripeSessionId }) : null
  const covers = pro ? (week.length ? week : [purchase]).map((payment) => coverOf(payment)) : [coverOf(purchase, guideOrder?._id ?? null)]
  const facts = await factsOf(covers[0]!, deps, app)
  const signals: BrazilSignals = {
    currency: purchase.currency,
    signupCountry: user.location?.country ?? null,
    cardCountry: facts?.country ?? null,
    locale: user.locale,
    pageLocale: input.locale,
  }

  if (!brazilian(signals) && !generic) {
    blocked(app, input.userId, 'window', product)
    throw new RefundRequestError(409, WRITE_TO_US.purchaseWindow, 'window')
  }

  if (facts && covers[0]?.purchaseId?.equals(purchase._id) && purchase.cardCountry === undefined) {
    await rememberCardCountry(app, 'purchase', purchase._id, facts.country)
  }

  // An account still on a guest's placeholder (its claim failed): no email
  // to tell them we got it, or what we decided.
  if (isGuestEmail(user.email)) {
    blocked(app, input.userId, 'email', product)
    throw new RefundRequestError(409, WRITE_TO_US.noEmail, 'email')
  }

  const until = brazilWithdrawalUntil(purchase.createdAt)
  const statutory = statutoryFor(signals, now, until)
  const valid = validateRequestInput({ category: input.category, explanation: input.explanation, acknowledge: input.acknowledge, brief: Boolean(statutory) })

  if (!valid.ok) {
    blocked(app, input.userId, 'validation', product)
    throw new RefundRequestError(400, valid.message, 'validation')
  }

  const email = user.email

  if (await overLimit(app, { userId: input.userId, email, statutory }, now)) {
    blocked(app, input.userId, 'limit', product)
    throw new RefundRequestError(429, WRITE_TO_US.limit, 'limit')
  }

  const screenshot = await screenshotOf(input.screenshot)
  const signupCountry = user.location?.country ?? null

  return recordRequest(
    app,
    {
      source: 'account',
      userId: input.userId,
      guideOrder,
      purchaseId: purchase._id,
      product,
      covers,
      email,
      firstName: user.firstName ?? '',
      locale: user.locale ?? input.locale,
      targetKey,
      market: {
        currency: purchase.currency,
        region: regionOf(purchase.currency, signupCountry ?? input.requestCountry),
        signupCountry,
        requestCountry: input.requestCountry,
        card: facts ? { brand: facts.brand, last4: facts.last4, country: facts.country, fingerprint: facts.fingerprint } : null,
        disputed: Boolean(facts?.disputed),
      },
      statutory,
      firstPro: pro && covers.some((cover) => cover.paidAt.getTime() === firstPro?.getTime()),
      creditUsed: await creditUsed(app, purchase),
      category: valid.category,
      explanation: valid.explanation,
      screenshot,
      user,
    },
    deps,
    now,
  )
}

// A refund request for the Outfit Formula Book from the link in its email
// (no account needed). An order bought signed in asks for its purchase, so
// the account page and the link share one request. No screenshot here.
export async function createGuideRefundRequest(
  app: FastifyInstance,
  input: { token: string; category: unknown; explanation: unknown; acknowledge: unknown; locale: Locale; requestCountry: string | null },
  deps: RequestDeps = STRIPE_REQUESTS,
) {
  const now = deps.now?.() ?? new Date()
  const order = await app.collections.guideOrders.findOne({ refundToken: input.token })

  if (!order) {
    throw new RefundRequestError(404, 'We could not find this order.')
  }

  if (order.refundedAt) {
    throw new RefundRequestError(409, 'This order was already refunded.')
  }

  const [purchase, account] = await Promise.all([
    order.userId ? app.collections.purchases.findOne({ userId: order.userId, stripeSessionId: order.sessionId }) : null,
    order.userId ? app.collections.users.findOne({ _id: order.userId }) : null,
  ])

  if (purchase?.refundedAt) {
    throw new RefundRequestError(409, 'This order was already refunded.')
  }

  const targetKey = purchase ? `p:${purchase._id.toString()}` : `g:${order._id.toString()}`
  const existing = await existingRequest(app, targetKey, order.userId, 'outfit_guide')

  if (existing) {
    return { request: existing, created: false, notified: Promise.resolve() }
  }

  const atNow = now.getTime()

  if (!guideRefundableUntil(order, atNow, true)) {
    blocked(app, order.userId, 'window', 'outfit_guide')
    throw new RefundRequestError(409, WRITE_TO_US.orderWindow, 'window')
  }

  const email = order.email ?? (account && !isGuestEmail(account.email) ? account.email : null)

  if (!email) {
    throw new RefundRequestError(409, WRITE_TO_US.orderNoEmail, 'email')
  }

  const cover = purchase ? coverOf(purchase, order._id) : guideCover(order)
  const facts = await factsOf(cover, deps, app)
  const signupCountry = account?.location?.country ?? null
  const signals: BrazilSignals = {
    currency: order.currency,
    signupCountry,
    cardCountry: facts?.country ?? null,
    locale: account?.locale,
    pageLocale: input.locale,
  }

  if (!brazilian(signals) && !guideRefundableUntil(order, atNow)) {
    blocked(app, order.userId, 'window', 'outfit_guide')
    throw new RefundRequestError(409, WRITE_TO_US.orderWindow, 'window')
  }

  if (facts && order.cardCountry === undefined) {
    await rememberCardCountry(app, 'order', order._id, facts.country)
  }

  const until = brazilWithdrawalUntil(order.createdAt)
  const statutory = statutoryFor(signals, now, until)
  const valid = validateRequestInput({ category: input.category, explanation: input.explanation, acknowledge: input.acknowledge, brief: Boolean(statutory) })

  if (!valid.ok) {
    blocked(app, order.userId, 'validation', 'outfit_guide')
    throw new RefundRequestError(400, valid.message, 'validation')
  }

  if (await overLimit(app, { userId: order.userId, email, statutory }, now)) {
    blocked(app, order.userId, 'limit', 'outfit_guide')
    throw new RefundRequestError(429, WRITE_TO_US.limit, 'limit')
  }

  return recordRequest(
    app,
    {
      source: 'guide_link',
      userId: account ? account._id : null,
      guideOrder: order,
      purchaseId: purchase?._id ?? null,
      product: 'outfit_guide',
      covers: [cover],
      email,
      firstName: account?.firstName ?? '',
      // The page's language: orders keep none, and the answer is read there.
      locale: input.locale,
      targetKey,
      market: {
        currency: order.currency,
        region: regionOf(order.currency, signupCountry ?? input.requestCountry),
        signupCountry,
        requestCountry: input.requestCountry,
        card: facts ? { brand: facts.brand, last4: facts.last4, country: facts.country, fingerprint: facts.fingerprint } : null,
        disputed: Boolean(facts?.disputed),
      },
      statutory,
      firstPro: false,
      creditUsed: false,
      category: valid.category,
      explanation: valid.explanation,
      screenshot: null,
      user: account,
    },
    deps,
    now,
  )
}

// ---------------------------------------------------------------- emails

// An email claimed on the request (emails.<kind>At, from null to now), sent,
// and unclaimed if it fails, so the lifecycle tick tries it again.
async function claimed(app: FastifyInstance, request: RefundRequestDocument, kind: keyof RefundRequestDocument['emails'], send: () => Promise<unknown>) {
  const field = `emails.${kind}`
  const claim = await app.collections.refundRequests.updateOne({ _id: request._id, [field]: null }, { $set: { [field]: new Date() } })

  if (claim.modifiedCount === 0) {
    return false
  }

  try {
    await send()
    return true
  } catch (error) {
    app.log.error({ err: errorMessage(error), requestId: request._id.toString(), email: kind }, 'Refund request email not sent')
    await app.collections.refundRequests.updateOne({ _id: request._id }, { $set: { [field]: null } })
    return false
  }
}

const replyToRefunds = () => (env.REFUNDS_EMAIL[0] ? { email: env.REFUNDS_EMAIL[0], name: 'Avarobe' } : undefined)

// The founder's copy of a new request (Spanish, Chile's time), to each
// REFUNDS_EMAIL, with reply-to the customer.
async function sendFounderEmail(app: FastifyInstance, request: RefundRequestDocument) {
  return claimed(app, request, 'founderAt', async () => {
    const { plan, user, removable, now } = await planFor(app, request)
    const account = request.userId
      ? await app.collections.users.findOne({ _id: request.userId }, { projection: { email: 1, createdAt: 1, location: 1, locale: 1, acquisition: 1 } })
      : null
    const content = founderEmail({
      request,
      account,
      plan,
      removesEs: describeRemoves(removable, user, 'es'),
      proEnd: proPauseEnd(request, user?.pro, now),
      test: stripeTestMode() || (request.email ? isAdmin({ email: request.email }) : false) || (account ? isAdmin(account) : false),
    })

    for (const to of env.REFUNDS_EMAIL) {
      await sendClaimedEmail(app.log, { to, content, replyTo: request.email ? { email: request.email, name: request.firstName || undefined } : undefined })
    }
  })
}

async function sendReceivedEmail(app: FastifyInstance, request: RefundRequestDocument) {
  if (!request.email) {
    return false
  }

  const email = request.email

  return claimed(app, request, 'receivedAt', () => sendClaimedEmail(app.log, { to: email, content: receivedEmailFor(request), replyTo: replyToRefunds() }))
}

async function sendDecisionEmail(app: FastifyInstance, request: RefundRequestDocument) {
  if (!request.email || (request.status !== 'refunded' && request.status !== 'rejected')) {
    return false
  }

  const email = request.email
  const proRenewsAt =
    request.status === 'rejected' && request.proPause?.restoredAt && request.userId
      ? ((await app.collections.users.findOne({ _id: request.userId }, { projection: { pro: 1 } }))?.pro?.periodEnd ?? null)
      : null
  const proEndedAt = request.status === 'rejected' ? (request.proPause?.endedAt ?? null) : null

  return claimed(app, request, 'decisionAt', () =>
    sendClaimedEmail(app.log, { to: email, content: decisionEmailFor(request, { proRenewsAt, proEndedAt }), replyTo: replyToRefunds() }),
  )
}

async function notifyReceived(app: FastifyInstance, request: RefundRequestDocument) {
  await sendFounderEmail(app, request)
  await sendReceivedEmail(app, request)
}

// After a decision: its email, and the scrub of a deleted account's request
// once that email went out (the address is what it's sent to: a failed
// email is tried again by the lifecycle tick, then scrubbed regardless after
// a day, scrubLeftovers).
async function afterDecision(app: FastifyInstance, request: RefundRequestDocument) {
  await sendDecisionEmail(app, request).catch((error: unknown) => {
    app.log.error({ err: errorMessage(error), requestId: request._id.toString() }, 'Refund decision email failed')
  })

  if (request.accountDeletedAt) {
    const now = await app.collections.refundRequests.findOne({ _id: request._id }, { projection: { email: 1, emails: 1 } })

    if (!now?.email || now.emails.decisionAt) {
      await scrub(app, request._id)
    }
  }
}

// Deleted accounts' decided requests still holding their personal details:
// their decision email went out (a scrub that failed) or kept failing for a
// day. Scrubbed now.
async function scrubLeftovers(app: FastifyInstance, now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS)
  const left = await app.collections.refundRequests
    .find(
      { accountDeletedAt: { $ne: null }, scrubbedAt: null, status: { $in: ['refunded', 'rejected'] } },
      { projection: { email: 1, emails: 1, decision: 1 } },
    )
    .limit(50)
    .toArray()
  let scrubbed = 0

  for (const request of left) {
    if (!request.email || request.emails.decisionAt || !request.decision || request.decision.at < dayAgo) {
      await scrub(app, request._id)
      scrubbed += 1
    }
  }

  return scrubbed
}

// ---------------------------------------------------------------- deciding

type Admin = { adminId: ObjectId; adminEmail: string }

async function loadRequest(app: FastifyInstance, id: ObjectId) {
  const request = await app.collections.refundRequests.findOne({ _id: id })

  if (!request) {
    throw new RefundRequestError(404, 'Refund request not found.')
  }

  return request
}

const decidedAlready = (request: RefundRequestDocument) =>
  new RefundRequestError(409, `This request was already ${request.status === 'rejected' ? 'rejected' : 'refunded'}. Reload it.`, undefined, request)

// Approving: the plan's exact amount (`expectedAmount`, what the admin
// read) refunded in Stripe and what it gave taken away (refundCovers), the
// request refunded and the customer told. Claimed first, so two clicks or
// two admins refund once; a request stuck in "approved" (a crash) can be
// approved again after a few minutes, which finishes what that approval
// left (its plan says what; 0 when only closing it is left). Everything
// refunded elsewhere already (Stripe's dashboard, its webhook missed):
// closed as refunded in Stripe, with 0. Stripe refusing everything leaves it
// failed, nothing taken away, for a Try again. No 7-day check here: it was
// asked within them.
export async function approveRefundRequest(
  app: FastifyInstance,
  input: Admin & { id: ObjectId; expectedAmount: number; note: string | null },
  deps: RefundDeps = STRIPE_REFUNDS,
  now = new Date(),
) {
  const request = await loadRequest(app, input.id)

  if (request.status === 'refunded' || request.status === 'rejected') {
    throw decidedAlready(request)
  }

  if (request.status === 'approved' && request.updatedAt.getTime() > now.getTime() - STALE_APPROVAL_MS) {
    throw new RefundRequestError(409, 'This request is being refunded right now. Reload it in a minute.', undefined, request)
  }

  const { plan, covers } = await planFor(app, request, now)

  if (plan.total !== input.expectedAmount) {
    throw new RefundRequestError(409, 'The amount changed since you opened this request. Reload it.', undefined, request)
  }

  // Refunded in Stripe already, all of it (its webhook missed): closed so.
  if (covers.length === 0 && plan.payments.length > 0) {
    const closed = await closeAsRefundedInStripe(app, request, now, { stale: true })

    if (!closed) {
      throw new RefundRequestError(409, 'Someone else is deciding this request. Reload it.', undefined, await app.collections.refundRequests.findOne({ _id: request._id }))
    }

    return closed
  }

  const decision = {
    outcome: 'approved' as const,
    by: 'admin' as const,
    adminId: input.adminId,
    adminEmail: input.adminEmail,
    at: now,
    code: null,
    note: input.note,
    cdcOverride: false,
  }
  const claim = await app.collections.refundRequests.findOneAndUpdate(
    {
      _id: request._id,
      $or: [{ status: { $in: [...DECIDABLE] } }, { status: 'approved', updatedAt: { $lt: new Date(now.getTime() - STALE_APPROVAL_MS) } }],
    },
    { $set: { status: 'approved', decision, updatedAt: now } },
    { returnDocument: 'after' },
  )

  if (!claim) {
    throw new RefundRequestError(409, 'Someone else is deciding this request. Reload it.', undefined, await app.collections.refundRequests.findOne({ _id: request._id }))
  }

  // This approval's own id, in each refund's Stripe idempotency key.
  const attempt = `${now.getTime().toString(36)}${randomBytes(3).toString('hex')}`
  const result = await refundCovers(
    app,
    { userId: request.userId, covers, reason: request.reasonCategory, note: input.note, requestId: request._id, flags: request.flags, attempt },
    deps,
  )
  const at = new Date()

  if (result.refunded.length === 0 && result.skipped.length === 0) {
    const message = (result.failed[0]?.error ?? 'Stripe did not answer.').slice(0, 300)

    await app.collections.refundRequests.updateOne(
      { _id: request._id, status: 'approved' },
      { $set: { status: 'failed', updatedAt: at }, $push: { attempts: { at, adminId: input.adminId, ok: false, error: message } } },
    )
    void trackServerEvent(app, { name: 'refund_failed', userId: request.userId, props: { product: request.product, stripe: message.slice(0, 80) } })
    throw new RefundRequestError(
      502,
      `Stripe didn't refund it: ${message.replace(/\.$/, '')}. Try again, or refund it in Stripe.`,
      undefined,
      await app.collections.refundRequests.findOne({ _id: request._id }),
    )
  }

  const partial = result.failed.length > 0
  const amount = result.refunded.reduce((sum, item) => sum + item.amount, 0)
  const notes = [
    request.internalNote,
    partial ? `Partly refunded: ${result.failed.map((item) => `${item.cover.product} (${item.error.slice(0, 120)})`).join(', ')} still to refund in Stripe.` : null,
  ].filter(Boolean)
  const updated = await app.collections.refundRequests.findOneAndUpdate(
    { _id: request._id, status: 'approved' },
    {
      $set: {
        status: 'refunded',
        refund: {
          stripeRefundIds: result.refunded.map((item) => item.stripeRefundId).filter((id): id is string => Boolean(id)),
          amount,
          via: result.refunded.some((item) => !item.inStripe) ? 'admin' : 'stripe',
          at,
          partial,
        },
        internalNote: notes.length ? notes.join(' ') : null,
        updatedAt: at,
      },
      $unset: { openKey: '' },
      $push: { attempts: { at, adminId: input.adminId, ok: true, error: partial ? 'Some payments were not refunded.' : null } },
    },
    { returnDocument: 'after' },
  )
  const final = updated ?? (await loadRequest(app, request._id))

  void trackServerEvent(app, {
    name: 'refund_decided',
    userId: request.userId,
    props: { outcome: 'approved', product: request.product, hoursToDecide: hoursBetween(request.createdAt, at), statutory: Boolean(request.statutory), by: 'admin' },
  })
  await afterDecision(app, final)

  return final
}

// Rejecting: a code (and, for 'other', a note the customer reads), never a
// Brazilian withdrawal without the explicit override; Pro's renewal put
// back as it was; the customer told why. The purchase stays as it was.
export async function rejectRefundRequest(
  app: FastifyInstance,
  input: Admin & { id: ObjectId; code: RefundRejectCode; note: string | null; cdcOverride: boolean },
  deps: Pick<RequestDeps, 'setProCancellation'> = STRIPE_REQUESTS,
  now = new Date(),
) {
  const note = input.note?.trim() || null

  if (!REJECT_CODES.includes(input.code)) {
    throw new RefundRequestError(400, 'Pick why it’s rejected.')
  }

  if (input.code === 'other' && (!note || note.length < 20)) {
    throw new RefundRequestError(400, 'Write why (20 characters or more): the customer reads it.')
  }

  if (note && note.length > 1000) {
    throw new RefundRequestError(400, 'Keep the note under 1,000 characters.')
  }

  const request = await loadRequest(app, input.id)

  if (request.status === 'refunded' || request.status === 'rejected') {
    throw decidedAlready(request)
  }

  if (request.statutory && !input.cdcOverride) {
    throw new RefundRequestError(409, 'Brazil’s right of withdrawal: this request must be refunded. To reject it anyway, confirm the override.', undefined, request)
  }

  const decision = {
    outcome: 'rejected' as const,
    by: 'admin' as const,
    adminId: input.adminId,
    adminEmail: input.adminEmail,
    at: now,
    code: input.code,
    note,
    cdcOverride: Boolean(request.statutory && input.cdcOverride),
  }
  const rejected = await app.collections.refundRequests.findOneAndUpdate(
    { _id: request._id, status: { $in: [...DECIDABLE] } },
    { $set: { status: 'rejected', decision, updatedAt: now }, $unset: { openKey: '' } },
    { returnDocument: 'after' },
  )

  if (!rejected) {
    throw new RefundRequestError(409, 'Someone else is deciding this request. Reload it.', undefined, await app.collections.refundRequests.findOne({ _id: request._id }))
  }

  const restored = await restorePro(app, rejected, deps, now)
  const final = restored ?? rejected

  void trackServerEvent(app, {
    name: 'refund_decided',
    userId: request.userId,
    props: {
      outcome: 'rejected',
      code: input.code,
      product: request.product,
      hoursToDecide: hoursBetween(request.createdAt, now),
      statutory: Boolean(request.statutory),
      override: decision.cdcOverride,
      by: 'admin',
    },
  })
  await afterDecision(app, final)

  return final
}

// Pro's renewal back as it was before the request: only if it wasn't set to
// cancel already, the same subscription is still live, and only once.
async function restorePro(app: FastifyInstance, request: RefundRequestDocument, deps: Pick<RequestDeps, 'setProCancellation'>, now: Date) {
  const pause = request.proPause

  if (!pause || pause.restoredAt || pause.wasCancelAtPeriodEnd || !request.userId) {
    return null
  }

  const user = await app.collections.users.findOne({ _id: request.userId }, { projection: { pro: 1 } })
  const pro = user?.pro

  // The same subscription ended during the review (its trial or period ran
  // out while its renewal was paused): nothing to put back, and the email
  // says so (proEndedOn).
  if (pro && pro.subscriptionId === pause.subscriptionId && (!proIsLive(pro, now.getTime()) || (pro.periodEnd && pro.periodEnd <= now))) {
    return app.collections.refundRequests.findOneAndUpdate(
      { _id: request._id, 'proPause.restoredAt': null },
      { $set: { 'proPause.endedAt': pro.periodEnd && pro.periodEnd <= now ? pro.periodEnd : now } },
      { returnDocument: 'after' },
    )
  }

  if (!pro || pro.subscriptionId !== pause.subscriptionId || !pro.periodEnd) {
    return null
  }

  try {
    await deps.setProCancellation(app, pause.subscriptionId, false)
  } catch (error) {
    app.log.error({ err: errorMessage(error), requestId: request._id.toString() }, 'Refund request rejected, but Pro’s renewal was not restored: turn it back on in Stripe')
    return app.collections.refundRequests.findOneAndUpdate(
      { _id: request._id },
      { $set: { internalNote: [request.internalNote, 'Pro’s renewal could not be restored after the rejection: turn it back on in Stripe.'].filter(Boolean).join(' ') } },
      { returnDocument: 'after' },
    )
  }

  return app.collections.refundRequests.findOneAndUpdate(
    { _id: request._id, 'proPause.restoredAt': null },
    { $set: { 'proPause.restoredAt': now } },
    { returnDocument: 'after' },
  )
}

// The admin's own note on a request (never shown to the customer).
export async function noteRefundRequest(app: FastifyInstance, input: { id: ObjectId; note: string }) {
  const updated = await app.collections.refundRequests.findOneAndUpdate(
    { _id: input.id },
    { $set: { internalNote: input.note.trim() || null } },
    { returnDocument: 'after' },
  )

  if (!updated) {
    throw new RefundRequestError(404, 'Refund request not found.')
  }

  return updated
}

// ---------------------------------------------------------------- Stripe

// A request closed because its money went back in Stripe's dashboard: the
// customer gets the approved email once. `stale`: the admin closing it, a
// request stuck in "approved" included (never the webhook: an approval in
// progress closes its own).
async function closeAsRefundedInStripe(app: FastifyInstance, request: RefundRequestDocument, now: Date, options: { stale?: boolean } = {}) {
  const open: Filter<RefundRequestDocument> = options.stale
    ? { $or: [{ status: { $in: [...DECIDABLE] } }, { status: 'approved', updatedAt: { $lt: new Date(now.getTime() - STALE_APPROVAL_MS) } }] }
    : { status: { $in: [...DECIDABLE] } }
  const closed = await app.collections.refundRequests.findOneAndUpdate(
    { _id: request._id, ...open },
    {
      $set: {
        status: 'refunded',
        decision: { outcome: 'approved', by: 'stripe', adminId: null, adminEmail: null, at: now, code: null, note: null, cdcOverride: false },
        refund: { stripeRefundIds: [], amount: request.amount, via: 'stripe', at: now, partial: false },
        updatedAt: now,
      },
      $unset: { openKey: '' },
    },
    { returnDocument: 'after' },
  )

  if (!closed) {
    return null
  }

  void trackServerEvent(app, {
    name: 'refund_decided',
    userId: request.userId,
    props: { outcome: 'approved', product: request.product, hoursToDecide: hoursBetween(request.createdAt, now), statutory: Boolean(request.statutory), by: 'stripe' },
  })
  await afterDecision(app, closed)

  return closed
}

// A refund made in Stripe's dashboard (charge.refunded, after the purchase
// or book order was marked there): the open requests it belongs to are
// closed as refunded once every payment they cover is back; otherwise the
// request stays open with a note, and its plan leaves out what's refunded.
// Our own approvals never get here (their purchases are marked first).
export async function closeRequestsOnStripeRefund(
  app: FastifyInstance,
  input: { paymentIntentId: string; purchaseId?: ObjectId | null; guideOrderId?: ObjectId | null },
) {
  const match = [
    { 'covers.stripePaymentIntentId': input.paymentIntentId },
    ...(input.purchaseId ? [{ 'covers.purchaseId': input.purchaseId }] : []),
    ...(input.guideOrderId ? [{ 'covers.guideOrderId': input.guideOrderId }] : []),
  ]
  const requests = await app.collections.refundRequests.find({ status: { $in: [...DECIDABLE] }, $or: match }).toArray()
  const now = new Date()

  for (const request of requests) {
    const states = await Promise.all(
      request.covers.map(async (cover) => {
        if (cover.stripePaymentIntentId === input.paymentIntentId) return true
        if (input.purchaseId && cover.purchaseId?.equals(input.purchaseId)) return true
        if (input.guideOrderId && cover.guideOrderId?.equals(input.guideOrderId)) return true

        if (cover.purchaseId) {
          const purchase = await app.collections.purchases.findOne({ _id: cover.purchaseId }, { projection: { refundedAt: 1 } })
          return Boolean(purchase?.refundedAt)
        }

        if (cover.guideOrderId) {
          const order = await app.collections.guideOrders.findOne({ _id: cover.guideOrderId }, { projection: { refundedAt: 1 } })
          return Boolean(order?.refundedAt)
        }

        return false
      }),
    )

    if (states.every(Boolean)) {
      await closeAsRefundedInStripe(app, request, now)
      continue
    }

    await app.collections.refundRequests.updateOne(
      { _id: request._id },
      {
        $set: {
          internalNote: [request.internalNote, `Part of it was refunded in Stripe on ${adminDay(now)}; the rest is still to decide.`].filter(Boolean).join(' '),
        },
      },
    )
  }
}

// ---------------------------------------------------------------- reminders

// The lifecycle tick (every few minutes, LIFECYCLE_EMAILS): emails that
// didn't go out tried again for a day, deleted accounts' decided requests
// scrubbed once their email went out (scrubLeftovers), and one digest to the
// founder of the requests waiting too long (24 h; 12 h for a Brazilian
// withdrawal) and of approvals that stopped halfway (STALE_APPROVAL_MS), each
// told once.
export async function sendRefundReminders(app: FastifyInstance, now = new Date()) {
  const retryBefore = new Date(now.getTime() - RETRY_EMAIL_AFTER_MS)
  const dayAgo = new Date(now.getTime() - DAY_MS)
  const [unsentNew, unsentDecisions] = await Promise.all([
    app.collections.refundRequests
      .find({ createdAt: { $gte: dayAgo, $lte: retryBefore }, $or: [{ 'emails.founderAt': null }, { 'emails.receivedAt': null, email: { $ne: null } }] })
      .limit(50)
      .toArray(),
    app.collections.refundRequests
      .find({ status: { $in: ['refunded', 'rejected'] }, 'emails.decisionAt': null, email: { $ne: null }, 'decision.at': { $gte: dayAgo, $lte: retryBefore } })
      .limit(50)
      .toArray(),
  ])

  for (const request of unsentNew) {
    await notifyReceived(app, request)
  }

  for (const request of unsentDecisions) {
    await afterDecision(app, request)
  }

  const scrubbed = await scrubLeftovers(app, now)
  const retried = unsentNew.length + unsentDecisions.length
  const [waiting, stuck] = await Promise.all([
    app.collections.refundRequests
      .find({ status: { $in: [...DECIDABLE] }, 'emails.reminderAt': null, createdAt: { $lte: new Date(now.getTime() - REMIND_AFTER_STATUTORY_MS) } })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray(),
    app.collections.refundRequests
      .find({ status: 'approved', 'emails.stuckAt': null, updatedAt: { $lte: new Date(now.getTime() - STALE_APPROVAL_MS) } })
      .sort({ createdAt: 1 })
      .limit(50)
      .toArray(),
  ])
  const due = waiting.filter((request) => now.getTime() - request.createdAt.getTime() >= (request.statutory ? REMIND_AFTER_STATUTORY_MS : REMIND_AFTER_MS))
  const claim = async (request: RefundRequestDocument, field: 'reminderAt' | 'stuckAt') =>
    (await app.collections.refundRequests.updateOne({ _id: request._id, [`emails.${field}`]: null }, { $set: { [`emails.${field}`]: now } })).modifiedCount === 1
  const reminded: RefundRequestDocument[] = []
  const stuckTold: RefundRequestDocument[] = []

  for (const request of due) {
    if (await claim(request, 'reminderAt')) {
      reminded.push(request)
    }
  }

  for (const request of stuck) {
    if (await claim(request, 'stuckAt')) {
      stuckTold.push(request)
    }
  }

  if (reminded.length === 0 && stuckTold.length === 0) {
    return { retried, scrubbed, reminded: 0 }
  }

  try {
    const content = reminderDigest([...stuckTold, ...reminded], now)

    for (const to of env.REFUNDS_EMAIL) {
      await sendClaimedEmail(app.log, { to, content })
    }
  } catch (error) {
    app.log.error({ err: errorMessage(error) }, 'Refund reminder not sent')
    await app.collections.refundRequests.updateMany({ _id: { $in: reminded.map((request) => request._id) } }, { $set: { 'emails.reminderAt': null } })
    await app.collections.refundRequests.updateMany({ _id: { $in: stuckTold.map((request) => request._id) } }, { $set: { 'emails.stuckAt': null } })
    return { retried, scrubbed, reminded: 0 }
  }

  return { retried, scrubbed, reminded: reminded.length + stuckTold.length }
}

// ---------------------------------------------------------------- deletion

// What's personal in a decided request goes once its account is deleted:
// the email, the name, what they wrote and the screenshot. The hash, card
// fingerprint, amounts, status and dates stay, for abuse checks and the
// books.
async function scrub(app: FastifyInstance, id: ObjectId) {
  const request = await app.collections.refundRequests.findOne({ _id: id }, { projection: { attachment: 1 } })

  if (request?.attachment?.key) {
    await storage.remove(request.attachment.key).catch(() => undefined)
  }

  await app.collections.refundRequests.updateOne(
    { _id: id },
    { $set: { email: null, firstName: '', explanation: '', attachment: null, scrubbedAt: new Date() } },
  )
}

// An account deleted: its screenshots go, decided requests are scrubbed, and
// open ones stay decidable (money back only) and are scrubbed once their
// decision email goes out.
export async function forgetRefundRequests(app: FastifyInstance, userId: ObjectId) {
  const requests = await app.collections.refundRequests.find({ userId }, { projection: { status: 1, attachment: 1 } }).toArray()
  const now = new Date()

  for (const request of requests) {
    if (request.attachment?.key) {
      await storage.remove(request.attachment.key).catch(() => undefined)
      await app.collections.refundRequests.updateOne({ _id: request._id }, { $set: { attachment: null } })
    }

    if (request.status === 'refunded' || request.status === 'rejected') {
      await scrub(app, request._id)
    } else {
      await app.collections.refundRequests.updateOne({ _id: request._id }, { $set: { accountDeletedAt: now } })
    }
  }

  return requests.length
}

// ---------------------------------------------------------------- admin stats

// For Admin → Refunds: requests received in the period and how they went.
// Admins' own (QA) requests left out.
export async function requestStats(app: FastifyInstance, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS)
  const admins = await adminUserIds(app)
  const requests = await app.collections.refundRequests
    .find({ createdAt: { $gte: since }, userId: { $nin: admins } }, { projection: { status: 1, reasonCategory: 1, statutory: 1, createdAt: 1, decision: 1, email: 1 } })
    .toArray()
  const own = requests.filter((request) => !(request.email && isAdmin({ email: request.email })))
  const approved = own.filter((request) => request.status === 'refunded').length
  const rejected = own.filter((request) => request.status === 'rejected').length
  const hours = own
    .filter((request) => request.decision && (request.status === 'refunded' || request.status === 'rejected'))
    .map((request) => (request.decision!.at.getTime() - request.createdAt.getTime()) / HOUR_MS)
    .sort((a, b) => a - b)
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2]! : (hours[hours.length / 2 - 1]! + hours[hours.length / 2]!) / 2) : null
  const open = own.filter((request) => (OPEN_STATUSES as readonly string[]).includes(request.status))
  const byCategory: Record<string, number> = {}

  for (const request of own) {
    byCategory[request.reasonCategory] = (byCategory[request.reasonCategory] ?? 0) + 1
  }

  return {
    received: own.length,
    approved,
    rejected,
    pending: open.length,
    overdue: open.filter((request) => dueAt(request).getTime() < now.getTime()).length,
    approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    medianHoursToDecision: median === null ? null : Math.round(median * 10) / 10,
    byCategory,
    statutory: own.filter((request) => request.statutory).length,
  }
}

// The customer-facing words for refunds (i18n/emails.*.ts `refund`).
function emailRefundCopy(locale: Locale) {
  return emailCopy(locale).refund
}
