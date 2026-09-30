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
  // Their colors read and no look made: the offer leads with their palette,
  // most of a day after the read (and after the looks nudge, if they have
  // an avatar).
  colorsOfferAfter: 20 * HOUR,
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
  // When their colors were read, if they were. Colors first reads them
  // before there's any avatar.
  colorsAt: Date | null
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

// The offer, then two reminders timed from it, while nothing is bought.
// `anchor` is what the offer follows: the last look, or the color read.
function offerSequence(state: LifecycleState, at: number, anchor: Date, after: number): LifecycleEmailKind | null {
  if (state.paid || !state.promotionsAllowed) {
    return null
  }

  const offer = state.sent.upgrade_offer

  if (!offer) {
    return between(at - anchor.getTime(), after, LIFECYCLE_RULES.offerWindow) ? 'upgrade_offer' : null
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
    // Colors first: their colors and no avatar yet. The palette offer takes
    // the avatar reminder's place; it points to the avatar too.
    if (state.colorsAt) {
      return offerSequence(state, at, state.colorsAt, LIFECYCLE_RULES.colorsOfferAfter)
    }

    return !state.sent.avatar_nudge &&
      between(sinceSignup, LIFECYCLE_RULES.avatarNudgeAfter, LIFECYCLE_RULES.avatarNudgeWindow)
      ? 'avatar_nudge'
      : null
  }

  if (state.looks === 0) {
    const sinceAvatar = at - state.avatarReadyAt.getTime()

    if (!state.sent.looks_nudge) {
      if (between(sinceAvatar, LIFECYCLE_RULES.looksNudgeAfter, LIFECYCLE_RULES.looksNudgeWindow)) {
        return 'looks_nudge'
      }

      // The nudge comes first.
      if (sinceAvatar < LIFECYCLE_RULES.looksNudgeAfter) {
        return null
      }
    }

    // No look yet, but their colors: the palette offer.
    return state.colorsAt ? offerSequence(state, at, state.colorsAt, LIFECYCLE_RULES.colorsOfferAfter) : null
  }

  if (!state.outOfFreeLooks || !state.lastLookAt) {
    return null
  }

  return offerSequence(state, at, state.lastLookAt, LIFECYCLE_RULES.offerAfter)
}
