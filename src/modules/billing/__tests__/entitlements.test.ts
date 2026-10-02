import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { env } from '../../../config/env.js'
import type { UserDocument } from '../../../types/mongo.js'
import { billingState } from '../entitlements.js'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-10-01T12:00:00Z').getTime()
const daysAgo = (days: number) => new Date(now - days * DAY)
const inDays = (days: number) => new Date(now + days * DAY)

function user(overrides: Partial<UserDocument> = {}) {
  return { email: 'customer@example.com', ...overrides } as UserDocument
}

const pro = (interval: 'month' | 'year', overrides: Partial<NonNullable<UserDocument['pro']>> = {}) => ({
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval,
  periodEnd: inDays(20),
  cancelAtPeriodEnd: false,
  ...overrides,
})

describe('billingState', () => {
  it('includes the color mirror in the Color Advisor, and the advisor in a mirror purchase', () => {
    const mirror = billingState(user({ colorMirrorAt: daysAgo(1) }), now)
    assert.equal(mirror.colorMirror, true)
    assert.equal(mirror.colorReport, true)
    assert.equal(mirror.paid, true)
    assert.equal(billingState(user({ colorReportAt: daysAgo(1) }), now).colorMirror, true)
    assert.equal(billingState(user({ pro: pro('month') }), now).colorMirror, true)
    assert.equal(billingState(user(), now).colorMirror, false)
  })

  it('starts free with the sign-up looks and nothing unlocked', () => {
    const state = billingState(user(), now)
    assert.equal(state.credits, env.FREE_CREDITS)
    assert.equal(state.proActive, false)
    assert.equal(state.colorReport, false)
    assert.equal(state.styleReport, false)
    assert.equal(state.paid, false)
    assert.equal(state.reportCreditCents, 0)
  })

  it('offers the other report at the bundle price for a while after buying one', () => {
    const fresh = billingState(user({ colorReportAt: daysAgo(3) }), now)
    assert.equal(fresh.colorReport, true)
    assert.ok(fresh.styleAddonUntil)
    assert.equal(fresh.colorAddonUntil, null)
    assert.equal(fresh.paid, true)

    const late = billingState(user({ colorReportAt: daysAgo(env.REPORT_CREDIT_WINDOW_DAYS + 1) }), now)
    assert.equal(late.styleAddonUntil, null)
  })

  it('counts recent reports toward Pro annual, up to the bundle price', () => {
    assert.equal(billingState(user({ colorReportAt: daysAgo(2) }), now).reportCreditCents, env.PRICE_COLOR_REPORT_CENTS)
    assert.equal(
      billingState(user({ colorReportAt: daysAgo(2), styleReportAt: daysAgo(1) }), now).reportCreditCents,
      env.PRICE_REPORTS_BUNDLE_CENTS,
    )
    assert.equal(billingState(user({ colorReportAt: daysAgo(40) }), now).reportCreditCents, 0)
    // Not for someone already on Pro.
    assert.equal(billingState(user({ colorReportAt: daysAgo(2), pro: pro('month') }), now).reportCreditCents, 0)
  })

  it('keeps Pro through a short grace period after a failed renewal, then drops it', () => {
    assert.equal(billingState(user({ pro: pro('month', { status: 'past_due', periodEnd: daysAgo(1) }) }), now).proActive, true)
    assert.equal(billingState(user({ pro: pro('month', { status: 'past_due', periodEnd: daysAgo(5) }) }), now).proActive, false)
    assert.equal(billingState(user({ pro: pro('month', { status: 'canceled' }) }), now).proActive, false)
  })

  it('knows the plan interval, and that annual reports stay after it ends', () => {
    assert.equal(billingState(user({ pro: pro('year') }), now).proInterval, 'year')
    const lapsed = billingState(
      user({ pro: pro('year', { status: 'canceled', periodEnd: daysAgo(30) }), colorReportAt: daysAgo(400), styleReportAt: daysAgo(400) }),
      now,
    )
    assert.equal(lapsed.proActive, false)
    assert.equal(lapsed.colorReport && lapsed.styleReport, true)
  })

  it('keeps the older free allowance, and the stored sign-up looks of new accounts', () => {
    assert.equal(billingState(user(), now).credits, env.FREE_CREDITS)
    assert.equal(billingState(user({ credits: env.SIGNUP_CREDITS }), now).credits, env.SIGNUP_CREDITS)
  })

  it('offers the trial once while it is on: never to someone who had Pro or a trial', () => {
    const before = env.PRO_TRIAL
    env.PRO_TRIAL = true

    try {
      assert.equal(billingState(user(), now).trialEligible, true)
      assert.equal(billingState(user({ colorReportAt: daysAgo(2) }), now).trialEligible, true)
      assert.equal(billingState(user({ proTrialAt: daysAgo(40) }), now).trialEligible, false)
      assert.equal(billingState(user({ pro: pro('month', { status: 'canceled', periodEnd: daysAgo(30) }) }), now).trialEligible, false)
    } finally {
      env.PRO_TRIAL = before
    }
  })

  it('offers no trial while it is off', () => {
    const before = env.PRO_TRIAL
    env.PRO_TRIAL = false

    try {
      assert.equal(billingState(user(), now).trialEligible, false)
    } finally {
      env.PRO_TRIAL = before
    }
  })

  it('gives everything in Pro during the trial, reports included, and takes the reports back if it ends', () => {
    const trial = billingState(user({ proTrialAt: daysAgo(1), pro: pro('month', { status: 'trialing', periodEnd: inDays(6), trialEnd: inDays(6) }) }), now)
    assert.equal(trial.proActive, true)
    assert.equal(trial.trialing, true)
    assert.equal(trial.colorReport && trial.styleReport, true)
    assert.equal(trial.trialEligible, false)

    const canceled = billingState(user({ proTrialAt: daysAgo(10), pro: pro('month', { status: 'canceled', periodEnd: daysAgo(3) }) }), now)
    assert.equal(canceled.proActive, false)
    assert.equal(canceled.colorReport || canceled.styleReport, false)
  })

  it('lifts the avatar limit with Pro', () => {
    assert.equal(billingState(user({ freeAvatarRuns: 5 }), now).freeAvatarRunsLeft, 0)
    assert.equal(billingState(user({ freeAvatarRuns: 5, pro: pro('month') }), now).freeAvatarRunsLeft, null)
  })

  it('gives one free haircut, and every recommended cut with the Style Advisor or Pro', () => {
    const fresh = billingState(user(), now)
    assert.equal(fresh.hairCuts, false)
    assert.equal(fresh.freeHairRunsLeft, 1)
    assert.equal(billingState(user({ freeHairRuns: 1 }), now).freeHairRunsLeft, 0)
    // The Color Advisor alone doesn't include them; the Style Advisor does.
    assert.equal(billingState(user({ colorReportAt: daysAgo(1), freeHairRuns: 1 }), now).hairCuts, false)
    const styled = billingState(user({ styleReportAt: daysAgo(1), freeHairRuns: 1 }), now)
    assert.equal(styled.hairCuts, true)
    assert.equal(styled.freeHairRunsLeft, null)
    assert.equal(billingState(user({ pro: pro('month'), freeHairRuns: 1 }), now).hairCuts, true)
  })

  it('moves the cuts to the Hair & Grooming Advisor, keeping them for earlier Style Advisor owners', () => {
    // A Style Advisor bought after the split doesn't bring the cuts.
    const styleOnly = billingState(user({ styleReportAt: daysAgo(1), styleWithoutHair: true, freeHairRuns: 1 }), now)
    assert.equal(styleOnly.styleReport, true)
    assert.equal(styleOnly.hairAdvisor, false)
    assert.equal(styleOnly.hairCuts, false)
    const hair = billingState(user({ hairAdvisorAt: daysAgo(1) }), now)
    assert.equal(hair.hairAdvisor, true)
    assert.equal(hair.hairCuts, true)
    assert.equal(hair.styleReport, false)
    assert.equal(hair.paid, true)
    assert.equal(billingState(user({ pro: pro('month') }), now).hairAdvisor, true)
  })

  it('counts Event Stylist passes', () => {
    assert.equal(billingState(user(), now).eventCredits, 0)
    assert.equal(billingState(user({ eventCredits: 2 }), now).eventCredits, 2)
  })
})
