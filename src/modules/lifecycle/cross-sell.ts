import type { LifecycleEmailKind } from '../../types/mongo.js'
import { tooSoonAfter } from './schedule.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Buyers get the next product they don't have, one email at a time: the
// other report (at the pair price while it lasts), Hair & Grooming, the
// magazine, the Event Stylist, then the book. Never something they own, and
// buying anything starts the wait over. Until Oct 2026 every second purchase
// happened in the same visit as the first, and nobody came back for more.
export const CROSS_SELL_RULES = {
  // After their latest purchase, so it never lands on top of it.
  firstAfter: 20 * HOUR,
  // Between two cross-sell emails: a few days for the first ones, then
  // longer, so the later products come about monthly.
  spacing: 4 * DAY,
  laterSpacing: 10 * DAY,
  laterAfter: 3,
  // One reminder this long before the pair price ends.
  lastCallBefore: 36 * HOUR,
  // Only while their latest purchase is this recent.
  horizon: 45 * DAY,
  // Sent in the US daytime (New York hours), not at night.
  sendHours: { from: 9, to: 20 },
} as const

export type CrossSellKind = Extract<LifecycleEmailKind, `xsell_${string}`>

export type CrossSellState = {
  // Their latest purchase of anything.
  lastPurchaseAt: Date
  // What they have, bought or through Pro.
  owns: { color: boolean; style: boolean; hair: boolean; magazine: boolean; event: boolean; guide: boolean }
  // The other report at the pair price until then (billingState).
  addonUntil: { color: Date | null; style: Date | null }
  sent: Partial<Record<LifecycleEmailKind, Date>>
  // Their last lifecycle email of any kind (lastLifecycleEmailAt).
  lastSentAt: Date | null
  // Promotional: needs the postal address in the footer.
  promotionsAllowed: boolean
}

// In order; the first one they want and haven't been offered goes next.
// The other report comes first: it's what buyers took right away before.
const STEPS: { kind: CrossSellKind; wants: (state: CrossSellState) => boolean }[] = [
  { kind: 'xsell_style', wants: (state) => state.owns.color && !state.owns.style },
  { kind: 'xsell_color', wants: (state) => !state.owns.color },
  { kind: 'xsell_hair', wants: (state) => !state.owns.hair },
  { kind: 'xsell_magazine', wants: (state) => !state.owns.magazine },
  { kind: 'xsell_event', wants: (state) => !state.owns.event },
  { kind: 'xsell_guide', wants: (state) => !state.owns.guide },
]

export const CROSS_SELL_KINDS: CrossSellKind[] = [...STEPS.map((step) => step.kind), 'xsell_addon_last_call']

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

// The cross-sell email this buyer is due now, if any.
export function pickCrossSell(state: CrossSellState, now: Date): CrossSellKind | null {
  const at = now.getTime()
  const sincePurchase = at - state.lastPurchaseAt.getTime()

  if (!state.promotionsAllowed || sincePurchase < CROSS_SELL_RULES.firstAfter || sincePurchase > CROSS_SELL_RULES.horizon) {
    return null
  }

  if (tooSoonAfter(state.lastSentAt, at)) {
    return null
  }

  // The pair price's reminder can't wait out the spacing, or it would come
  // after the price ended.
  if (!state.sent.xsell_addon_last_call && addonEnding(state, at)) {
    return 'xsell_addon_last_call'
  }

  const sent = crossSellsSent(state.sent)
  const last = sent.length > 0 ? Math.max(...sent.map((date) => date.getTime())) : null
  const spacing = sent.length >= CROSS_SELL_RULES.laterAfter ? CROSS_SELL_RULES.laterSpacing : CROSS_SELL_RULES.spacing

  if (last !== null && at - last < spacing) {
    return null
  }

  return STEPS.find((step) => !state.sent[step.kind] && step.wants(state))?.kind ?? null
}
