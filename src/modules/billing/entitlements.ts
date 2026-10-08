import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { UserDocument } from '../../types/mongo.js'
import { toObjectId } from '../../utils/object-id.js'
import { trackServerEvent } from '../analytics/service.js'

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
const PRO_GRACE_MS = 3 * DAY_MS
export const PRO_LIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function proIsLive(pro: UserDocument['pro'], now = Date.now()) {
  return Boolean(pro && PRO_LIVE_STATUSES.has(pro.status) && pro.periodEnd && pro.periodEnd.getTime() + PRO_GRACE_MS > now)
}

// Add-on prices: the other report at what completes the bundle.
export const colorAddonCents = () => Math.max(50, env.PRICE_REPORTS_BUNDLE_CENTS - env.PRICE_STYLE_REPORT_CENTS)
export const styleAddonCents = () => Math.max(50, env.PRICE_REPORTS_BUNDLE_CENTS - env.PRICE_COLOR_REPORT_CENTS)

export function billingState(user: BillingFields, now = Date.now()) {
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
  // them), up to the bundle price.
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
    // Bought anything, ever (reports, a look pack or Pro).
    paid: Boolean(user.paidAt || colorReportAt || styleReportAt || user.colorMirrorAt || user.hairAdvisorAt || pro || user.styleKitUntil),
    credits: user.credits ?? env.FREE_CREDITS,
    freeAvatarRunsLeft: proActive ? null : Math.max(0, env.FREE_AVATAR_RUNS - (user.freeAvatarRuns ?? 0)),
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
    reportCredit: state.reportCreditCents > 0 ? { amount: state.reportCreditCents, until: iso(state.reportCreditUntil) } : null,
    trialEligible: state.trialEligible,
    paid: state.paid,
    credits: state.credits,
    unlimited: state.comp,
    freeAvatarRunsLeft: state.freeAvatarRunsLeft,
    hairCuts: state.hairCuts,
    freeHairRunsLeft: state.freeHairRunsLeft,
    admin: state.admin,
    testingAsCustomer: state.admin && !state.comp,
  }
}

const BILLING_PROJECTION = {
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
    const { proActive, trialing, paid, credits } = await loadState(app, userId)
    const left = `${credits} look${credits === 1 ? '' : 's'} left`

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

// Avatar renders are free up to FREE_AVATAR_RUNS; Pro lifts it.
export async function useAvatarRun(app: FastifyInstance, userId: ObjectId) {
  if ((await loadState(app, userId)).proActive) {
    return
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
