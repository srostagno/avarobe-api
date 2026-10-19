import type { Binary, ObjectId } from 'mongodb'

import type { LinkAdIds } from '../utils/auth-links.js'
import type { Locale } from '../utils/locale.js'
import type { AiFailure } from '../utils/openai.js'

export type UserDocument = {
  _id: ObjectId
  email: string
  firstName: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
  emailVerifiedAt: Date | null
  // Hashes of the nonce in the latest verification / reset link. Cleared when
  // the link is used, so each link works once and a new one voids older ones.
  emailVerificationNonceHash?: string | null
  emailVerificationSentAt?: Date | null
  passwordResetNonceHash?: string | null
  passwordResetSentAt?: Date | null
  // Sign-in links to another browser (utils/auth-links.ts).
  handoffNonceHash?: string | null
  handoffSentAt?: Date | null
  signInNonceHash?: string | null
  signInSentAt?: Date | null
  // The pay link emailed when they tap Buy inside Instagram's or Facebook's
  // browser (lifecycle/service.ts sendCheckoutLink), and when each
  // product's last went out (one per product every few hours).
  checkoutLinkNonceHash?: string | null
  checkoutLinkSentAt?: Date | null
  checkoutLinkEmails?: Partial<Record<PurchaseProduct, Date>>
  // Purchases a guest made with this account's email at checkout, unlocked
  // here too (billing/guest-checkout.ts), one entry per checkout.
  sharedPurchases?: { sessionId: string; product: PurchaseProduct; fromUserId: ObjectId; at: Date }[]
  // On that guest: the account its checkout's email belonged to.
  purchaseSharedWith?: ObjectId | null
  // The link to their colors after a read the AI did late (lifecycle
  // sendColorsReady): its own, so the offers' sign-in links don't void it.
  colorsLinkNonceHash?: string | null
  colorsLinkSentAt?: Date | null
  passwordHash?: string | null
  passwordUpdatedAt?: Date | null
  // Throttles password guessing per account on top of the per-IP rate limit.
  failedLoginCount?: number
  lockedUntil?: Date | null
  // Billing. Missing credits means the sign-up allowance (FREE_CREDITS).
  credits?: number
  // The reports, bought on their own or with Pro annual: yours to keep.
  colorReportAt?: Date | null
  styleReportAt?: Date | null
  // The color mirror (live draping), bought on its own; Pro includes it.
  colorMirrorAt?: Date | null
  // The Hair & Grooming Advisor: every recommended cut on them, and the hair
  // colors (or facial hair) that suit them. Until Oct 2026 it came with the
  // Style Advisor; styleWithoutHair marks a Style Advisor bought after the
  // split, so earlier owners keep their cuts.
  hairAdvisorAt?: Date | null
  styleWithoutHair?: boolean
  // Event Stylist passes bought and not yet used (one per event).
  eventCredits?: number
  // Personal magazines bought and not yet made (one per issue).
  magazineCredits?: number
  // Avarobe Pro (monthly or annual subscription).
  pro?: ProSubscription | null
  // Legacy: the Style Kit of the first price list (everything until then).
  styleKitUntil?: Date | null
  // First purchase of anything (reports, a look pack or Pro).
  paidAt?: Date | null
  // When they started their Pro trial: one per account.
  proTrialAt?: Date | null
  // Pro's first month at half price, offered once after rating a paid
  // advisor 7 or more (modules/feedback): until when, and when it was used.
  proHalfOffer?: ProHalfOffer | null
  // Her invite link (modules/invites, Oct 18, 2026): a friend's first read
  // unlocks one of her teasers (`pending`: earned before one was drawn).
  invite?: { code: string; createdAt: Date; rewards: number; pending: number }
  // The friend who invited her, and when her first read rewarded them.
  invitedBy?: { userId: ObjectId; code: string; at: Date; rewardedAt: Date | null }
  // Avatar renders used without Pro (create, redo, adjust, a new haircut).
  freeAvatarRuns?: number
  // Hairstyle renders used without the Style Advisor or Pro (FREE_HAIR_RUNS).
  freeHairRuns?: number
  // Icon looks tried on without Pro (FREE_TRY_ONS, for good).
  freeTryOns?: number
  // The Edits whose one free try-on she used (Oct 18, 2026: one per Edit).
  freeEditTryOns?: string[]
  // The looks they picked to try on next (the Halloween flow, while their
  // avatar was drawing): offered after they buy, never drawn on their own.
  lookPicks?: { ids: string[]; at: Date } | null
  // Admins (COMP_EMAILS) testing the app as a regular customer.
  compPaused?: boolean
  // Onboarding emails (modules/lifecycle): when each one went out, and the
  // latest, so they stay spaced out.
  lifecycleEmails?: Partial<Record<LifecycleEmailKind, Date>>
  lifecycleEmailLastAt?: Date | null
  // The Edits a cross-sell email showed her (xsell_pro, xsell_edit), by id,
  // so each new Edit reaches her once.
  editEmails?: string[]
  // The picture made for each cross-sell email (lifecycle/assets.ts), by
  // kind, or `edit:<editId>` for xsell_edit. Files under users/<uid>/.
  xsellAssets?: Partial<Record<string, EmailAsset>>
  // Opted out of tips and reminders (unsubscribe link or account settings).
  // Account and security emails still go out.
  emailTipsOptOutAt?: Date | null
  // Where this person first came from, as the web saw it at sign-up
  // (first-party analytics); server events inherit it.
  acquisition?: Acquisition | null
  // Where they signed up from: country and state, never the IP.
  location?: UserLocation | null
  // Trying Avarobe before making an account (Oct 2026): a session with no
  // email yet, so the selfie and colors come first. `email` holds a
  // placeholder (utils/guests.ts) until they save with their own email,
  // when `guest` goes and `claimedAt` is set. Guests get no tips emails and
  // are deleted after GUEST_TTL_DAYS if they never save.
  guest?: boolean
  claimedAt?: Date | null
  // The language they use Avarobe in (utils/locale.ts): AI text, emails and
  // links are made in it. Missing means English (accounts from before).
  locale?: Locale
  // Deleted by its owner (or a guest that never saved, after GUEST_TTL_DAYS),
  // since Oct 2026 (me/delete-account.ts): the row stays for our records
  // with `email` an alias that can't receive mail (utils/deleted-accounts.ts),
  // no name and no way to sign in, and the photos gone. `emailHash`: sha256
  // of the real email, trimmed and lowercased (as on refund requests), to
  // recognize someone who comes back.
  deletedAt?: Date | null
  emailHash?: string | null
  // Face Age (modules/look; "Look Great" its first day): her birth date if she
  // gave it, the release she signed for her face photos, how often she wants
  // a reminder, and whether her photos need Face ID / Touch ID (a passkey).
  lookGreat?: LookGreatProfile | null
  // Photos she has added to Face Age, ever: the free ones count from it,
  // so deleting one (or everything) doesn't give it back. A photo that
  // couldn't be read gives its place back.
  lookPhotosAdded?: number
  // Free uses of the studios' features without Pro (Oct 17, 2026), by kind:
  // Look Score and Hair Score photos, makeup and hair presets tried on.
  // Claimed atomically (billing/entitlements useFreeUse); a failure gives
  // its use back.
  freeUses?: Partial<Record<FreeUseKind, number>>
  // Look Score and Hair Score (modules/scores): the release she agreed to
  // for her photos (one for both).
  scoreProfile?: ScoreProfile | null
}

export type FreeUseKind = 'look_score' | 'hair_score' | 'makeup' | 'hair_preset'

export type ScoreProfile = {
  consentAt: Date
  consentVersion: string
  // 'tap': her tap on "Agree and continue"; 'checkbox': the box (Illinois).
  consentMethod: 'tap' | 'checkbox'
  createdAt: Date
}

export type LookReminder = 'off' | 'daily' | 'few' | 'weekly'

export type LookGreatProfile = {
  // 'YYYY-MM-DD', 18 or older; optional (Oct 15): without it there's no
  // comparison with her real age.
  birthDate: string | null
  // Her consent before her first photo: when and which text. Until Oct 16,
  // 2026 a written release she signed with her typed full name; since
  // then her tap on "Agree and continue", with the text beside it (no
  // name: null). Face Age stays closed in Illinois and Washington.
  consentAt: Date
  consentVersion: string
  consentName: string | null
  reminder: LookReminder
  reminderLastAt?: Date | null
  lock: boolean
  createdAt: Date
}

// A cross-sell email's own picture of her: a gift look, her ideal cut, an
// Edit tried on her, a magazine cover. `ref` is what it shows (a look or
// hairstyle id). One that failed, or is still processing after a while,
// sends the email with its stock picture instead; it's never retried.
export type EmailAsset = {
  status: GenerationStatus
  key: string | null
  ref: string | null
  startedAt: Date
  readyAt?: Date
}

// 'edge': the web host's reading of the sign-up request (analytics/geo.ts).
// 'ip': filled in later from the IP of their first session.
export type UserLocation = { country: string; region: string | null; source: 'edge' | 'ip'; at: Date }

// A visitor's first touch: the channel and campaign that brought them. Ad
// click ids are kept only as far as offline conversions need them.
export type Acquisition = {
  visitorId: string | null
  channel: AnalyticsChannel
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  term: string | null
  landing: string | null
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  fbclid?: string | null
  // Set when the browser lost the ad's parameters but kept Meta's click
  // cookie (_fbc) to sign-up: the channel became Meta, and `recoveredFrom` is
  // what the browser had reported (events/service.ts).
  recovered?: 'meta_click'
  recoveredFrom?: AnalyticsChannel | null
}

export type AnalyticsChannel = 'meta' | 'google' | 'email' | 'organic' | 'ai' | 'social' | 'referral' | 'direct'

// One first-party analytics event: from the web (page views, clicks, offers
// seen) or from the server (checkouts, payments, paywalls). Never personal
// data: no email, no free text, no IP.
export type AnalyticsEventDocument = {
  _id: ObjectId
  at: Date
  name: string
  origin: 'web' | 'server'
  visitorId: string | null
  sessionId: string | null
  userId: ObjectId | null
  path: string | null
  props: Record<string, string | number | boolean>
  // First touch (acquisition) and this session's touch.
  channel: AnalyticsChannel | null
  campaign: string | null
  content: string | null
  sessionChannel: AnalyticsChannel | null
  mobile: boolean | null
  inApp: boolean | null
  // "US-TX" (analytics/geo.ts); absent on events from before it was kept.
  geo?: string | null
}

export type LifecycleEmailKind =
  | 'welcome'
  | 'avatar_nudge'
  | 'looks_nudge'
  // Out of free looks: the offer, then two reminders.
  | 'upgrade_offer'
  | 'upgrade_reminder'
  | 'upgrade_last_call'
  // Pro trial notices (transactional): its terms when it starts, and a
  // reminder before the first monthly charge.
  | 'trial_started'
  | 'trial_ending'
  // A checkout left unpaid: a link to finish it in their own browser.
  | 'checkout_rescue'
  | 'pro_rescue'
  // Tapped Buy inside Instagram's or Facebook's browser: at once, a link
  // that pays in the phone's own browser, with Apple Pay or Google Pay.
  | 'checkout_link'
  // A guest paid with an email that already has an account: what they
  // bought is in that account too, with a link that signs them in on it.
  | 'purchase_in_account'
  // Pro started: where to begin, once (lifecycle/service.ts sendProWelcomes).
  | 'pro_welcome'
  // Oct 2026, once: Face Age announced to everyone without Pro (sendFaceAgeLaunch).
  | 'face_age_launch'
  // Once, after the 2-Oct-2026 price cut: to people who opened an offer at
  // the old price and bought nothing.
  | 'price_drop'
  // Buyers: the next product they don't have, one email at a time
  // (lifecycle/cross-sell.ts). Each goes out once.
  | 'xsell_style'
  | 'xsell_color'
  | 'xsell_addon_last_call'
  | 'xsell_hair'
  | 'xsell_magazine'
  | 'xsell_event'
  | 'xsell_guide'
  // Pro: once; then each new Edit, tried on them, while they aren't on Pro.
  | 'xsell_pro'
  | 'xsell_edit'
  // Bought the Color Advisor and never opened the report: once, an hour on.
  | 'report_unopened'
  // The Halloween flow: tried their free costume on and didn't get Pro.
  // Once, an hour after the try-on, with it and the costumes they picked.
  | 'costume_offer'
  // Her best version drawn ahead, still locked an hour on (once), and her
  // half-price month a few hours before it ends, unused (once). Oct 18, 2026.
  | 'teaser_ready'
  | 'half_offer_last_call'
  // A color read that failed for the AI provider, done later (they asked to
  // be told): a sign-in link to their colors.
  | 'colors_ready'
  // Face Age: the reminder she asked for (daily, a few times a week or
  // weekly) to add today's photo. Each send updates lookGreat.reminderLastAt;
  // lifecycleEmails keeps only the latest.
  | 'look_reminder'

export type ProSubscription = {
  subscriptionId: string
  customerId: string | null
  status: string
  interval: 'month' | 'year'
  periodEnd: Date | null
  cancelAtPeriodEnd: boolean
  // Annual plans get their monthly looks from a scheduler: the next drop.
  nextCreditsAt?: Date | null
  // Trials (status 'trialing'): when the first monthly charge happens.
  trialEnd?: Date | null
  // Avatar renders this Pro month (PRO_AVATAR_RUNS_PER_MONTH). Starts over
  // with every payment (the object is replaced) and every annual refill.
  avatarRuns?: number
  // Set on every Pro payment since the avatar cap (Oct 2026): a
  // subscription paid before it keeps unlimited renders until its next one.
  avatarCap?: boolean
  // Set on every Pro payment since the rollover cap (Oct 2026): from then
  // on renewals and annual's monthly looks add only up to PRO_ROLLOVER_CAP.
  // A subscription paid before it gets its next payment's looks in full.
  rolloverCap?: boolean
  // Annual's first payment: the rest of the first month's looks, held until
  // `at` (PRO_ANNUAL_FIRST_WEEK_DAYS after paying), then added by the refill.
  heldCredits?: { amount: number; at: Date } | null
}

export type PurchaseProduct =
  | 'color_report'
  | 'style_report'
  | 'reports_bundle'
  // The other report at the bundle price, soon after buying one.
  | 'color_addon'
  | 'style_addon'
  | 'look_pack'
  | 'pro_monthly'
  | 'pro_annual'
  // The trial fee: a few days of Pro that then renew as pro_monthly.
  | 'pro_trial'
  // The color mirror: every fabric draped on them live, and their #1 color.
  | 'color_mirror'
  // The Hair & Grooming Advisor on its own.
  | 'hair_advisor'
  // Color, Style and Hair & Grooming advisors together.
  | 'advisors_bundle'
  // One event with the Event Stylist.
  | 'event_pass'
  // One personal magazine: ten looks on location.
  | 'magazine'
  // The Outfit Formula Book, a PDF guide (also sold to guests, see GuideOrderDocument).
  | 'outfit_guide'
  // One teaser unlocked without Pro (Oct 18, 2026): her perfect haircut,
  // look or best face, the teaser in the purchase's metadata.teaserId.
  | 'teaser_unlock'

// Products of the first price list (Sep 2026), found in old records only.
export type LegacyPurchaseProduct = 'style_kit' | 'top_up' | 'kit_upgrade' | 'plus'

// One payment. The unique stripeSessionId (a Checkout session id, or the
// invoice id for Plus months) makes granting idempotent: the success page and
// the webhook can both report the same payment.
export type PurchaseDocument = {
  _id: ObjectId
  userId: ObjectId
  product: PurchaseProduct | LegacyPurchaseProduct
  stripeSessionId: string
  stripePaymentIntentId: string | null
  amountTotal: number
  currency: string
  // The amount in rough US cents (billing/pricing.ts), so revenue adds up
  // across currencies; missing on purchases from before (all in dollars).
  amountUsd?: number
  credits: number
  // A Pro renewal's looks that didn't fit under the rollover cap
  // (PRO_ROLLOVER_CAP): `credits` is what it added.
  creditsOverCap?: number
  createdAt: Date
  // Money back: a refund request the founder approved (Admin → Refunds), an
  // instant in-app refund from before Oct 12, 2026, or a refund made in
  // Stripe's dashboard. What the purchase unlocked is taken away.
  refundedAt?: Date | null
  refund?: PurchaseRefund | null
  // What she paid for, for products that unlock her colors (the Color
  // Advisor, the mirror): her season then, and the read it came from.
  colorRead?: { season: string; readId: string | null } | null
  // The offer the checkout was opened from (e.g. purchase_success_pro_credit,
  // email_xsell_style_pro), when the checkout said.
  placement?: string | null
  // The terms accepted at checkout (Stripe's consent checkbox), since Oct 2026.
  terms?: 'accepted' | null
  // The card's country as Stripe has it, looked up once while a refund can
  // be requested (a Brazilian card is one of the signals of Brazil's right
  // of withdrawal); null when Stripe has none. Missing: not looked up yet.
  cardCountry?: string | null
  // The account was deleted (me/delete-account.ts): the sale stays as it was,
  // for the books, the admin's revenue and refunds.
  accountDeletedAt?: Date | null
}

// What happened, as the customer picks it in a refund request. A superset of
// the one-tap refund's reasons (before Oct 12, 2026), so purchases refunded
// then keep valid values.
export type RefundReason = 'not_accurate' | 'quality' | 'technical' | 'not_expected' | 'duplicate' | 'mistake' | 'other'

export type PurchaseRefund = {
  // 'admin': a refund request approved in Admin → Refunds (`requestId`);
  // 'app': the instant in-app refund before Oct 12, 2026 (production's
  // included); 'stripe': made in Stripe's dashboard.
  source: 'app' | 'stripe' | 'admin'
  requestId?: ObjectId | null
  // The request's (or the one-tap refund's); refunds made in Stripe have none.
  reason: RefundReason | null
  note: string | null
  amount: number
  stripeRefundId: string | null
  // For the admin's review, never a reason to refuse one: 'repeat' when they
  // had refunds before (`priorRefunds`), 'credit_used' when this report's
  // credit paid part of a Pro annual they keep, and an approved request's
  // own flags.
  flags?: RefundRequestFlag[]
  priorRefunds?: number
  // When what it gave was taken back (an approved request), so an approval
  // that stopped halfway and is finished later doesn't take it twice.
  revokedAt?: Date | null
}

// The flags the one-tap refund kept on purchases (a subset of the request's).
export type RefundFlag = 'repeat' | 'credit_used'

// A refund request (Oct 2026): refunds are reviewed by the founder, never
// instant or automatic. Approval refunds in Stripe and takes back what the
// purchase gave (billing/refunds.ts); a rejection says why
// (billing/refund-requests.ts).
export type RefundRequestStatus = 'pending' | 'approved' | 'refunded' | 'rejected' | 'failed'

export type RefundRejectCode = 'resolved' | 'works_as_described' | 'used' | 'outside_policy' | 'duplicate' | 'withdrawn' | 'other'

// Signals for the founder's review, never an automatic rejection.
export type RefundRequestFlag =
  | 'repeat'
  | 'requested_before'
  | 'credit_used'
  | 'used'
  | 'heavy_use'
  | 'card_seen'
  | 'many_open'
  | 'new_account'
  | 'charged_during_review'
  | 'disputed'
  | 'old_guarantee'

// One payment the request covers, as it was when asked: refundable even if
// the account (and its purchases) is deleted meanwhile.
export type RefundCover = {
  purchaseId: ObjectId | null
  guideOrderId: ObjectId | null
  product: PurchaseProduct
  amount: number
  currency: string
  paidAt: Date
  stripePaymentIntentId: string | null
  stripeInvoiceId: string | null
}

// How much of it they used, for the founder (never a reason to refuse on its
// own). Counts are since the earliest covered payment.
export type RefundUsage = {
  at: Date
  hoursSincePurchase: number
  colorReportOpenedAt: Date | null
  styleReportOpenedAt: Date | null
  hairReadAt: Date | null
  drapeAt: Date | null
  looksMade: number
  looksWithCredit: number
  creditsGiven: number
  creditsLeft: number | null
  hairstylesMade: number
  eventsStyled: number
  magazinesMade: number
  checksMade: number
  avatarRuns: number | null
  guideDownloads: number | null
  guideLastDownloadAt: Date | null
  lastSeenAt: Date | null
  // Analytics events by name since paying, the 15 most frequent.
  events: Record<string, number>
}

export type RefundCard = { brand: string | null; last4: string | null; country: string | null; fingerprint: string | null }

export type RefundRequestHistory = {
  refundsBefore: number
  requestsBefore: number
  approvedBefore: number
  rejectedBefore: number
  openRequests: number
  purchases: number
  paidUsd: number
  accountCreatedAt: Date | null
  channel: string | null
  campaign: string | null
  // Other people's requests paid with the same card.
  cardSeenOn: number
}

export type RefundRequestDecision = {
  outcome: 'approved' | 'rejected'
  by: 'admin' | 'stripe'
  adminId: ObjectId | null
  adminEmail: string | null
  at: Date
  code: RefundRejectCode | null
  // A rejection's note is shown to the customer; an approval's is internal.
  note: string | null
  // A Brazilian withdrawal within its 7 days, rejected anyway (a duplicate,
  // fraud): the admin ticked that they know the law says refund.
  cdcOverride: boolean
}

// Why a purchase counts as Brazilian: paid in reais, signed up in Brazil, a
// Brazilian card, or only the language (Brazilian Portuguese).
export type BrazilBasis = 'currency' | 'signup' | 'card' | 'language'

export type RefundRequestDocument = {
  _id: ObjectId
  // "R-7F3K2Q" (6 Crockford base32), for emails, support and the admin.
  ref: string
  source: 'account' | 'guide_link'
  userId: ObjectId | null
  guideOrderId: ObjectId | null
  // The purchase it was asked from (Pro: the payment tapped).
  purchaseId: ObjectId | null
  product: PurchaseProduct
  covers: RefundCover[]
  // The sum of the covers, in minor units of their currency.
  amount: number
  currency: string
  amountUsd: number
  // The earliest cover.
  purchasedAt: Date
  // The contact, as it was when asked (account or order), for the emails
  // even after the account is deleted. Scrubbed after a deletion.
  email: string | null
  // sha256 of the lowercased email; kept after scrubbing, for abuse checks.
  emailHash: string
  firstName: string
  locale: Locale
  // What it's for, for good: "p:<purchaseId>", "pro:<userId>" (Pro's first
  // week) or "g:<guideOrderId>". `openKey` is the same while the request is
  // open (unique), so there's one open request per target.
  targetKey: string
  openKey?: string
  market: {
    currency: string
    region: string
    signupCountry: string | null
    // The site's geo cookie when asking.
    requestCountry: string | null
    card: RefundCard | null
    disputed: boolean
  }
  // Asked within 7 days of paying (Brazil: calendar days, São Paulo time).
  within7d: boolean
  // Brazil's right of withdrawal (CDC art. 49): asked within its 7 days, so it
  // must be refunded. `until`: the end of those 7 days. `basis`: why it
  // counts as Brazilian (missing on requests from before it was kept).
  statutory: { law: 'br_cdc_49'; until: Date; basis?: BrazilBasis[] } | null
  // Paid under the old Terms' guarantee, and covered by it.
  oldGuarantee: boolean
  reasonCategory: RefundReason
  explanation: string
  // users/<userId>/refund-<id>.jpg (account holders only).
  attachment: { key: string; bytes: number } | null
  usage: RefundUsage
  history: RefundRequestHistory
  flags: RefundRequestFlag[]
  // Pro's renewal paused while under review, and what it was before.
  // `endedAt`: the subscription ended during the review (its renewal was
  // paused), so a rejection couldn't put it back.
  proPause: { subscriptionId: string; wasCancelAtPeriodEnd: boolean; at: Date; restoredAt: Date | null; endedAt?: Date | null } | null
  status: RefundRequestStatus
  decision: RefundRequestDecision | null
  attempts: { at: Date; adminId: ObjectId | null; ok: boolean; error: string | null }[]
  refund: { stripeRefundIds: string[]; amount: number; via: 'admin' | 'stripe'; at: Date; partial: boolean } | null
  internalNote: string | null
  // When each email went out (claimed before sending, unset if it failed).
  // `stuckAt`: the founder was told an approval stopped halfway.
  emails: { founderAt: Date | null; receivedAt: Date | null; decisionAt: Date | null; reminderAt: Date | null; stuckAt?: Date | null }
  // The account was deleted while the request was open: decided as usual
  // (money back only), then scrubbed once its decision email goes out.
  accountDeletedAt?: Date | null
  scrubbedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

// A visit from a Meta ad, counted by us to see where clicks get lost:
// 'arrived' when the request reaches the web server, 'loaded' when the page
// runs in the browser, 'registered' when that click becomes an account.
// `click` is a hash of the ad click id (fbclid), never the id itself.
export type ArrivalStage = 'arrived' | 'loaded' | 'registered'

export type ArrivalDocument = {
  _id: ObjectId
  stage: ArrivalStage
  click: string | null
  path: string
  campaign: string | null
  content: string | null
  inApp: boolean
  mobile: boolean
  at: Date
}

// One lifecycle email that went out, with what the person did with it:
// opens (a tracking pixel; Apple Mail opens everything on its own, so read
// them as a ceiling), clicks through our redirect, and unsubscribes.
// Purchases are attributed at read time (admin/routes.ts).
export type EmailSendDocument = {
  _id: ObjectId
  userId: ObjectId
  kind: LifecycleEmailKind
  subject: string
  sentAt: Date
  // Set by the first open or click ($min on a missing field).
  opens: number
  firstOpenAt?: Date
  clicks: number
  firstClickAt?: Date
  lastClickAt?: Date
  unsubscribedAt?: Date
  // The ad ids its links sign in with when clicked (lifecycle
  // clickDestination). Missing: the account's stored Meta click; null: none
  // (the browser it was asked from didn't allow tracking).
  ads?: LinkAdIds | null
}

// A WebAuthn credential (passkey). The private key stays on the person's
// device; we only keep the public key and the signature counter.
export type PasskeyDocument = {
  _id: ObjectId
  userId: ObjectId
  credentialId: string
  publicKey: Binary
  counter: number
  transports: string[]
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
  name: string
  createdAt: Date
  lastUsedAt: Date | null
}

export type AuthChallengeDocument = {
  _id: string
  // 'look_unlock': Face ID / Touch ID before her Face Age photos show.
  purpose: 'passkey_register' | 'passkey_login' | 'look_unlock'
  userId: ObjectId | null
  challenge: string
  expiresAt: Date
}

export type RefreshTokenDocument = {
  _id: ObjectId
  tokenHash: string
  userId: ObjectId
  expiresAt: Date
  revokedAt: Date | null
  replacedByTokenHash: string | null
  createdAt: Date
  createdByIp: string | null
  userAgent: string | null
}

export type Presentation = 'menswear' | 'womenswear' | 'unisex'

export type BodyBuild =
  | 'slim'
  | 'athletic'
  | 'average'
  | 'broad'
  | 'curvy'
  | 'plus'

export type AvatarBody = {
  heightCm: number
  weightKg: number
  build: BodyBuild
  presentation: Presentation
}

export type ColorSwatch = {
  name: string
  hex: string
}

export type ColorAnalysis = {
  season: string
  undertone: 'warm' | 'cool' | 'neutral' | 'olive'
  contrast: 'low' | 'medium' | 'high'
  summary: string
  bestColors: ColorSwatch[]
  neutrals: ColorSwatch[]
  avoidColors: ColorSwatch[]
  metals: 'gold' | 'silver' | 'both'
  confidence: 'low' | 'medium' | 'high'
  photoNote: string | null
}

export type GenerationStatus = 'processing' | 'ready' | 'failed'

export type AvatarVersion = {
  id: string
  key: string
  // 'hair': the same avatar with a new haircut from the Hair studio.
  source: 'create' | 'refine' | 'hair'
  createdAt: Date
  // A haircut that isn't the one in the selfie: renders from this version
  // use it instead (`refKey` is a close-up of it, owned by the avatar).
  hair?: AvatarHair | null
}

export type AvatarHair = {
  hairstyleId: string
  name: string
  // What the image model is told the haircut is.
  render: string
  refKey: string
}

// The generation in flight, so the app can show real progress: the palette
// lands first, then previews of the render as the model refines it.
export type AvatarJob = {
  // 'colors': reading the selfie only, before there's an avatar.
  kind: 'create' | 'refine' | 'hair' | 'colors'
  startedAt: Date
  previewKey: string | null
  previewCount: number
  // 'hair': the hairstyle being put on the avatar.
  hairstyleId?: string | null
  // 'colors': this read's id (every write of the read is guarded by it) and
  // the photo it reads: a new selfie held here until the read succeeds, or
  // the stored one. The avatar's own selfieKey moves only then.
  readId?: string | null
  selfieKey?: string | null
  // What the render took (billing useAvatarRun), so a failed one gives a
  // Pro month's render back.
  avatarRun?: 'comp' | 'free' | 'pro' | 'exempt' | null
}

// Why the last color read failed (utils/openai.ts classifyAiError), after
// how many tries. `detail` is OpenAI's message, redacted: internal only, the
// person sees a reason (busy, photo, error) in their own language.
export type ColorsFailure = { code: AiFailure; at: Date; attempts: number; detail: string | null }

// How a photo measures on four traits, -5 to +5 (an average of two
// measurements may end in .5). The season follows from them in code
// (modules/avatar/seasons.ts), never from the model.
export type ColorScores = { warmth: number; depth: number; chroma: number; contrast: number }

export type ColorLighting = 'good' | 'tinted' | 'poor'

// What a color read did: the first colors; a new photo that read the same
// season (confirmed), leaned elsewhere without clearly differing (anchored),
// clearly differed (changed, or a candidate for a buyer to choose); the same
// photo again (reused, no AI call); a failure that kept the colors. Then the
// buyer's choice (kept_paid, switched) and an admin restore.
export type ColorReadOutcome =
  | 'first'
  | 'confirmed'
  | 'anchored'
  | 'changed'
  | 'candidate'
  | 'reused'
  | 'failed'
  | 'kept_paid'
  | 'switched'
  | 'restored'

// The way a season moved, for what the person is told (modules/avatar/seasons.ts).
export type ColorChangeDirection = 'cooler' | 'warmer' | 'deeper' | 'lighter' | 'softer' | 'brighter'

// One line of the per-avatar history (newest first, at most 12): for support and admin.
export type ColorReadLog = {
  // The read id (ObjectId hex).
  id: string
  at: Date
  // The photo read (it may have been deleted since).
  selfieKey: string
  // sha256 of the normalized JPEG.
  imageHash: string | null
  method: 'scored' | 'classic' | 'restored'
  outcome: ColorReadOutcome
  // What this photo read as (null when failed).
  season: string | null
  undertone: ColorAnalysis['undertone'] | null
  contrast: ColorAnalysis['contrast'] | null
  scores: ColorScores | null
  lighting: ColorLighting | null
  // fit(top1) - fit(top2).
  margin: number | null
  // fit(new) - fit(current), when there was a current season.
  lead: number | null
  // The season the person has after this read.
  shown: string | null
  // 'changed' and 'switched': the season before, and which way it moved.
  from?: string | null
  direction?: ColorChangeDirection | null
  failure?: ColorsFailure | null
  via?: 'colors' | 'avatar' | 'notify'
  // What the measuring call saw (scored), so a palette written later from
  // these scores (the same photo again) still describes the person.
  coloring?: { skin: string; hair: string; eyes: string; lighting: string } | null
}

// Which read the current colorAnalysis came from (for a confirmed or
// anchored read of a new photo, that photo: the colors stay, the photo is
// theirs now).
export type ColorsSource = {
  readId: string
  at: Date
  selfieKey: string
  imageHash: string | null
  method: ColorReadLog['method']
  scores: ColorScores | null
  lighting: ColorLighting | null
}

// A read of a new photo with another season, waiting for the person's choice
// (a buyer's that clearly differs; in 'classic', anyone's that differs).
// `baseSelfieKey`: their selfie when it was read, so a newer selfie (Photos &
// measurements) isn't swapped back for this photo by a switch.
export type ColorCandidate = {
  readId: string
  at: Date
  selfieKey: string
  analysis: ColorAnalysis
  source: ColorsSource
  baseSelfieKey?: string | null
}

// The colors (and report) someone had before switching to a new read, kept
// for an undo by hand (scripts/restore-colors.ts --previous): the report is
// the paid part.
export type PreviousColors = {
  at: Date
  analysis: ColorAnalysis
  colorsAt: Date | null
  source: ColorsSource | null
  report: { data: ColorReport; createdAt: Date } | null
}

// "Tell me when my colors are ready", after a read failed because the AI was
// busy or out of credits (modules/avatar/retry.ts reads it again and emails
// a sign-in link). Pending while sentAt and gaveUpAt are null, for a day.
// `attempts` counts the reads that cost something; `sendFailures` the
// emails that didn't go (given up at 3).
export type ColorsNotify = {
  requestedAt: Date
  attempts: number
  lastTriedAt: Date | null
  sentAt: Date | null
  gaveUpAt: Date | null
  via: 'guest' | 'account' | 'script'
  sendFailures?: number
}

export type AvatarAdjustment =
  | 'more_like_me'
  | 'head_smaller'
  | 'head_larger'
  | 'slimmer'
  | 'fuller'
  | 'broader_shoulders'
  | 'narrower_shoulders'
  | 'match_skin'

export type AvatarDocument = {
  _id: ObjectId
  userId: ObjectId
  status: GenerationStatus
  error: string | null
  // The last color read's failure (colors first), cleared when one starts.
  // Also a failed re-read that kept the colors (status 'ready').
  failure?: ColorsFailure | null
  colorsNotify?: ColorsNotify | null
  selfieKey: string
  // Optional full-body photo; the strongest signal for real proportions.
  bodyPhotoKey?: string | null
  // Null until the first render. Someone who came for their colors has a
  // selfie, a color analysis and no body yet (null) until they make the
  // avatar.
  avatarKey: string | null
  // Recent renders, newest first, so a refinement can be undone.
  versions?: AvatarVersion[]
  job?: AvatarJob | null
  body: AvatarBody | null
  // How they shop, asked before the color report when the body isn't in yet
  // (colors first); the body's own presentation wins once it's there.
  presentation?: Presentation | null
  colorAnalysis: ColorAnalysis | null
  // When the colors were read (the palette offer email is timed from it).
  colorsAt?: Date | null
  // The last 12 color reads, newest first (support and admin; never sent to
  // the web), which read the colors came from, and a read waiting for a
  // buyer's choice (modules/avatar/reads.ts).
  colorReads?: ColorReadLog[] | null
  colorsSource?: ColorsSource | null
  colorCandidate?: ColorCandidate | null
  previousColors?: PreviousColors | null
  // Style Kit reports. The color report, drape and color boards follow the
  // accepted read (for buyers, not the selfie: a new selfie keeps them); the
  // style profile follows the body.
  colorReport?: { data: ColorReport; createdAt: Date } | null
  drape?: DrapeTest | null
  // Free: their face in their best color next to their worst one, from the
  // color analysis. Follows the selfie, like the report.
  drapePreview?: DrapePreview | null
  styleProfile?: { data: StyleProfile; createdAt: Date } | null
  // The visual boards of both reports: one image each, comparing options on
  // the avatar (color boards follow the selfie, style boards the body).
  reportBoards?: Partial<Record<BoardKind, ReportBoard>> | null
  // The Hair studio's read of the selfie (face shape, hair type and the cuts
  // that suit them). Follows the selfie, like the color report.
  hairProfile?: HairProfileState | null
  consentVersion: string
  consentAt: Date
  generations: number
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
  // The account was deleted: every photo and render is gone, files and keys
  // (selfie-type keys left as ''), the colors and reports stay.
  photosDeletedAt?: Date | null
}

export type HairLength = 'short' | 'medium' | 'long'

// One cut picked for the person. `render` is written for the image model;
// `stylistBrief` is what they can show at the salon.
export type HairRecommendation = {
  id: string
  name: string
  length: HairLength
  why: string
  maintenance: 'low' | 'medium' | 'high'
  stylingMinutes: number
  stylistBrief: string
  render: string
}

export type HairProfile = {
  faceShape: string
  faceShapeNote: string
  hairType: { texture: string; density: string; currentLength: HairLength; currentCut: string }
  summary: string
  flatters: string[]
  avoid: string[]
  // Best first: the first one is "your ideal cut".
  recommendations: HairRecommendation[]
}

export type HairProfileState = {
  status: GenerationStatus
  data: HairProfile | null
  error: string | null
  startedAt: Date
  updatedAt: Date
}

// How a haircut the person asked for (not one of the recommendations) works
// for them: 'great', 'good' or 'tricky', and why.
export type HairFit = { verdict: 'great' | 'good' | 'tricky'; note: string }

// One haircut rendered on the person (a chest-up portrait): one of their
// recommendations, a style they described, or one from a photo.
export type HairstyleDocument = {
  _id: ObjectId
  userId: ObjectId
  // Null for a perfect haircut drawn from another photo of hers before any
  // avatar (teasers): a new selfie leaves it.
  avatarId: ObjectId | null
  source: 'recommended' | 'described' | 'photo' | 'preset'
  recommendationId: string | null
  // A cut or color from the presets (hair/presets.ts), and whether it was
  // her free one (FREE_HAIR_PRESETS), given back if it fails.
  presetId?: string | null
  freePreset?: boolean
  name: string
  why: string | null
  stylistBrief: string | null
  fit: HairFit | null
  render: string
  // What they typed, and the photo they uploaded (only its haircut is used).
  request: string | null
  referenceKey: string | null
  status: GenerationStatus
  error: string | null
  imageKey: string | null
  previewKey: string | null
  // What rendering it took, given back if it fails: a look credit (styles
  // they asked for, with Pro) or their free hairstyle.
  creditSpent: boolean
  freeRun: boolean
  // Rendered for a cross-sell email (lifecycle/assets.ts): it took no daily
  // allowance, so a failure gives none back.
  gift?: 'email'
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
  // The account was deleted: its pictures are gone, the haircut stays.
  photosDeletedAt?: Date | null
}

export type ScaleReading = { value: number; label: string }

export type Verdict = 'wear' | 'avoid'

export type TestSwatch = ColorSwatch & { verdict: Verdict }

// A comparison of options near the face or on the body: the insight is the
// headline ("Espresso is your black"), the note explains why.
export type ComparisonTest<T> = { insight: string; note: string; panels: T[] }

export type ColorReport = {
  seasonLean: string
  scales: { undertone: ScaleReading; depth: ScaleReading; chroma: ScaleReading; contrast: ScaleReading }
  palette: { basics: ColorSwatch[]; accents: ColorSwatch[]; statements: ColorSwatch[] }
  combinations: { name: string; occasion: string; colors: ColorSwatch[] }[]
  guides: { title: string; text: string }[]
  avoidAdvice: string
  drape: { wear: ColorSwatch[]; avoid: ColorSwatch[] }
  // Added with the visual report (Sep 2026); older reports lack them.
  coloring?: { skin: string; hair: string; eyes: string }
  signature?: string
  gameChangers?: { title: string; text: string }[]
  neutralsTest?: ComparisonTest<TestSwatch>
  whitesTest?: ComparisonTest<TestSwatch>
  metalsTest?: { best: 'gold' | 'silver' | 'both'; insight: string; note: string }
  faceTest?: ComparisonTest<TestSwatch> & { kind: 'lips' | 'shirts' }
  // 'beard' (menswear) compares facial hair styles instead of hair colors.
  hairTest?: ComparisonTest<TestSwatch> & { current: string; kind?: 'color' | 'beard' }
  paletteLooks?: { name: string; outfit: string }[]
}

export type BoardKind =
  | 'neutrals'
  | 'whites'
  | 'metals'
  | 'face'
  | 'hair'
  | 'palette'
  | 'silhouettes'
  | 'necklines'
  | 'capsule'

// One label per panel, in reading order (left to right, top to bottom).
export type BoardPanel = { label: string; verdict: Verdict | 'current' | null; hex: string | null }

export type ReportBoard = {
  status: GenerationStatus
  key: string | null
  layout: 'grid' | 'pair' | 'single'
  panels: BoardPanel[]
  // What the image shows and what it is drawn from (the face, the full-body
  // avatar, or nothing), kept so a retry renders the same board.
  prompt: string
  refs: 'portrait' | 'body' | 'none'
  size: '1024x1024' | '1536x1024'
  updatedAt: Date
}

// One image of two head-and-shoulders portraits side by side: the best
// color from the free analysis on the left, the worst on the right.
export type DrapePreview = {
  status: GenerationStatus
  key: string | null
  // The same photo with the best colors blurred, for those who haven't
  // unlocked them (LOCK_BEST_COLOR). Made with the photo, or on first view.
  lockedKey?: string | null
  // 'pair': best and worst side by side (the first previews). 'grid': a 2x2
  // of their three best colors and their worst (bottom right).
  layout?: DrapePreviewLayout
  best: ColorSwatch
  // The grid's three best colors, in reading order; best is the first.
  bests?: ColorSwatch[]
  worst: ColorSwatch
  updatedAt: Date
}

export type DrapePreviewLayout = 'pair' | 'grid'

// One image of the avatar with four fabric drapes near the face: two colors
// that flatter, two that don't (top row wear, bottom row avoid).
export type DrapeTest = {
  status: GenerationStatus
  key: string | null
  wear: ColorSwatch[]
  avoid: ColorSwatch[]
  updatedAt: Date
}

export type StyleProfile = {
  archetype: string
  tagline: string
  description: string
  keywords: string[]
  shines: { situation: string; why: string }[]
  adapt: { situation: string; how: string }[]
  silhouettes: { area: string; advice: string }[]
  signaturePieces: { name: string; color: string; colorHex: string; why: string }[]
  capsule: { slot: string; name: string; color: string; colorHex: string; material: string }[]
  skip: string[]
  // Added with the visual report (Sep 2026); older profiles lack them.
  silhouetteTest?: ComparisonTest<{ name: string; garment: string; verdict: Verdict }>
  necklineTest?: ComparisonTest<{ name: string; verdict: Verdict }> & { kind: 'necklines' | 'collars' }
  capsuleNote?: string
}

export type LookAnalysis = {
  dressCodeFit: { score: number; verdict: string }
  paletteHarmony: { score: number; verdict: string }
  flatters: string
  strengths: string[]
  dressUp: string
  dressDown: string
  dayToNight: string
  weather: string
  accessories: string[]
}

export type LookItemSlot =
  | 'top'
  | 'layer'
  | 'outerwear'
  | 'bottom'
  | 'dress'
  | 'suit'
  | 'shoes'
  | 'accessory'
  | 'bag'

export type LookItem = {
  slot: LookItemSlot
  name: string
  color: string
  colorHex: string
  material: string
  fit: string
  // Try-ons: false for pieces the stylist added to complete the outfit.
  fromPhoto?: boolean
}

// One garment of a look, rendered on its own as a product photo (no person),
// so it can be searched in stores.
export type LookPiece = {
  id: string
  slot: LookItemSlot
  name: string
  color: string
  colorHex: string
  material: string
  fit: string
  status: GenerationStatus
  imageKey: string | null
}

export type LookPlan = {
  title: string
  vibe: string
  summary: string
  whyItWorks: string
  items: LookItem[]
  stylingTips: string[]
  // What the look took from the person's taste profile ("Boots over sneakers").
  tasteApplied?: string[]
}

// What someone thought of a look. The aspects read with the rating: 'colors'
// on a thumbs up means they loved the colors, on a thumbs down that the
// colors were off. The last four only come with a thumbs down.
export type FeedbackAspect =
  | 'style'
  | 'colors'
  | 'fit'
  | 'occasion'
  | 'too_formal'
  | 'too_casual'
  | 'missed_request'
  | 'weather'

export type LookFeedback = {
  rating: 'up' | 'down'
  aspects: FeedbackAspect[]
  // Pieces they singled out, by index in plan.items.
  pieces: { index: number; vote: 'up' | 'down' }[]
  note: string | null
  at: Date
}

// 'fix' restyles a look the person disliked, from their feedback.
export type RemixChange = 'colors' | 'season' | 'dressier' | 'casual' | 'occasion' | 'surprise' | 'custom' | 'fix'

// One line of a taste profile. 'you' lines were written by the person and
// are never rewritten; 'learned' lines come from their feedback.
export type TasteNote = {
  id: string
  text: string
  source: 'you' | 'learned'
  // How many looks back a learned line up.
  evidence: number
}

// What the stylist knows about someone's taste, one per user. Learning runs
// in the background after feedback; `dirty` asks for one more pass when
// feedback lands during a run.
export type TasteDocument = {
  _id: ObjectId
  userId: ObjectId
  statement: string | null
  summary: string | null
  loves: TasteNote[]
  avoids: TasteNote[]
  // Learned lines the person removed; learning never brings them back.
  dismissed: string[]
  signals: number
  learning: boolean
  dirty: boolean
  learnedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type LookDocument = {
  _id: ObjectId
  userId: ObjectId
  avatarId: ObjectId
  batchId: ObjectId
  occasion: {
    text: string
    // Their own notes on the brief, kept so remixes and fixes still read them.
    notes?: string | null
    dressCode: string
    summary: string
    // What the stylist understood the person asked for, shown back to them.
    asks?: string[]
  }
  plan: LookPlan
  feedback?: LookFeedback | null
  // A variant of another look ("same style, new colors").
  remixOf?: ObjectId | null
  remix?: { change: RemixChange; detail: string | null } | null
  // 'tryon': rendered from an outfit photo the person uploaded.
  source?: 'stylist' | 'tryon'
  referenceKey?: string | null
  // Try-ons of an icon look (modules/looks/icons.ts): which one.
  iconId?: string | null
  // One of the looks the Event Stylist made for an event (StyleEventDocument).
  eventId?: ObjectId | null
  // Made for them for a cross-sell email (lifecycle/assets.ts), free: no
  // credit and no daily allowance taken.
  gift?: 'email'
  // 'locked': a look the stylist designed past the person's last credit,
  // shown with its pieces but not drawn until they unlock it.
  status: GenerationStatus | 'locked'
  error: string | null
  imageKey: string | null
  previewKey?: string | null
  // A locked look drawn ahead of time: the picture waits in `key` (never
  // sent) and only a blurred copy (`lockedKey`) shows, so the look is ready
  // the moment they unlock it.
  teaser?: { status: GenerationStatus; key: string | null; lockedKey: string | null } | null
  // Whether rendering this look took a credit (refunded if it fails).
  creditSpent?: boolean
  // A collection look tried on free, without Pro (given back if it fails).
  freeTryOn?: boolean
  // The Edit whose free try-on it was (given back if it fails).
  freeEditId?: string
  // Free fixes (looks/fixes.ts): when this look's free fix was taken, how
  // many free fixes in a row led to it, and whether it is one (its retry
  // is free too).
  freeFixAt?: Date | null
  freeFixes?: number
  freeFix?: boolean
  analysis?: { data: LookAnalysis; createdAt: Date } | null
  pieces?: LookPiece[]
  collectionIds: ObjectId[]
  favorite: boolean
  createdAt: Date
  updatedAt: Date
  // When its render last started, if not at creation (a retry or unlock).
  renderStartedAt?: Date | null
  readyAt: Date | null
  // The account was deleted: its pictures are gone, the look stays.
  photosDeletedAt?: Date | null
}

// The Event Stylist: three looks for one event (a wedding, an interview, a
// date) with its dress code, pieces to buy in stores, and how to finish it
// (hair, makeup or grooming, accessories, a checklist).
export type EventBudget = 'save' | 'mid' | 'splurge'

export type EventPrep = {
  hair: string
  face: string
  accessories: string
  checklist: string[]
}

export type StyleEventDocument = {
  _id: ObjectId
  userId: ObjectId
  batchId: ObjectId
  occasion: string
  // The day as they picked it (YYYY-MM-DD), or null.
  date: string | null
  budget: EventBudget
  notes: string | null
  dressCode: string
  summary: string
  prep: { status: GenerationStatus; data: EventPrep | null }
  // How it was paid: a pass, three Pro looks, or a comp account.
  via: 'pass' | 'pro' | 'comp'
  createdAt: Date
  updatedAt: Date
}

// The personal magazine's words and shots, planned once (modules/magazine).
export type MagazineShot = { location: string; outfit: string; pose: string }

export type MagazinePlan = {
  theme: string
  coverLines: string[]
  letter: string
  archetype: string
  shape: string
  cover: MagazineShot
  looks: (MagazineShot & { kicker: string; headline: string; copy: string; pieces: string[] })[]
}

export type MagazinePhoto = { status: GenerationStatus; key: string | null }

// A personal magazine: a cover, a letter and up to ten looks on location,
// all on their own avatar. Paid with a magazine credit (or a comp account).
export type MagazineDocument = {
  _id: ObjectId
  userId: ObjectId
  status: GenerationStatus
  moments: string[]
  season: string
  palette: ColorSwatch[]
  plan: MagazinePlan | null
  // The cover (with room above the head for the masthead), then one per look.
  cover: MagazinePhoto
  looks: MagazinePhoto[]
  via: 'credit' | 'comp'
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
  // The account was deleted: its pictures are gone, the words stay.
  photosDeletedAt?: Date | null
}

// The Outfit Formula Book: one paid checkout, with or without an account. The
// token is the buyer's download link (emailed and shown after paying).
export type GuideOrderDocument = {
  _id: ObjectId
  sessionId: string
  email: string | null
  userId: ObjectId | null
  token: string
  amount: number
  currency: string
  emailedAt: Date | null
  downloads: number
  lastDownloadAt: Date | null
  createdAt: Date
  // Since Oct 2026: the payment (for a refund, guests included), the terms
  // accepted at checkout, and the refund, after which the link stops.
  // The refund link's key is its own (refundToken), not the download's, so a
  // forwarded download link can't ask for the order's refund.
  refundToken?: string
  paymentIntentId?: string | null
  terms?: 'accepted' | null
  // As on purchases: the card's country, looked up once (refund requests).
  cardCountry?: string | null
  refundedAt?: Date | null
  refund?: {
    source: 'app' | 'stripe' | 'admin'
    requestId?: ObjectId | null
    reason: RefundReason | null
    amount: number
    stripeRefundId: string | null
  } | null
}

export type CollectionDocument = {
  _id: ObjectId
  userId: ObjectId
  name: string
  createdAt: Date
  updatedAt: Date
}

// 'image': every new AI picture of the day across looks, hairstyles, avatar
// renders, makeup and color checks (AI_DAILY_IMAGE_LIMIT, utils/usage.ts).
// 'score': Look Score and Hair Score reads (text); 'makeup': makeup renders.
export type UsageKind = 'avatar' | 'look' | 'pieces' | 'shop' | 'report' | 'hair' | 'image' | 'score' | 'makeup'

export type UsageCounterDocument = {
  _id: string
  userId: ObjectId
  kind: UsageKind
  day: string
  count: number
  expireAt: Date
}

export type ShopMatch = {
  title: string
  link: string
  domain: string
  source: string
  sourceIcon: string | null
  thumbnail: string | null
  price: string | null
  extractedPrice: number | null
  currency: string | null
  inStock: boolean | null
}

// Store matches for one piece in one market, cached so "show more" pages
// through what we already paid for before running another search.
export type ShopSearchDocument = {
  _id: ObjectId
  userId: ObjectId
  lookId: ObjectId
  pieceId: string
  market: string
  results: ShopMatch[]
  // How many of the search passes (see shop/serpapi.ts) have run.
  passes: number
  exhausted: boolean
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
}

// One answer to a studio question (modules/survey): why they came, what held
// them back from an offer, what convinced them to pay. Deleted with the
// account.
export type SurveyAnswerDocument = {
  _id: ObjectId
  userId: ObjectId
  question: string
  answer: string
  // Only for "other": what they typed, short.
  note: string | null
  // Where it was asked: the offer's kind and placement, the flow, the product.
  context: Record<string, string>
  // Their first touch at the time, to read answers by campaign.
  content: string | null
  createdAt: Date
}

// The paid advisors rated at the end of their report (modules/feedback).
export type FeedbackProduct = 'color_advisor' | 'style_advisor' | 'hair_advisor'

// How likely they'd recommend a paid advisor (0–10, the NPS question) and
// the review they wrote, at the end of its report. One per person and
// advisor (a new answer replaces it); deleted with the account's content.
export type FeedbackDocument = {
  _id: ObjectId
  userId: ObjectId
  product: FeedbackProduct
  score: number
  comment: string | null
  // They agreed Avarobe may quote the review, with their first name only.
  quoteOk: boolean
  locale: string
  region: string
  // On Pro (or comp) when they answered, rather than a one-time purchase.
  pro: boolean
  // Their first touch, to read answers by campaign.
  content: string | null
  createdAt: Date
  updatedAt: Date
}

export type ProHalfOffer = {
  // The advisor whose rating brought it, or (Oct 18, 2026) her first read
  // of a studio (Face Age, Look Score, Hair Score), the moment she sees it,
  // or her first free try-on of an Edit, or (Oct 19) her colors, when she
  // came from a colors_pro campaign.
  from: FeedbackProduct | 'face_age' | 'look_score' | 'hair_score' | 'edit_try_on' | 'colors'
  at: Date
  until: Date
  // Paid with it (the first month at half price).
  usedAt: Date | null
}

// "Does this color suit me?" (modules/check): a garment photo they uploaded,
// read against their colors, and that color drawn next to their face.
export type ColorCheckDocument = {
  _id: ObjectId
  userId: ObjectId
  status: GenerationStatus
  error: string | null
  // What they uploaded: never shown to anyone else or shared.
  garmentKey: string
  // Their face with the garment's color, or (the full read, with an avatar)
  // them wearing it head to toe: shareable.
  imageKey: string | null
  // The full read: why it works or not from every angle (Pro, and everyone's
  // first check). Older checks lack these.
  deep?: boolean
  imageKind?: 'drape' | 'avatar' | null
  reading: {
    garment: string
    color: { name: string; hex: string }
    verdict: 'wear' | 'away' | 'avoid' | 'unclear'
    reason: string
    alternatives: { name: string; hex: string }[]
    deep?: {
      overall: 'yes' | 'depends' | 'no'
      headline: string
      summary: string
      angles: { key: 'color' | 'cut' | 'style' | 'versatility' | 'occasions'; verdict: 'good' | 'mixed' | 'poor'; note: string }[]
      whyYes: string[]
      whyNot: string[]
      makeItWork: string[]
      wearWith: { name: string; hex: string }[]
      complete: string[]
    }
  } | null
  createdAt: Date
  updatedAt: Date
  // The account was deleted: both pictures are gone (garmentKey ''), the
  // reading stays.
  photosDeletedAt?: Date | null
}

// Face Age (modules/look): one face photo she added (today's selfie or an
// old photo, dated when it was taken) and what the AI read in it. Her
// photos never leave her account, are never matched against each other
// (no face recognition, no faceprints) and go entirely when she deletes
// them, Face Age or her account.
export type FaceCheckDocument = {
  _id: ObjectId
  userId: ObjectId
  status: GenerationStatus
  error: string | null
  photoKey: string
  // The day the photo is from: today for a new one; for an old photo, its
  // camera date or the month she picked.
  takenAt: Date
  source: 'camera' | 'upload' | 'import'
  dateSource: 'now' | 'exif' | 'chosen'
  reading: FaceReading | null
  createdAt: Date
  updatedAt: Date
}

export type FaceTipArea = 'color' | 'hair' | 'makeup' | 'brows' | 'skin' | 'glasses' | 'light' | 'expression'

export type FaceReading = {
  // false: no face, more than one, someone under 18, or too dark or blurry
  // to read; the photo is deleted and the check fails with `problem`.
  usable: boolean
  problem: 'no_face' | 'several_faces' | 'minor' | 'too_dark' | 'too_blurry' | null
  // The model's estimate, as is. What she sees is calibrated (look/age.ts).
  apparentAge: number
  // Years the tips could realistically take off (0–8).
  potentialYears: number
  headline: string
  // What reads fresh and youthful in this photo.
  strengths: string[]
  // What adds years in this photo, kindly said.
  agingFactors: string[]
  tips: { area: FaceTipArea; text: string }[]
  // The conditions, which move the estimate by a few years.
  photo: { light: 'good' | 'dim' | 'harsh'; glasses: boolean; makeup: 'none' | 'light' | 'full'; expression: 'neutral' | 'smile' | 'other'; angle: 'front' | 'tilted' }
}

// A makeup preset tried on her (modules/makeup): a close portrait of her
// from her selfie (and avatar, when she has one), only the makeup changed.
export type MakeupTryOnDocument = {
  _id: ObjectId
  userId: ObjectId
  // The avatar it was drawn from, or null (selfie only, before an avatar).
  avatarId: ObjectId | null
  // The selfie it was drawn from: a new selfie makes these stale.
  selfieKey: string
  presetId: string
  name: string
  render: string
  status: GenerationStatus
  error: string | null
  imageKey: string | null
  previewKey: string | null
  // What it took, given back if it fails: a look credit (Pro) or her free
  // makeup try-on (FREE_MAKEUP_TRY_ONS).
  creditSpent: boolean
  freeUse: boolean
  createdAt: Date
  updatedAt: Date
  readyAt: Date | null
  photosDeletedAt?: Date | null
}

// A result drawn ahead of time and shown blurred to someone without Pro
// (modules/teasers; Oct 18, 2026): her perfect haircut after a Hair Score
// or a Color Advisor, her perfect look after a Look Score, her best face
// after a Face Age read. With Pro it's unlocked at once (no credit) and
// becomes her own haircut, look or makeup try-on.
export type TeaserKind = 'perfect_haircut' | 'perfect_look' | 'best_face'

export type TeaserDocument = {
  _id: ObjectId
  userId: ObjectId
  kind: TeaserKind
  // What it was made from: a score check, a Face Age check or a purchase.
  sourceId: ObjectId
  status: GenerationStatus
  error: string | null
  // The picture (never sent while locked) and its blurred copy.
  key: string | null
  lockedKey: string | null
  plan: {
    name: string
    render: string
    stylistBrief?: string | null
    fit?: HairFit | null
    look?: LookPlan | null
    dressCode?: string | null
  } | null
  avatarId: ObjectId | null
  selfieKey: string | null
  // Pro unlocked it (while it drew, it's handed over when it's done), and
  // the haircut, look or makeup try-on it became.
  unlockedAt: Date | null
  resultId: ObjectId | null
  createdAt: Date
  updatedAt: Date
}

export type ScoreKind = 'look' | 'hair'

// Look Score / Hair Score (modules/scores): one photo she added (a full-body
// photo of her outfit, or of her hair) and the score read in it. Like Face
// Age's photos: never matched against each other (no face recognition),
// gone when she deletes them, the scores or her account.
export type ScoreCheckDocument = {
  _id: ObjectId
  userId: ObjectId
  kind: ScoreKind
  status: GenerationStatus
  error: string | null
  photoKey: string
  // The normalized photo's sha256 and a 64-bit difference hash, so the
  // same photo again returns its read instead of a new one.
  photoHash: string
  photoDHash: string
  takenAt: Date
  source: 'camera' | 'upload'
  dateSource: 'now' | 'exif'
  // Whether it was one of her free photos (SCORE_FREE_PHOTOS), given back
  // if it can't be read.
  freeUse: boolean
  reading: ScoreReading | null
  // "See it fixed" (looks): the look drawn from it with the tips applied.
  fixLookId?: ObjectId | null
  // "Unlock your perfect haircut" (hair, Pro): the haircut drawn from it.
  perfectHairstyleId?: ObjectId | null
  createdAt: Date
  updatedAt: Date
}

export type ScoreProblem = 'no_person' | 'several_people' | 'minor' | 'too_dark' | 'too_blurry' | 'not_full_body' | 'hair_not_visible'

export type ScoreReading = {
  usable: boolean
  problem: ScoreProblem | null
  // Each criterion 0–4 (scores/rubrics.ts), averaged over the samples.
  criteria: Record<string, number>
  samples: number
  // 1–100, computed in code from the criteria (scores/score.ts).
  score: number
  headline: string
  strengths: string[]
  holdingBack: string[]
  tips: { area: string; criterion: string; text: string }[]
  photo: { light: 'good' | 'dim' | 'harsh'; framing: 'good' | 'partial' }
  rubricVersion: string
  model: string
}

// Operations alerts to the founder (modules/ops/alerts.ts), one document per
// kind: when it last went out (at most one an hour, across restarts), and
// since when the trouble is open (null once reads work again).
export type OpsAlertDocument = {
  _id: 'openai_account' | 'reads_failing'
  lastSentAt: Date
  openSince: Date | null
  lastError: string | null
}
