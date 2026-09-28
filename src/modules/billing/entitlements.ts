import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { UserDocument } from '../../types/mongo.js'

// What a person can do. Free: the avatar (FREE_AVATAR_RUNS renders), their
// season and a few colors, and FREE_CREDITS looks. The Color Report unlocks
// the full palette and the visual color report; the Style Report, the style
// profile. Pro (monthly or annual) adds looks every month and the tools:
// try-ons, pieces and stores, the look analysis and more avatar changes; the
// annual plan includes both reports. Looks, remixes and try-ons spend one
// credit each; look packs add credits that never expire.

export type PaywallCode = 'needs_pro' | 'needs_color_report' | 'needs_style_report' | 'no_credits'

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
  | 'pro'
  | 'styleKitUntil'
  | 'paidAt'
  | 'freeAvatarRuns'
  | 'compPaused'
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
  const colorReport = comp || legacyKit || Boolean(colorReportAt)
  const styleReport = comp || legacyKit || Boolean(styleReportAt)
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
    colorReport,
    styleReport,
    // Completing the pair at the bundle price, soon after buying one report.
    colorAddonUntil: !colorReport && styleRecent ? styleRecent : null,
    styleAddonUntil: !styleReport && colorRecent ? colorRecent : null,
    reportCreditCents,
    reportCreditUntil: reportCreditCents > 0 ? reportCreditUntil : null,
    // Bought anything, ever (reports, a look pack or Pro).
    paid: Boolean(user.paidAt || colorReportAt || styleReportAt || pro || user.styleKitUntil),
    credits: user.credits ?? env.FREE_CREDITS,
    freeAvatarRunsLeft: proActive ? null : Math.max(0, env.FREE_AVATAR_RUNS - (user.freeAvatarRuns ?? 0)),
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
        }
      : null,
    colorReport: state.colorReport,
    styleReport: state.styleReport,
    colorAddonUntil: iso(state.colorAddonUntil),
    styleAddonUntil: iso(state.styleAddonUntil),
    reportCredit: state.reportCreditCents > 0 ? { amount: state.reportCreditCents, until: iso(state.reportCreditUntil) } : null,
    paid: state.paid,
    credits: state.credits,
    unlimited: state.comp,
    freeAvatarRunsLeft: state.freeAvatarRunsLeft,
    admin: state.admin,
    testingAsCustomer: state.admin && !state.comp,
  }
}

const BILLING_PROJECTION = {
  email: 1,
  credits: 1,
  colorReportAt: 1,
  styleReportAt: 1,
  pro: 1,
  styleKitUntil: 1,
  paidAt: 1,
  freeAvatarRuns: 1,
  compPaused: 1,
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

export async function requireColorReport(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasColorReport(app, userId))) {
    throw new PaywallError('needs_color_report', `${feature} comes with your Color Report.`)
  }
}

// The style profile and its boards.
export async function hasStyleReport(app: FastifyInstance, userId: ObjectId) {
  return (await loadState(app, userId)).styleReport
}

export async function requireStyleReport(app: FastifyInstance, userId: ObjectId, feature: string) {
  if (!(await hasStyleReport(app, userId))) {
    throw new PaywallError('needs_style_report', `${feature} comes with your Style Report.`)
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
    const { proActive, paid, credits } = await loadState(app, userId)
    const left = `${credits} look${credits === 1 ? '' : 's'} left`

    throw new PaywallError(
      'no_credits',
      credits > 0
        ? `You have ${left}. Ask for fewer, or add more looks.`
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

export function sendPaywall(reply: FastifyReply, error: PaywallError) {
  return reply.code(402).send({ message: error.message, code: error.code })
}
