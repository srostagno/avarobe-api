import type { LifecycleEmailKind } from '../../types/mongo.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// When each onboarding email goes out. Every email has a window, so someone
// who signed up weeks ago never gets a stale reminder.
export const LIFECYCLE_RULES = {
  // After sign-up, so it doesn't land on top of the confirmation email.
  welcomeDelay: 10 * MINUTE,
  welcomeWindow: 3 * DAY,
  // No avatar a day after signing up.
  avatarNudgeAfter: 24 * HOUR,
  avatarNudgeWindow: 7 * DAY,
  // An avatar but no looks, most of a day after the avatar was ready.
  looksNudgeAfter: 20 * HOUR,
  looksNudgeWindow: 10 * DAY,
  // Free looks used up and nothing bought: the offer a few hours after the
  // last look, then two reminders, timed from the offer.
  offerAfter: 3 * HOUR,
  offerWindow: 14 * DAY,
  reminderAfter: 2 * DAY,
  lastCallAfter: 5 * DAY,
  reminderWindow: 14 * DAY,
  // At most one onboarding email this often.
  gap: 18 * HOUR,
  // Only accounts this recent are considered at all.
  horizon: 30 * DAY,
} as const

export type LifecycleState = {
  createdAt: Date
  sent: Partial<Record<LifecycleEmailKind, Date>>
  lastSentAt: Date | null
  avatarReadyAt: Date | null
  looks: number
  lastLookAt: Date | null
  // Free looks spent (credits at zero).
  outOfFreeLooks: boolean
  // Bought anything: reports, a look pack or Pro. Ends the offer sequence.
  paid: boolean
  // The offers are promotional: they need a postal address in the footer.
  promotionsAllowed: boolean
}

function between(elapsed: number, after: number, window: number) {
  return elapsed >= after && elapsed <= window
}

// The one onboarding email this person is due now, if any. Each email goes
// out once; the states they answer to (no avatar, no looks, out of free
// looks) don't overlap, so there is never more than one candidate.
export function pickLifecycleEmail(state: LifecycleState, now: Date): LifecycleEmailKind | null {
  const at = now.getTime()

  if (state.lastSentAt && at - state.lastSentAt.getTime() < LIFECYCLE_RULES.gap) {
    return null
  }

  const sinceSignup = at - state.createdAt.getTime()

  if (!state.sent.welcome && between(sinceSignup, LIFECYCLE_RULES.welcomeDelay, LIFECYCLE_RULES.welcomeWindow)) {
    return 'welcome'
  }

  if (!state.avatarReadyAt) {
    return !state.sent.avatar_nudge &&
      between(sinceSignup, LIFECYCLE_RULES.avatarNudgeAfter, LIFECYCLE_RULES.avatarNudgeWindow)
      ? 'avatar_nudge'
      : null
  }

  if (state.looks === 0) {
    return !state.sent.looks_nudge &&
      between(at - state.avatarReadyAt.getTime(), LIFECYCLE_RULES.looksNudgeAfter, LIFECYCLE_RULES.looksNudgeWindow)
      ? 'looks_nudge'
      : null
  }

  if (state.paid || !state.outOfFreeLooks || !state.promotionsAllowed || !state.lastLookAt) {
    return null
  }

  const offer = state.sent.upgrade_offer

  if (!offer) {
    return between(at - state.lastLookAt.getTime(), LIFECYCLE_RULES.offerAfter, LIFECYCLE_RULES.offerWindow)
      ? 'upgrade_offer'
      : null
  }

  const sinceOffer = at - offer.getTime()

  if (!state.sent.upgrade_reminder) {
    return between(sinceOffer, LIFECYCLE_RULES.reminderAfter, LIFECYCLE_RULES.reminderWindow) ? 'upgrade_reminder' : null
  }

  if (!state.sent.upgrade_last_call) {
    return between(sinceOffer, LIFECYCLE_RULES.lastCallAfter, LIFECYCLE_RULES.reminderWindow) ? 'upgrade_last_call' : null
  }

  return null
}
