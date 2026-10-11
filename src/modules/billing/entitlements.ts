import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import { limitMessages } from '../../i18n/limits.js'
import type { ProSubscription, UserDocument } from '../../types/mongo.js'
import { toObjectId } from '../../utils/object-id.js'
import { timeZoneFor } from '../../utils/timezones.js'
import { trackServerEvent } from '../analytics/service.js'
import { type Currency, type PricingRegion, REGION_CURRENCY, regionalAmount, regionForCountry } from './pricing.js'

// What a person can do. Free: the avatar (FREE_AVATAR_RUNS renders), their
// season, a few colors and their best and worst color on their face, and
// their sign-up looks (SIGNUP_CREDITS; FREE_CREDITS for older accounts). The
// Color Advisor unlocks the full palette and the visual color report; the
// Style Advisor, the style profile. Pro (monthly, annual, or its first-time
// trial) adds looks every month, both reports while it lasts and the tools:
// try-ons, pieces and stores, the look analysis and more avatar changes; the
// annual plan keeps the reports for good. Looks, remixes and try-ons spend
// one credit each; look packs add credits that never expire.
//
// Hair studio: the read of their hair and the ideal cut on them are free
// (FREE_HAIR_RUNS renders). Every recommended cut on them comes with the
// Hair & Grooming Advisor (with the Style Advisor until Oct 2026) or Pro; a
// haircut they describe or bring in a photo is a Pro try-on and spends a
// credit.
//
// The Event Stylist: three looks for one event, with pieces in stores and how
// to finish them. An event takes a pass (event_pass) or, on Pro, three of the
// month's looks.

export type PaywallCode =
  | 'needs_pro'
  | 'needs_color_report'
  | 'needs_style_report'
  | 'needs_hair'
  | 'needs_event'
  | 'needs_magazine'
  | 'no_credits'

export class PaywallError extends Error {
  constructor(
    readonly code: PaywallCode,
    message: string,
  ) {
    super(message)
  }
}

const compEmails = () =>
  new Set(
    env.COMP_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )

type BillingFields = Pick<
  UserDocument,
  | 'email'
  | 'credits'
  | 'colorReportAt'
  | 'styleReportAt'
  | 'colorMirrorAt'
  | 'hairAdvisorAt'
  | 'styleWithoutHair'
  | 'eventCredits'
  | 'magazineCredits'
  | 'pro'
  | 'styleKitUntil'
  | 'paidAt'
  | 'freeAvatarRuns'
  | 'freeHairRuns'
  | 'compPaused'
  | 'proTrialAt'
  | 'guest'
  | 'locale'
  | 'location'
>

export function isAdmin(user: Pick<UserDocument, 'email'>) {
  return compEmails().has(user.email.toLowerCase())
}

// Admin accounts, to leave them out of numbers and reviews.
export async function adminUserIds(app: FastifyInstance): Promise<ObjectId[]> {
  const users = await app.collections.users
    .find({ email: { $in: [...compEmails()] } }, { projection: { _id: 1 } })
    .toArray()

  return users.map((user) => user._id)
}

const DAY_MS = 24 * 60 * 60 * 1000
// A failed renewal gets a few days while Stripe retries the card.
export const PRO_GRACE_MS = 3 * DAY_MS
export const PRO_LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function proIsLive(pro: UserDocument['pro'], now = Date.now()) {
  return Boolean(pro && PRO_LIVE_STATUSES.has(pro.status) && pro.periodEnd && pro.periodEnd.getTime() + PRO_GRACE_MS > now)
}

// Pro's avatar renders a month (PRO_AVATAR_RUNS_PER_MONTH, since Oct 2026).
// A subscription paid before the cap (no avatarCap mark) keeps unlimited
// renders until its next payment, unless PRO_AVATAR_GRANDFATHER is off.
export function avatarCapExempt(pro: Pick<ProSubscription, 'avatarCap'>) {
  return env.PRO_AVATAR_GRANDFATHER && pro.avatarCap !== true
}

// When a Pro month's avatar renders start over: the trial's end (its first
// payment), annual's next monthly drop, a monthly plan's next payment.
export function avatarRunsResetAt(pro: Pick<ProSubscription, 'status' | 'interval' | 'periodEnd' | 'nextCreditsAt' | 'trialEnd'>) {
  if (pro.status === 'trialing') {
    return pro.trialEnd ?? pro.periodEnd
  }

  if (pro.interval === 'year' && pro.nextCreditsAt) {
    return pro.periodEnd && pro.periodEnd.getTime() < pro.nextCreditsAt.getTime() ? pro.periodEnd : pro.nextCreditsAt
  }

  return pro.periodEnd
}

// Annual's first payment: how many looks come right away and how many are
// held for PRO_ANNUAL_FIRST_WEEK_DAYS (none held when the setting is at or
// above the month's looks).
export function annualFirstWeek() {
  const now = Math.min(env.PRO_ANNUAL_FIRST_WEEK_CREDITS, env.PRO_MONTHLY_CREDITS)
  const held = env.PRO_MONTHLY_CREDITS - now

  return held > 0 ? { now, held, days: env.PRO_ANNUAL_FIRST_WEEK_DAYS } : null
}

// Add-on prices: the other report at what completes the bundle.
export const colorAddonCents = () => Math.max(50, env.PRICE_REPORTS_BUNDLE_CENTS - env.PRICE_STYLE_REPORT_CENTS)
export const styleAddonCents = () => Math.max(50, env.PRICE_REPORTS_BUNDLE_CENTS - env.PRICE_COLOR_REPORT_CENTS)

// Reports bought in the last days (REPORT_CREDIT_WINDOW_DAYS) count toward
// Pro annual, which includes them, up to the bundle price: in the prices and
// currency of the buyer's region, as checkout takes it off (a one-time
// coupon) and as every offer of it shows it. None on Pro.
// `region`: whose prices it's in (where they signed up), so the web only
// takes it off an offer in the same prices.
export type ReportCredit = { amount: number; currency: Currency; region: PricingRegion; from: ('color' | 'style')[]; until: Date }

export function reportCreditFor(
  user: Pick<UserDocument, 'colorReportAt' | 'styleReportAt' | 'pro'>,
  region: PricingRegion,
  now = Date.now(),
): ReportCredit | null {
  if (proIsLive(user.pro ?? null, now)) {
    return null
  }

  const windowMs = env.REPORT_CREDIT_WINDOW_DAYS * DAY_MS
  const within = (at: Date | null | undefined) => (at && at.getTime() + windowMs > now ? new Date(at.getTime() + windowMs) : null)
  const color = within(user.colorReportAt)
  const style = within(user.styleReportAt)
  const amount = Math.min(
    regionalAmount('reports_bundle', region),
    (color ? regionalAmount('color_report', region) : 0) + (style ? regionalAmount('style_report', region) : 0),
  )

  if (amount <= 0) {
    return null
  }

  const until = color && style ? new Date(Math.min(color.getTime(), style.getTime())) : (color ?? style)!

  return {
    amount,
    currency: REGION_CURRENCY[region],
    region,
    from: [...(color ? ['color' as const] : []), ...(style ? ['style' as const] : [])],
    until,
  }
}

// `region`: where they pay (where they signed up), for the report credit.
export function billingState(user: BillingFields, now = Date.now(), region: PricingRegion = regionForCountry(user.location?.country)) {
  const admin = isAdmin(user)
  // An admin can switch the free access off to see the app as a customer does.
  const comp = admin && !user.compPaused
  const pro = user.pro ?? null
  const proLive = proIsLive(pro, now)
  const legacyKit = Boolean(user.styleKitUntil && user.styleKitUntil.getTime() > now)
  const proActive = comp || proLive || legacyKit
  const colorReportAt = user.colorReportAt ?? null
  const styleReportAt = user.styleReportAt ?? null
  // Pro includes both reports while it lasts; bought ones are for good. The
  // color mirror sold on its own for a day (1-Oct-2026) and now comes with the
  // Color Advisor, so either purchase unlocks both.
  const colorReport = proActive || Boolean(colorReportAt || user.colorMirrorAt)
  const styleReport = proActive || Boolean(styleReportAt)
  const colorMirror = colorReport
  const hairAdvisor = proActive || Boolean(user.hairAdvisorAt) || Boolean(styleReportAt && !user.styleWithoutHair)
  const windowMs = env.REPORT_CREDIT_WINDOW_DAYS * DAY_MS
  const within = (at: Date | null) => (at && at.getTime() + windowMs > now ? new Date(at.getTime() + windowMs) : null)
  const colorRecent = within(colorReportAt)
  const styleRecent = within(styleReportAt)
  // Reports bought in the last days count toward Pro annual (which includes
  // them), up to the bundle price. In US cents here (reportCredit has the
  // buyer's own prices).
  const reportCreditCents = proLive
    ? 0
    : Math.min(
        env.PRICE_REPORTS_BUNDLE_CENTS,
        (colorRecent ? env.PRICE_COLOR_REPORT_CENTS : 0) + (styleRecent ? env.PRICE_STYLE_REPORT_CENTS : 0),
      )
  const reportCreditUntil =
    colorRecent && styleRecent ? new Date(Math.min(colorRecent.getTime(), styleRecent.getTime())) : (colorRecent ?? styleRecent)

  return {
    admin,
    comp,
    pro,
    proLive,
    proActive,
    proInterval: proLive && pro ? pro.interval : null,
    trialing: proLive && pro?.status === 'trialing',
    // The first-time offer, while PRO_TRIAL is on: never had a subscription,
    // not even a trial.
    trialEligible: env.PRO_TRIAL && !comp && !pro && !user.proTrialAt,
    colorReport,
    styleReport,
    colorMirror,
    hairAdvisor,
    eventCredits: user.eventCredits ?? 0,
    magazineCredits: user.magazineCredits ?? 0,
    // Completing the pair at the bundle price, soon after buying one report.
    colorAddonUntil: !colorReport && styleRecent ? styleRecent : null,
    styleAddonUntil: !styleReport && colorRecent ? colorRecent : null,
    reportCreditCents,
    reportCreditUntil: reportCreditCents > 0 ? reportCreditUntil : null,
    reportCredit: reportCreditFor(user, region, now),
    // Bought anything, ever (reports, a look pack or Pro).
    paid: Boolean(user.paidAt || colorReportAt || styleReportAt || user.colorMirrorAt || user.hairAdvisorAt || pro || user.styleKitUntil),
    credits: user.credits ?? env.FREE_CREDITS,
    freeAvatarRunsLeft: proActive ? null : Math.max(0, env.FREE_AVATAR_RUNS - (user.freeAvatarRuns ?? 0)),
    // Pro's avatar renders this month; null where there's no cap (comp, a
    // subscription from before it, the legacy kit, no Pro).
    proAvatarRuns:
      proLive && pro && !comp && !avatarCapExempt(pro)
        ? {
            used: Math.min(pro.avatarRuns ?? 0, env.PRO_AVATAR_RUNS_PER_MONTH),
            left: Math.max(0, env.PRO_AVATAR_RUNS_PER_MONTH - (pro.avatarRuns ?? 0)),
            limit: env.PRO_AVATAR_RUNS_PER_MONTH,
            resetsAt: avatarRunsResetAt(pro),
          }
        : null,
    // Every recommended haircut on them; otherwise the free one(s).
    hairCuts: hairAdvisor,
    freeHairRunsLeft: hairAdvisor ? null : Math.max(0, env.FREE_HAIR_RUNS - (user.freeHairRuns ?? 0)),
  }
}

export function serializeBilling(user: BillingFields) {
  const state = billingState(user)
  const iso = (date: Date | null | undefined) => date?.toISOString() ?? null

  return {
    proActive: state.proActive,
    pro: state.pro
      ? {
          active: state.proLive,
          interval: state.pro.interval,
          status: state.pro.status,
          periodEnd: iso(state.pro.periodEnd),
          cancelAtPeriodEnd: state.pro.cancelAtPeriodEnd,
          trialEnd: state.trialing ? iso(state.pro.trialEnd ?? state.pro.periodEnd) : null,
          // Annual: the next monthly looks, and the first month's rest while
          // it's held (PRO_ANNUAL_FIRST_WEEK_DAYS after the first payment).
          nextCreditsAt: iso(state.pro.nextCreditsAt),
          heldCredits: state.pro.heldCredits ? { amount: state.pro.heldCredits.amount, at: iso(state.pro.heldCredits.at) } : null,
        }
      : null,
    colorReport: state.colorReport,
    styleReport: state.styleReport,
    colorMirror: state.colorMirror,
    hairAdvisor: state.hairAdvisor,
    eventCredits: state.eventCredits,
    magazineCredits: state.magazineCredits,
    colorAddonUntil: iso(state.colorAddonUntil),
    styleAddonUntil: iso(state.styleAddonUntil),
    // In the buyer's currency and prices (until Oct 2026 this was US cents,
    // which the web took off the local price).
    reportCredit: state.reportCredit
      ? {
          amount: state.reportCredit.amount,
          currency: state.reportCredit.currency,
          region: state.reportCredit.region,
          from: state.reportCredit.from,
          until: iso(state.reportCredit.until),
        }
      : null,
    trialEligible: state.trialEligible,
    paid: state.paid,
    credits: state.credits,
    unlimited: state.comp,
    freeAvatarRunsLeft: state.freeAvatarRunsLeft,
    proAvatarRuns: state.proAvatarRuns
      ? { left: state.proAvatarRuns.left, limit: state.proAvatarRuns.limit, resetsAt: iso(state.proAvatarRuns.resetsAt) }
      : null,
    hairCuts: state.hairCuts,
    freeHairRunsLeft: state.freeHairRunsLeft,
    admin: state.admin,
    testingAsCustomer: state.admin && !state.comp,
  }
}

export const BILLING_PROJECTION = {
  email: 1,
  credits: 1,
  colorReportAt: 1,
  styleReportAt: 1,
  colorMirrorAt: 1,
  hairAdvisorAt: 1,
  styleWithoutHair: 1,
  eventCredits: 1,
  magazineCredits: 1,
  pro: 1,
  styleKitUntil: 1,
  paidAt: 1,
  freeAvatarRuns: 1,
  freeHairRuns: 1,
  compPaused: 1,
  proTrialAt: 1,
  guest: 1,
  locale: 1,
  location: 1,
}

export async function loadBillingUser(app: FastifyInstance, userId: ObjectId) {
  return app.collections.users.findOne({ _id: userId }, { projection: BILLING_PROJECTION })
}

async function loadState(app: FastifyInstance, userId: ObjectId) {
  const user = await loadBillingUser(app, userId)

  if (!user) {
    throw new PaywallError('needs_pro', 'Sign in again to continue.')
  }

  return billingState(user)
}

export async function hasPro(app: FastifyInstance, userId: ObjectId) {
  return (await loadState(app, userId)).proActive
}

export async function requirePro(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasPro(app, userId))) {
    throw new PaywallError('needs_pro', `${feature} comes with Avarobe Pro.`)
  }
}

// The full palette and the visual color report.
export async function hasColorReport(app: FastifyInstance, userId: ObjectId) {
  return (await loadState(app, userId)).colorReport
}

// What of their colors the avatar can show: the full palette (Color Advisor)
// and the color mirror's colors (Color Mirror).
export async function paletteAccess(app: FastifyInstance, userId: ObjectId) {
  const state = await loadState(app, userId)
  return { fullPalette: state.colorReport, mirror: state.colorMirror }
}

export async function requireColorReport(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasColorReport(app, userId))) {
    throw new PaywallError('needs_color_report', `${feature} comes with your Color Advisor.`)
  }
}

// The style profile and its boards.
export async function hasStyleReport(app: FastifyInstance, userId: ObjectId) {
  return (await loadState(app, userId)).styleReport
}

export async function requireStyleReport(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasStyleReport(app, userId))) {
    throw new PaywallError('needs_style_report', `${feature} comes with your Style Advisor.`)
  }
}

// Takes `amount` credits atomically. Returns whether credits were actually
// spent (comp accounts don't spend), so failures know whether to refund.
export async function spendCredits(app: FastifyInstance, userId: ObjectId, amount: number) {
  if ((await loadState(app, userId)).comp) {
    return false
  }

  await app.collections.users.updateOne(
    { _id: userId, credits: { $exists: false } },
    { $set: { credits: env.FREE_CREDITS } },
  )

  const result = await app.collections.users.updateOne(
    { _id: userId, credits: { $gte: amount } },
    { $inc: { credits: -amount }, $set: { updatedAt: new Date() } },
  )

  if (result.modifiedCount === 0) {
    const user = await loadBillingUser(app, userId)

    if (!user) {
      throw new PaywallError('needs_pro', 'Sign in again to continue.')
    }

    const { proActive, proLive, pro, trialing, paid, credits } = billingState(user)
    const left = `${credits} look${credits === 1 ? '' : 's'} left`
    // Annual's first week: the rest of the month's looks are on their way,
    // said whether none are left or just fewer than this needs.
    const held = proLive && pro?.heldCredits && pro.heldCredits.at.getTime() > Date.now() ? pro.heldCredits : null

    if (held) {
      void trackServerEvent(app, { name: 'usage_cap_hit', userId, props: { cap: 'held_credits', route: '' } })
      throw new PaywallError(
        'no_credits',
        limitMessages(undefined, timeZoneFor(user.location)).held(env.PRO_ANNUAL_FIRST_WEEK_CREDITS, held.amount, held.at, credits),
      )
    }

    throw new PaywallError(
      'no_credits',
      credits > 0
        ? `You have ${left}. Ask for fewer, or add more looks.`
        : trialing
          ? 'You’ve used your trial looks. Start Pro now or add a look pack to keep styling.'
          : proActive
            ? 'You’ve used this month’s looks. Add a look pack to keep styling.'
            : paid
              ? 'You’re out of looks. Go Pro or add a look pack to keep styling.'
              : 'You’ve used your free looks. Go Pro or add a look pack to keep styling.',
    )
  }

  return true
}

export async function refundCredits(app: FastifyInstance, userId: ObjectId, amount: number) {
  if (amount > 0) {
    await app.collections.users.updateOne({ _id: userId }, { $inc: { credits: amount } })
  }
}

// What an avatar render took: nothing on a comp account or a subscription
// from before the cap ('exempt'), one of the Pro month's renders ('pro'), or
// one of the free ones ('free').
export type AvatarRun = 'comp' | 'free' | 'pro' | 'exempt'

// The Pro month's avatar renders are used up: back on `resetsAt`. Not an
// offer (they already have Pro), so routes answer 429, not 402.
export class AvatarCapError extends Error {
  constructor(
    readonly limit: number,
    readonly resetsAt: Date | null,
    timeZone?: string,
  ) {
    super(limitMessages(undefined, timeZone).avatarMonth(limit, resetsAt))
  }
}

// Avatar renders are free up to FREE_AVATAR_RUNS; Pro gives
// PRO_AVATAR_RUNS_PER_MONTH a month (unlimited for a subscription from
// before the cap, see avatarCapExempt).
export async function useAvatarRun(app: FastifyInstance, userId: ObjectId): Promise<AvatarRun> {
  const user = await loadBillingUser(app, userId)

  if (!user) {
    throw new PaywallError('needs_pro', 'Sign in again to continue.')
  }

  const state = billingState(user)

  if (state.comp) {
    return 'comp'
  }

  if (state.proLive && state.pro) {
    if (!state.proAvatarRuns) {
      return 'exempt'
    }

    const limit = env.PRO_AVATAR_RUNS_PER_MONTH
    const taken = await app.collections.users.updateOne(
      {
        _id: userId,
        'pro.subscriptionId': state.pro.subscriptionId,
        $or: [{ 'pro.avatarRuns': { $exists: false } }, { 'pro.avatarRuns': { $lt: limit } }],
      },
      { $inc: { 'pro.avatarRuns': 1 } },
    )

    if (taken.modifiedCount === 0) {
      throw new AvatarCapError(limit, state.proAvatarRuns.resetsAt, timeZoneFor(user.location))
    }

    return 'pro'
  }

  // The legacy Style Kit.
  if (state.proActive) {
    return 'exempt'
  }

  const result = await app.collections.users.updateOne(
    {
      _id: userId,
      $or: [{ freeAvatarRuns: { $exists: false } }, { freeAvatarRuns: { $lt: env.FREE_AVATAR_RUNS } }],
    },
    { $inc: { freeAvatarRuns: 1 } },
  )

  if (result.modifiedCount === 0) {
    throw new PaywallError('needs_pro', 'More avatar changes come with Avarobe Pro.')
  }

  return 'free'
}

// A render that failed on our side gives the Pro month's render back (free
// ones stay used, as always).
export async function releaseAvatarRun(app: FastifyInstance, userId: ObjectId, run: AvatarRun | null | undefined) {
  if (run === 'pro') {
    await app.collections.users.updateOne({ _id: userId, 'pro.avatarRuns': { $gt: 0 } }, { $inc: { 'pro.avatarRuns': -1 } })
  }
}

// The 429 for a Pro month's avatar renders, counted for the admin.
export function sendAvatarCap(reply: FastifyReply, error: AvatarCapError) {
  void trackServerEvent(reply.server, {
    name: 'usage_cap_hit',
    userId: toObjectId(reply.request.authUserId),
    props: { cap: 'avatar_month', route: reply.request.routeOptions.url ?? '' },
  })

  return reply.code(429).send({
    code: 'avatar_monthly_limit',
    message: error.message,
    limit: error.limit,
    resetsAt: error.resetsAt?.toISOString() ?? null,
  })
}

// One recommended haircut on the person: free with the Style Advisor or Pro,
// otherwise their free hairstyle (FREE_HAIR_RUNS). Returns whether a free
// run was used, so a failed render can give it back.
export async function useHairRun(app: FastifyInstance, userId: ObjectId) {
  if ((await loadState(app, userId)).hairCuts) {
    return false
  }

  const result = await app.collections.users.updateOne(
    {
      _id: userId,
      $or: [{ freeHairRuns: { $exists: false } }, { freeHairRuns: { $lt: env.FREE_HAIR_RUNS } }],
    },
    { $inc: { freeHairRuns: 1 } },
  )

  if (result.modifiedCount === 0) {
    throw new PaywallError('needs_hair', 'All your recommended cuts, shown on you, come with the Hair & Grooming Advisor or Pro.')
  }

  return true
}

// The hair colors (or facial hair) on them: the Hair & Grooming Advisor; the
// Color Advisor shows the same board with the rest of its colors.
export async function requireHairAdvisor(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await loadState(app, userId)).hairAdvisor) {
    throw new PaywallError('needs_hair', `${feature} comes with your Hair & Grooming Advisor.`)
  }
}

export type EventAccess = 'comp' | 'pass' | 'pro'

export const EVENT_LOOKS = 3

// What one event takes: nothing on a comp account, else a pass if they have
// one, else three looks on Pro. Throws the Event Stylist offer otherwise.
export async function useEventAccess(app: FastifyInstance, userId: ObjectId): Promise<EventAccess> {
  const state = await loadState(app, userId)

  if (state.comp) {
    return 'comp'
  }

  const pass = await app.collections.users.updateOne(
    { _id: userId, eventCredits: { $gte: 1 } },
    { $inc: { eventCredits: -1 }, $set: { updatedAt: new Date() } },
  )

  if (pass.modifiedCount === 1) {
    return 'pass'
  }

  if (state.proActive) {
    await spendCredits(app, userId, EVENT_LOOKS)
    return 'pro'
  }

  throw new PaywallError('needs_event', 'The Event Stylist dresses you for one event: three looks, pieces in stores and how to finish them.')
}

export async function refundEventAccess(app: FastifyInstance, userId: ObjectId, access: EventAccess) {
  if (access === 'pass') {
    await app.collections.users.updateOne({ _id: userId }, { $inc: { eventCredits: 1 } })
  } else if (access === 'pro') {
    await refundCredits(app, userId, EVENT_LOOKS)
  }
}

// What one magazine takes: nothing on a comp account, else a magazine
// credit. Throws the magazine offer otherwise.
export async function useMagazineAccess(app: FastifyInstance, userId: ObjectId): Promise<'credit' | 'comp'> {
  const state = await loadState(app, userId)

  if (state.comp) {
    return 'comp'
  }

  const credit = await app.collections.users.updateOne(
    { _id: userId, magazineCredits: { $gte: 1 } },
    { $inc: { magazineCredits: -1 }, $set: { updatedAt: new Date() } },
  )

  if (credit.modifiedCount === 1) {
    return 'credit'
  }

  throw new PaywallError('needs_magazine', 'Your personal magazine: ten looks on you, on location, with the words to go with them.')
}

export async function refundMagazineAccess(app: FastifyInstance, userId: ObjectId, access: 'credit' | 'comp') {
  if (access === 'credit') {
    await app.collections.users.updateOne({ _id: userId }, { $inc: { magazineCredits: 1 } })
  }
}

export async function releaseHairRun(app: FastifyInstance, userId: ObjectId) {
  await app.collections.users.updateOne({ _id: userId, freeHairRuns: { $gt: 0 } }, { $inc: { freeHairRuns: -1 } })
}

// Every offer shown instead of a result is counted where it happens, with
// the route that asked for it (first-party analytics).
export function sendPaywall(reply: FastifyReply, error: PaywallError) {
  void trackServerEvent(reply.server, {
    name: 'paywall_blocked',
    userId: toObjectId(reply.request.authUserId),
    props: { code: error.code, route: reply.request.routeOptions.url ?? '' },
  })

  return reply.code(402).send({ message: error.message, code: error.code })
}
