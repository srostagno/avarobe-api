import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LIFECYCLE_RULES, pickLifecycleEmail, type LifecycleState } from '../schedule.js'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-10-01T18:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

function state(overrides: Partial<LifecycleState> = {}): LifecycleState {
  return {
    createdAt: ago(HOUR),
    sent: {},
    lastSentAt: null,
    avatarReadyAt: null,
    colorsAt: null,
    looks: 0,
    lastLookAt: null,
    outOfFreeLooks: false,
    paid: false,
    promotionsAllowed: true,
    ...overrides,
  }
}

describe('pickLifecycleEmail', () => {
  it('waits a few minutes after sign-up before the welcome', () => {
    assert.equal(pickLifecycleEmail(state({ createdAt: ago(5 * 60 * 1000) }), now), null)
    assert.equal(pickLifecycleEmail(state({ createdAt: ago(15 * 60 * 1000) }), now), 'welcome')
  })

  it('never sends a welcome to an account older than its window', () => {
    const old = state({ createdAt: ago(LIFECYCLE_RULES.welcomeWindow + HOUR) })
    assert.notEqual(pickLifecycleEmail(old, now), 'welcome')
    assert.equal(pickLifecycleEmail({ ...old, avatarReadyAt: ago(2 * HOUR) }, now), null)
  })

  it('keeps emails at least the gap apart', () => {
    const base = state({ createdAt: ago(30 * HOUR), sent: { welcome: ago(10 * HOUR) } })
    assert.equal(pickLifecycleEmail({ ...base, lastSentAt: ago(10 * HOUR) }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, lastSentAt: ago(LIFECYCLE_RULES.gap + HOUR) }, now), 'avatar_nudge')
  })

  it('reminds people without an avatar a day after signing up, once', () => {
    const sent = { welcome: ago(40 * HOUR) }
    assert.equal(pickLifecycleEmail(state({ createdAt: ago(12 * HOUR), sent: { welcome: ago(11 * HOUR) } }), now), null)
    assert.equal(pickLifecycleEmail(state({ createdAt: ago(41 * HOUR), sent }), now), 'avatar_nudge')
    assert.equal(
      pickLifecycleEmail(state({ createdAt: ago(80 * HOUR), sent: { ...sent, avatar_nudge: ago(30 * HOUR) } }), now),
      null,
    )
    assert.equal(pickLifecycleEmail(state({ createdAt: ago(LIFECYCLE_RULES.avatarNudgeWindow + HOUR), sent }), now), null)
  })

  it('nudges toward a first look once the avatar has been ready a while', () => {
    const base = state({ createdAt: ago(3 * 24 * HOUR), sent: { welcome: ago(70 * HOUR) } })
    assert.equal(pickLifecycleEmail({ ...base, avatarReadyAt: ago(2 * HOUR) }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, avatarReadyAt: ago(22 * HOUR) }, now), 'looks_nudge')
    assert.equal(pickLifecycleEmail({ ...base, avatarReadyAt: ago(22 * HOUR), looks: 2 }, now), null)
  })

  it('offers an upgrade only after the free looks are spent, and only with a postal address', () => {
    const base = state({
      createdAt: ago(2 * 24 * HOUR),
      sent: { welcome: ago(47 * HOUR) },
      avatarReadyAt: ago(46 * HOUR),
      looks: 3,
      lastLookAt: ago(5 * HOUR),
      outOfFreeLooks: true,
    })
    assert.equal(pickLifecycleEmail(base, now), 'upgrade_offer')
    assert.equal(pickLifecycleEmail({ ...base, lastLookAt: ago(HOUR) }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, outOfFreeLooks: false }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, paid: true }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, promotionsAllowed: false }, now), null)
  })

  it('follows the offer with two reminders, and stops once they buy', () => {
    const base = state({
      createdAt: ago(9 * 24 * HOUR),
      avatarReadyAt: ago(9 * 24 * HOUR),
      looks: 3,
      lastLookAt: ago(8 * 24 * HOUR),
      outOfFreeLooks: true,
    })
    const offered = (hoursAgo: number, extra = {}) => ({
      ...base,
      sent: { welcome: ago(9 * 24 * HOUR), upgrade_offer: ago(hoursAgo * HOUR), ...extra },
      lastSentAt: ago(Math.min(hoursAgo, 20) * HOUR),
    })
    assert.equal(pickLifecycleEmail(offered(30), now), null)
    assert.equal(pickLifecycleEmail(offered(50), now), 'upgrade_reminder')
    assert.equal(pickLifecycleEmail({ ...offered(50), paid: true }, now), null)
    assert.equal(pickLifecycleEmail(offered(100, { upgrade_reminder: ago(50 * HOUR) }), now), null)
    assert.equal(pickLifecycleEmail(offered(125, { upgrade_reminder: ago(75 * HOUR) }), now), 'upgrade_last_call')
    assert.equal(
      pickLifecycleEmail(offered(170, { upgrade_reminder: ago(120 * HOUR), upgrade_last_call: ago(40 * HOUR) }), now),
      null,
    )
    // A reminder that would come weeks late is skipped.
    assert.equal(pickLifecycleEmail(offered(LIFECYCLE_RULES.reminderWindow / HOUR + 1), now), null)
  })

  it('offers their palette to people who came for their colors and have no avatar, instead of the avatar reminder', () => {
    const base = state({ createdAt: ago(30 * HOUR), sent: { welcome: ago(29 * HOUR) }, lastSentAt: ago(29 * HOUR) })
    // An hour after the read.
    assert.equal(pickLifecycleEmail({ ...base, colorsAt: ago(30 * 60 * 1000) }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, colorsAt: ago(2 * HOUR) }, now), 'upgrade_offer')
    // No colors read: the avatar reminder, as before.
    assert.equal(pickLifecycleEmail(base, now), 'avatar_nudge')
    assert.equal(pickLifecycleEmail({ ...base, colorsAt: ago(25 * HOUR), paid: true }, now), null)
    assert.equal(pickLifecycleEmail({ ...base, colorsAt: ago(25 * HOUR), promotionsAllowed: false }, now), null)
  })

  it('offers their palette to people with an avatar and no look, after the looks nudge', () => {
    const base = state({
      createdAt: ago(3 * 24 * HOUR),
      sent: { welcome: ago(70 * HOUR) },
      avatarReadyAt: ago(22 * HOUR),
      colorsAt: ago(26 * HOUR),
    })
    // The nudge first, even though the palette offer would be due.
    assert.equal(pickLifecycleEmail(base, now), 'looks_nudge')
    assert.equal(pickLifecycleEmail({ ...base, avatarReadyAt: ago(5 * HOUR) }, now), null)
    const nudged = { ...base, sent: { ...base.sent, looks_nudge: ago(19 * HOUR) }, lastSentAt: ago(19 * HOUR) }
    assert.equal(pickLifecycleEmail(nudged, now), 'upgrade_offer')
    // Then the same two reminders, timed from the offer.
    const offered = { ...nudged, sent: { ...nudged.sent, upgrade_offer: ago(50 * HOUR) }, lastSentAt: ago(50 * HOUR) }
    assert.equal(pickLifecycleEmail(offered, now), 'upgrade_reminder')
  })

  it('sends colors-first accounts the offer an hour after their colors, as their first email', () => {
    const fresh = state({ createdAt: ago(40 * 60 * 1000), colorsAt: ago(35 * 60 * 1000) })
    // No welcome on top of it, and nothing before the hour.
    assert.equal(pickLifecycleEmail(fresh, now), null)
    const hourLater = state({ createdAt: ago(70 * 60 * 1000), colorsAt: ago(65 * 60 * 1000) })
    assert.equal(pickLifecycleEmail(hourLater, now), 'upgrade_offer')
    assert.equal(pickLifecycleEmail({ ...hourLater, paid: true }, now), null)
    // Without their colors yet, the welcome as before.
    assert.equal(pickLifecycleEmail(state({ createdAt: ago(20 * 60 * 1000) }), now), 'welcome')
  })

  it('sends the welcome first even when the person already did everything', () => {
    const busy = state({ createdAt: ago(HOUR), avatarReadyAt: ago(50 * 60 * 1000), looks: 3, lastLookAt: ago(10 * 60 * 1000), outOfFreeLooks: true })
    assert.equal(pickLifecycleEmail(busy, now), 'welcome')
  })
})
