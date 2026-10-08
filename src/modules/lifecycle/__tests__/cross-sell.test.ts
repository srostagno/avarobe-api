import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CROSS_SELL_RULES, addonEnding, editDue, latestEdit, pickCrossSell, type CrossSellState } from '../cross-sell.js'
import { LIFECYCLE_RULES } from '../schedule.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = new Date('2026-10-04T18:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const inFuture = (ms: number) => new Date(now.getTime() + ms)

const NOTHING = { color: false, style: false, hair: false, magazine: false, event: false, guide: false, pro: false }

// A Color Advisor buyer from yesterday, nothing sent yet.
function state(overrides: Partial<CrossSellState> = {}): CrossSellState {
  return {
    lastPurchaseAt: ago(DAY),
    owns: { ...NOTHING, color: true },
    addonUntil: { color: null, style: inFuture(13 * DAY) },
    sent: {},
    lastSentAt: null,
    promotionsAllowed: true,
    edits: [],
    editEmails: [],
    ...overrides,
  }
}

// What a buyer gets on a given day: `sent` as days ago, the purchase too.
function on(purchaseDaysAgo: number, sent: Partial<Record<keyof CrossSellState['sent'], number>>, overrides: Partial<CrossSellState> = {}) {
  const dates = Object.fromEntries(Object.entries(sent).map(([kind, days]) => [kind, ago(days * DAY)]))
  const latest = Object.values(sent).length > 0 ? ago(Math.min(...Object.values(sent)) * DAY) : null
  return pickCrossSell(
    state({ lastPurchaseAt: ago(purchaseDaysAgo * DAY), sent: dates, lastSentAt: latest, addonUntil: { color: null, style: null }, ...overrides }),
    now,
  )
}

describe('pickCrossSell', () => {
  it('waits most of a day after the purchase, then offers the other report first', () => {
    assert.equal(pickCrossSell(state({ lastPurchaseAt: ago(19 * HOUR) }), now), null)
    assert.equal(pickCrossSell(state({ lastPurchaseAt: ago(20 * HOUR) }), now), 'xsell_style')
    // Bought the Style Advisor first: the Color Advisor, as soon.
    assert.equal(pickCrossSell(state({ lastPurchaseAt: ago(20 * HOUR), owns: { ...NOTHING, style: true } }), now), 'xsell_color')
  })

  it('goes down the steps, each its own gap after the one before', () => {
    // Style, then hair 2 days later.
    assert.equal(on(3, { xsell_style: 1.9 }), null)
    assert.equal(on(3, { xsell_style: 2 }), 'xsell_hair')
    // Hair, then Pro 7 days later.
    assert.equal(on(10, { xsell_style: 9, xsell_hair: 6.9 }), null)
    assert.equal(on(10, { xsell_style: 9, xsell_hair: 7 }), 'xsell_pro')
    // Pro, then the Event Stylist 4 days later.
    assert.equal(on(14, { xsell_style: 13, xsell_hair: 11, xsell_pro: 3.9 }), null)
    assert.equal(on(14, { xsell_style: 13, xsell_hair: 11, xsell_pro: 4 }), 'xsell_event')
    // Then the magazine 7 days later, and the book 9 days after that.
    assert.equal(on(25, { xsell_style: 24, xsell_hair: 22, xsell_pro: 15, xsell_event: 6.9 }), null)
    assert.equal(on(25, { xsell_style: 24, xsell_hair: 22, xsell_pro: 15, xsell_event: 7 }), 'xsell_magazine')
    const all = { xsell_style: 33, xsell_hair: 31, xsell_pro: 24, xsell_event: 20, xsell_magazine: 9 }
    assert.equal(on(34, { ...all, xsell_magazine: 8.9 }), null)
    assert.equal(on(34, all), 'xsell_guide')
    assert.equal(on(44, { ...all, xsell_guide: 1 }), null)
  })

  it('skips what they own, and the next step waits its own gap', () => {
    // Owns Hair & Grooming: Pro next, a week after the Style Advisor's email.
    const ownsHair = { owns: { ...NOTHING, color: true, hair: true } }
    assert.equal(on(3, { xsell_style: 2 }, ownsHair), null)
    assert.equal(on(8, { xsell_style: 7 }, ownsHair), 'xsell_pro')
    // Pro (it includes the advisors and events): the magazine first, a week
    // after their purchase, and no Pro email.
    const pro = { owns: { color: true, style: true, hair: true, magazine: false, event: true, guide: false, pro: true } }
    assert.equal(on(6, {}, pro), null)
    assert.equal(on(7, {}, pro), 'xsell_magazine')
    const everything = { owns: { color: true, style: true, hair: true, magazine: true, event: true, guide: true, pro: true } }
    assert.equal(on(7, {}, everything), null)
  })

  it('starts the wait over after any purchase', () => {
    // Bought something a day after the style email: hair two days after that.
    assert.equal(on(1, { xsell_style: 2 }), null)
    assert.equal(on(2, { xsell_style: 3 }), 'xsell_hair')
  })

  it('keeps the gap with every other email, a rescue included', () => {
    assert.equal(pickCrossSell(state({ lastSentAt: ago(LIFECYCLE_RULES.gap - HOUR) }), now), null)
    assert.equal(pickCrossSell(state({ lastSentAt: ago(LIFECYCLE_RULES.gap + HOUR) }), now), 'xsell_style')
  })

  it('reminds once before the pair price ends, even inside the gap', () => {
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

  it('stops the steps a while after the last purchase, and everything without the postal address', () => {
    assert.equal(pickCrossSell(state({ lastPurchaseAt: ago(CROSS_SELL_RULES.horizon + DAY) }), now), null)
    assert.equal(pickCrossSell(state({ promotionsAllowed: false }), now), null)
  })
})

describe('new-Edit emails', () => {
  const edits = [
    { id: 'halloween', droppedAt: ago(9 * DAY) },
    { id: 'fall', droppedAt: ago(9 * DAY) },
    { id: 'weddings', droppedAt: ago(2 * DAY) },
    { id: 'costumes', droppedAt: inFuture(5 * DAY) },
  ]
  // Every step sent (or not wanted) by day 35 of their purchase.
  const done = { xsell_style: 50, xsell_hair: 48, xsell_pro: 41, xsell_event: 37, xsell_magazine: 30, xsell_guide: 21 }

  it('picks the newest Edit out this week that no email has shown them', () => {
    assert.equal(editDue({ edits, editEmails: [] }, now.getTime()), 'weddings')
    assert.equal(editDue({ edits, editEmails: ['weddings'] }, now.getTime()), null)
    // Pro's email shows the newest one out, however old.
    assert.equal(latestEdit(edits, now.getTime()), 'weddings')
    assert.equal(latestEdit(edits.slice(0, 2), now.getTime()), 'halloween')
    // Clothes over costumes for Pro, when there are any.
    const costumes = [
      { id: 'fall', droppedAt: ago(9 * DAY) },
      { id: 'halloween', droppedAt: ago(3 * DAY), costume: true },
    ]
    assert.equal(latestEdit(costumes, now.getTime()), 'fall')
    assert.equal(latestEdit(costumes.slice(1), now.getTime()), 'halloween')
  })

  it('comes after the steps, ten days after the last cross-sell, once per Edit, while they aren’t on Pro', () => {
    assert.equal(on(51, done, { edits }), 'xsell_edit')
    // A step still to go comes first (here, with its purchase recent enough).
    assert.equal(on(40, { xsell_style: 39, xsell_hair: 37, xsell_pro: 30, xsell_event: 26, xsell_magazine: 19 }, { edits }), 'xsell_guide')
    // Too soon after the last cross-sell.
    assert.equal(on(51, { ...done, xsell_guide: 9.9 }, { edits }), null)
    // Already shown that Edit (by this email or by Pro's), or no new one.
    assert.equal(on(51, done, { edits, editEmails: ['weddings'] }), null)
    assert.equal(on(51, done, { edits: edits.slice(0, 2) }), null)
    // Pro has every Edit.
    assert.equal(on(51, done, { edits, owns: { ...NOTHING, color: true, pro: true } }), null)
  })

  it('keeps coming for months after the last purchase, then stops', () => {
    const lastEdit = { ...done, xsell_edit: 30 }
    assert.equal(on(170, lastEdit, { edits }), 'xsell_edit')
    assert.equal(on(CROSS_SELL_RULES.editHorizon / DAY + 1, lastEdit, { edits }), null)
    // The last one sent counts for the gap too.
    assert.equal(on(170, { ...done, xsell_edit: 9 }, { edits }), null)
  })
})
