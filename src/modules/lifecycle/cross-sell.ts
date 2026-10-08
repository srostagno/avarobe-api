import type { LifecycleEmailKind } from '../../types/mongo.js'
import { tooSoonAfter } from './schedule.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Buyers get the next thing they don't have, one email at a time, each one
// leading with something new about themselves made from their own avatar or
// colors (lifecycle/assets.ts): the other report, Hair & Grooming, Pro, the
// Event Stylist, the magazine, the book; after those, each new Edit tried on
// them. Never something they own, and buying anything starts the wait over.
// Until Oct 2026 these were product ads with stock photos: most were opened,
// none was clicked.
export const CROSS_SELL_RULES = {
  // Nothing this soon after a purchase, so it never lands on top of it.
  firstAfter: 20 * HOUR,
  // One reminder this long before the pair price ends.
  lastCallBefore: 36 * HOUR,
  // The steps run while their latest purchase is this recent; the new-Edit
  // emails, for longer.
  horizon: 45 * DAY,
  editHorizon: 180 * DAY,
  // An Edit is new for its first week; a new-Edit email comes at most this
  // often.
  editFresh: 7 * DAY,
  editGap: 10 * DAY,
  // Sent in her daytime (utils/timezones.ts), not at night.
  sendHours: { from: 9, to: 20 },
} as const

export type CrossSellKind = Extract<LifecycleEmailKind, `xsell_${string}`>

export type CrossSellState = {
  // Their latest purchase of anything.
  lastPurchaseAt: Date
  // What they have, bought or through Pro.
  owns: { color: boolean; style: boolean; hair: boolean; magazine: boolean; event: boolean; guide: boolean; pro: boolean }
  // The other report at the pair price until then (billingState).
  addonUntil: { color: Date | null; style: Date | null }
  sent: Partial<Record<LifecycleEmailKind, Date>>
  // Their last lifecycle email of any kind (lastLifecycleEmailAt).
  lastSentAt: Date | null
  // Promotional: needs the postal address in the footer.
  promotionsAllowed: boolean
  // The Edits they can try on (with looks for how they dress), and the ones
  // a cross-sell email already showed them (users.editEmails).
  // The Edits they can try on; `costume` for costume collections (Halloween).
  edits: { id: string; droppedAt: Date; costume?: boolean }[]
  editEmails: string[]
}

// In order; the first one they want and haven't been sent goes next, `gap`
// after the previous cross-sell (the first one: after their purchase). A
// step they don't want is skipped, and the next one waits its own gap.
// The other report comes first: it's what buyers took right away before.
const STEPS: { kind: CrossSellKind; gap: number; wants: (state: CrossSellState) => boolean }[] = [
  { kind: 'xsell_style', gap: 20 * HOUR, wants: (state) => state.owns.color && !state.owns.style },
  { kind: 'xsell_color', gap: 20 * HOUR, wants: (state) => !state.owns.color },
  { kind: 'xsell_hair', gap: 2 * DAY, wants: (state) => !state.owns.hair },
  { kind: 'xsell_pro', gap: 7 * DAY, wants: (state) => !state.owns.pro },
  { kind: 'xsell_event', gap: 4 * DAY, wants: (state) => !state.owns.event },
  { kind: 'xsell_magazine', gap: 7 * DAY, wants: (state) => !state.owns.magazine },
  { kind: 'xsell_guide', gap: 9 * DAY, wants: (state) => !state.owns.guide },
]

export const CROSS_SELL_KINDS: CrossSellKind[] = [...STEPS.map((step) => step.kind), 'xsell_addon_last_call', 'xsell_edit']

export function isCrossSell(kind: LifecycleEmailKind): kind is CrossSellKind {
  return (CROSS_SELL_KINDS as LifecycleEmailKind[]).includes(kind)
}

function crossSellsSent(sent: CrossSellState['sent']) {
  return CROSS_SELL_KINDS.map((kind) => sent[kind]).filter((value): value is Date => value instanceof Date)
}

// Which pair price ends soon, after its report was offered and while they
// still don't have it.
export function addonEnding(state: CrossSellState, at: number): 'style' | 'color' | null {
  for (const side of ['style', 'color'] as const) {
    const until = state.addonUntil[side]
    const offered = state.sent[side === 'style' ? 'xsell_style' : 'xsell_color']
    const left = until ? until.getTime() - at : 0

    if (offered && !state.owns[side] && left > 0 && left <= CROSS_SELL_RULES.lastCallBefore) {
      return side
    }
  }

  return null
}

const newestFirst = (edits: CrossSellState['edits'], at: number) =>
  edits.filter((edit) => edit.droppedAt.getTime() <= at).sort((a, b) => b.droppedAt.getTime() - a.droppedAt.getTime())

// The newest Edit out, for the Pro email: clothes she'd wear when there are
// any (a pumpkin costume sells Pro less than a fall look). Costume Edits
// still get their own new-Edit email.
export function latestEdit(edits: CrossSellState['edits'], at: number): string | null {
  const out = newestFirst(edits, at)
  return (out.find((edit) => !edit.costume) ?? out[0])?.id ?? null
}

// The newest Edit out this week that no email has shown them yet.
export function editDue(state: Pick<CrossSellState, 'edits' | 'editEmails'>, at: number): string | null {
  return (
    newestFirst(state.edits, at).find(
      (edit) => at - edit.droppedAt.getTime() < CROSS_SELL_RULES.editFresh && !state.editEmails.includes(edit.id),
    )?.id ?? null
  )
}

// The cross-sell email this buyer is due now, if any.
export function pickCrossSell(state: CrossSellState, now: Date): CrossSellKind | null {
  const at = now.getTime()
  const sincePurchase = at - state.lastPurchaseAt.getTime()

  if (!state.promotionsAllowed || sincePurchase < CROSS_SELL_RULES.firstAfter || sincePurchase > CROSS_SELL_RULES.editHorizon) {
    return null
  }

  if (tooSoonAfter(state.lastSentAt, at)) {
    return null
  }

  const steps = sincePurchase <= CROSS_SELL_RULES.horizon

  // The pair price's reminder can't wait out the gaps, or it would come
  // after the price ended.
  if (steps && !state.sent.xsell_addon_last_call && addonEnding(state, at)) {
    return 'xsell_addon_last_call'
  }

  // Every wait counts from their latest cross-sell or their latest purchase,
  // whichever came last: buying anything starts it over.
  const since = at - Math.max(state.lastPurchaseAt.getTime(), ...crossSellsSent(state.sent).map((date) => date.getTime()))
  const step = steps ? STEPS.find((item) => !state.sent[item.kind] && item.wants(state)) : undefined

  if (step) {
    return since >= step.gap ? step.kind : null
  }

  // The steps are done (or skipped, or past their horizon): each new Edit,
  // tried on them, while they aren't on Pro.
  return !state.owns.pro && since >= CROSS_SELL_RULES.editGap && editDue(state, at) ? 'xsell_edit' : null
}
