import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { env } from '../../../config/env.js'
import type { UserDocument } from '../../../types/mongo.js'
import { billingState, reportCreditFor, serializeBilling } from '../entitlements.js'
import { amountPaidAt, regionalAmount } from '../pricing.js'

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

describe('the report credit toward Pro annual', () => {
  const color = user({ colorReportAt: daysAgo(2) })
  const both = user({ colorReportAt: daysAgo(3), styleReportAt: daysAgo(1) })

  it('counts the Color Advisor at its price where they pay, so Pro annual costs what checkout charges', () => {
    assert.equal(reportCreditFor(color, 'us', now)?.amount, env.PRICE_COLOR_REPORT_CENTS)
    // Brazil: R$ 99,90 - R$ 27,90 = R$ 72,00.
    const br = reportCreditFor(color, 'br', now)
    assert.deepEqual([br?.amount, br?.currency], [2790, 'brl'])
    assert.equal(regionalAmount('pro_annual', 'br') - (br?.amount ?? 0), 7200)
    assert.deepEqual([reportCreditFor(color, 'mx', now)?.amount, reportCreditFor(color, 'mx', now)?.currency], [7900, 'mxn'])
    assert.deepEqual([reportCreditFor(color, 'co', now)?.amount, reportCreditFor(color, 'co', now)?.currency], [1190000, 'cop'])
    assert.deepEqual([reportCreditFor(color, 'latam', now)?.amount, reportCreditFor(color, 'latam', now)?.currency], [299, 'usd'])
  })

  it('caps both advisors at the bundle price, says which ones count, and ends with the first window', () => {
    for (const region of ['us', 'br', 'mx', 'co', 'latam'] as const) {
      assert.equal(reportCreditFor(both, region, now)?.amount, amountPaidAt('reports_bundle', region, daysAgo(3)), region)
    }
    const credit = reportCreditFor(both, 'br', now)
    assert.deepEqual(credit?.from, ['color', 'style'])
    assert.equal(credit?.until.getTime(), daysAgo(3).getTime() + env.REPORT_CREDIT_WINDOW_DAYS * DAY)
    assert.deepEqual(reportCreditFor(user({ styleReportAt: daysAgo(1) }), 'us', now)?.from, ['style'])
  })

  it("counts what she paid: Brazil's Color Advisor bought before the Oct 29 cut keeps R$ 27,90, after it R$ 19,90", () => {
    const later = Date.parse('2026-10-31T12:00:00Z')
    const before = reportCreditFor(user({ colorReportAt: new Date('2026-10-29T12:00:00Z') }), 'br', later)
    assert.equal(before?.amount, 2790)
    assert.equal(regionalAmount('pro_annual', 'br') - (before?.amount ?? 0), 7200)
    assert.equal(reportCreditFor(user({ colorReportAt: new Date('2026-10-30T12:00:00Z') }), 'br', later)?.amount, 1990)
    // Both before the cut: capped at the bundle's price then.
    const both = user({ colorReportAt: new Date('2026-10-29T10:00:00Z'), styleReportAt: new Date('2026-10-29T11:00:00Z') })
    assert.equal(reportCreditFor(both, 'br', later)?.amount, 4290)
    // Other regions never had a cut.
    assert.equal(reportCreditFor(user({ colorReportAt: new Date('2026-10-29T12:00:00Z') }), 'mx', later)?.amount, 7900)
  })

  it('is none on Pro, nor after the window, nor without a report', () => {
    assert.equal(reportCreditFor(user({ colorReportAt: daysAgo(2), pro: pro('year') }), 'br', now), null)
    assert.equal(reportCreditFor(user({ colorReportAt: daysAgo(env.REPORT_CREDIT_WINDOW_DAYS + 1) }), 'us', now), null)
    assert.equal(reportCreditFor(user({ hairAdvisorAt: daysAgo(1) }), 'us', now), null)
  })

  it('reaches the web in the currency of where they signed up', () => {
    const boughtAt = new Date(Date.now() - DAY)
    const brazilian = user({ colorReportAt: boughtAt, location: { country: 'BR', region: null, source: 'edge', at: new Date() } })
    const credit = serializeBilling(brazilian).reportCredit
    assert.deepEqual([credit?.amount, credit?.currency, credit?.region, credit?.from], [amountPaidAt('color_report', 'br', boughtAt), 'brl', 'br', ['color']])
    // No location: US prices, said so (a LatAm offer, also in dollars, isn't the same prices).
    const nowhere = serializeBilling(user({ colorReportAt: new Date(Date.now() - DAY) })).reportCredit
    assert.deepEqual([nowhere?.currency, nowhere?.region], ['usd', 'us'])
  })
})
