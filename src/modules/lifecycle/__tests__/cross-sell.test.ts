import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CROSS_SELL_RULES, addonEnding, pickCrossSell, type CrossSellState } from '../cross-sell.js'
import { LIFECYCLE_RULES } from '../schedule.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = new Date('2026-10-04T18:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const inFuture = (ms: number) => new Date(now.getTime() + ms)

// A Color Advisor buyer from yesterday, nothing sent yet.
function state(overrides: Partial<CrossSellState> = {}): CrossSellState {
  return {
    lastPurchaseAt: ago(DAY),
    owns: { color: true, style: false, hair: false, magazine: false, event: false, guide: false },
    addonUntil: { color: null, style: inFuture(13 * DAY) },
    sent: {},
    lastSentAt: null,
    promotionsAllowed: true,
    ...overrides,
  }
}

describe('pickCrossSell', () => {
  it('waits most of a day after the purchase, then offers the other report first', () => {
    assert.equal(pickCrossSell(state({ lastPurchaseAt: ago(2 * HOUR) }), now), null)
    assert.equal(pickCrossSell(state(), now), 'xsell_style')
  })

  it('never offers what they own, and offers the Color Advisor to buyers without it', () => {
    const both = state({ owns: { color: true, style: true, hair: false, magazine: false, event: false, guide: false } })
    assert.equal(pickCrossSell(both, now), 'xsell_hair')
    const styleOnly = state({ owns: { color: false, style: true, hair: false, magazine: false, event: false, guide: false } })
    assert.equal(pickCrossSell(styleOnly, now), 'xsell_color')
    // Pro (or everything bought): the products Pro doesn't include.
    const pro = state({ owns: { color: true, style: true, hair: true, magazine: false, event: true, guide: false } })
    assert.equal(pickCrossSell(pro, now), 'xsell_magazine')
    const everything = state({ owns: { color: true, style: true, hair: true, magazine: true, event: true, guide: true } })
    assert.equal(pickCrossSell(everything, now), null)
  })

  it('goes down the list one email at a time, spaced, and more slowly after three', () => {
    const afterStyle = state({ sent: { xsell_style: ago(2 * DAY) }, lastSentAt: ago(2 * DAY), lastPurchaseAt: ago(3 * DAY) })
    assert.equal(pickCrossSell(afterStyle, now), null)
    assert.equal(pickCrossSell({ ...afterStyle, sent: { xsell_style: ago(5 * DAY) }, lastSentAt: ago(5 * DAY) }, now), 'xsell_hair')

    const three = { xsell_style: ago(12 * DAY), xsell_hair: ago(9 * DAY), xsell_magazine: ago(5 * DAY) }
    const later = state({ sent: three, lastSentAt: ago(5 * DAY), lastPurchaseAt: ago(13 * DAY), addonUntil: { color: null, style: null } })
    assert.equal(pickCrossSell(later, now), null)
    const older = { xsell_style: ago(14 * DAY), xsell_hair: ago(12 * DAY), xsell_magazine: ago(11 * DAY) }
    assert.equal(pickCrossSell({ ...later, sent: older, lastSentAt: ago(11 * DAY) }, now), 'xsell_event')
  })

  it('keeps the gap with every other email, a rescue included', () => {
    assert.equal(pickCrossSell(state({ lastSentAt: ago(LIFECYCLE_RULES.gap - HOUR) }), now), null)
    assert.equal(pickCrossSell(state({ lastSentAt: ago(LIFECYCLE_RULES.gap + HOUR) }), now), 'xsell_style')
  })

  it('reminds once before the pair price ends, even inside the spacing', () => {
    const offered = state({
      lastPurchaseAt: ago(13 * DAY),
      sent: { xsell_style: ago(12 * DAY), xsell_hair: ago(2 * DAY) },
      lastSentAt: ago(2 * DAY),
      addonUntil: { color: null, style: inFuture(20 * HOUR) },
    })
    assert.equal(pickCrossSell(offered, now), 'xsell_addon_last_call')
    assert.equal(addonEnding(offered, now.getTime()), 'style')
    // Not twice, not before the report was offered, not once they have it,
    // and not after it ended.
    assert.equal(pickCrossSell({ ...offered, sent: { ...offered.sent, xsell_addon_last_call: ago(HOUR) }, lastSentAt: ago(LIFECYCLE_RULES.gap + HOUR) }, now), null)
    assert.equal(addonEnding({ ...offered, sent: {} }, now.getTime()), null)
    assert.equal(addonEnding({ ...offered, owns: { ...offered.owns, style: true } }, now.getTime()), null)
    assert.equal(addonEnding({ ...offered, addonUntil: { color: null, style: ago(HOUR) } }, now.getTime()), null)
    // Too early for it.
    assert.equal(addonEnding({ ...offered, addonUntil: { color: null, style: inFuture(CROSS_SELL_RULES.lastCallBefore + HOUR) } }, now.getTime()), null)
  })

  it('stops a while after the last purchase, and without the postal address', () => {
    assert.equal(pickCrossSell(state({ lastPurchaseAt: ago(CROSS_SELL_RULES.horizon + DAY) }), now), null)
    assert.equal(pickCrossSell(state({ promotionsAllowed: false }), now), null)
  })
})
