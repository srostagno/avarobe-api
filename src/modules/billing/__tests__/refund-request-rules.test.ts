import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import type { PurchaseDocument, RefundRequestHistory, RefundUsage } from '../../../types/mongo.js'
import {
  MAX_CHARS,
  brazilBasis,
  brazilian,
  businessDueAt,
  distinctWords,
  flagsFor,
  hardBrazil,
  isStatutory,
  newRef,
  oldGuarantee,
  requestWindow,
  statutoryFor,
  validateRequestInput,
} from '../refund-requests.js'
import { brazilWithdrawalUntil } from '../refunds.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = Date.parse('2026-10-12T15:00:00Z')

function purchase(fields: Partial<PurchaseDocument>): PurchaseDocument {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    product: 'color_report',
    stripeSessionId: 'cs_1',
    stripePaymentIntentId: 'pi_1',
    amountTotal: 499,
    currency: 'usd',
    credits: 0,
    createdAt: new Date(now - DAY),
    ...fields,
  }
}

const usage = (fields: Partial<RefundUsage> = {}): RefundUsage => ({
  at: new Date(now),
  hoursSincePurchase: 24,
  colorReportOpenedAt: null,
  styleReportOpenedAt: null,
  hairReadAt: null,
  drapeAt: null,
  looksMade: 0,
  looksWithCredit: 0,
  creditsGiven: 0,
  creditsLeft: 0,
  hairstylesMade: 0,
  eventsStyled: 0,
  magazinesMade: 0,
  checksMade: 0,
  avatarRuns: null,
  guideDownloads: null,
  guideLastDownloadAt: null,
  lastSeenAt: null,
  events: {},
  ...fields,
})

const history = (fields: Partial<RefundRequestHistory> = {}): RefundRequestHistory => ({
  refundsBefore: 0,
  requestsBefore: 0,
  approvedBefore: 0,
  rejectedBefore: 0,
  openRequests: 0,
  purchases: 1,
  paidUsd: 499,
  accountCreatedAt: new Date(now - 10 * DAY),
  channel: 'meta',
  campaign: null,
  cardSeenOn: 0,
  ...fields,
})

const facts = { product: 'color_report' as const, purchasedAt: new Date(now - DAY), creditUsed: false, disputed: false, chargedDuringReview: false, oldGuarantee: false }

// 80 characters and more than 8 different words.
const ENOUGH = 'The season it gave me is wrong: warm colors make my face look grey and tired in photos.'

describe('when a refund can be requested', () => {
  it('is 7 × 24 hours after paying', () => {
    assert.ok(requestWindow(purchase({ createdAt: new Date(now - 7 * DAY + HOUR) }), {}, now))
    assert.equal(requestWindow(purchase({ createdAt: new Date(now - 7 * DAY - HOUR) }), {}, now), null)
  })

  it('in Brazil, runs to the end of the 7th calendar day after the purchase, São Paulo time', () => {
    // Oct 1 at 23:30 in São Paulo.
    const paidAt = new Date('2026-10-02T02:30:00Z')

    assert.equal(brazilWithdrawalUntil(paidAt).toISOString(), '2026-10-09T02:59:59.999Z')
    // Oct 8 at 23:50 in São Paulo: after 7 × 24 h, still within Brazil's days.
    const late = Date.parse('2026-10-09T02:50:00Z')
    const bought = purchase({ createdAt: paidAt })

    assert.equal(requestWindow(bought, {}, late), null)
    assert.equal(requestWindow(bought, { brazil: true }, late)?.toISOString(), '2026-10-09T02:59:59.999Z')
    assert.equal(requestWindow(bought, { brazil: true }, Date.parse('2026-10-09T03:00:00Z')), null)
  })

  it('covers Pro only in its first week, never a renewal', () => {
    const firstProAt = new Date(now - 40 * DAY)

    assert.equal(requestWindow(purchase({ product: 'pro_monthly', createdAt: new Date(now - DAY) }), { firstProAt }, now), null)
    assert.ok(requestWindow(purchase({ product: 'pro_annual', createdAt: new Date(now - DAY) }), { firstProAt: new Date(now - 3 * DAY) }, now))
  })

  it('says Brazil from any of its signals: reais, signing up there, a Brazilian card, Portuguese', () => {
    const none = { currency: 'usd', signupCountry: 'US', cardCountry: 'US', locale: 'en' as const }

    assert.equal(brazilian(none), false)
    assert.ok(brazilian({ ...none, currency: 'brl' }))
    assert.ok(brazilian({ ...none, signupCountry: 'BR' }))
    assert.ok(brazilian({ ...none, cardCountry: 'BR' }))
    assert.ok(brazilian({ ...none, locale: 'pt-BR' }))
    assert.ok(brazilian({ ...none, pageLocale: 'pt-BR' }))

    const until = new Date(now + HOUR)
    assert.ok(isStatutory({ ...none, currency: 'brl' }, new Date(now), until))
    assert.equal(isStatutory({ ...none, currency: 'brl' }, new Date(now + 2 * HOUR), until), false)
    assert.equal(isStatutory(none, new Date(now), until), false)
  })

  it('keeps why it counts as Brazilian, and only a hard signal skips the request limit', () => {
    const none = { currency: 'usd', signupCountry: 'US', cardCountry: 'US', locale: 'en' as const }
    const until = new Date(now + HOUR)
    const byLanguage = statutoryFor({ ...none, pageLocale: 'pt-BR' }, new Date(now), until)
    const byCard = statutoryFor({ ...none, cardCountry: 'br', pageLocale: 'pt-BR' }, new Date(now), until)

    assert.deepEqual(byLanguage?.basis, ['language'])
    assert.deepEqual(byCard?.basis, ['card', 'language'])
    assert.deepEqual(brazilBasis({ currency: 'brl', signupCountry: 'BR', cardCountry: null, locale: 'en' }), ['currency', 'signup'])
    assert.equal(hardBrazil(byLanguage), false)
    assert.equal(hardBrazil(byCard), true)
    // Stored before the basis was kept: counts as hard.
    assert.equal(hardBrazil({ basis: undefined }), true)
    assert.equal(hardBrazil(null), false)
  })
})

describe('the request form', () => {
  const valid = { category: 'not_accurate', explanation: ENOUGH, acknowledge: true, brief: false }

  it('takes a category, an explanation in their own words and the acknowledgement', () => {
    const result = validateRequestInput(valid)

    assert.deepEqual(result, { ok: true, category: 'not_accurate', explanation: ENOUGH })
    assert.equal(validateRequestInput({ ...valid, acknowledge: 'true' }).ok, true)
  })

  it('needs a category', () => {
    assert.deepEqual(validateRequestInput({ ...valid, category: undefined }), { ok: false, message: 'Choose what happened.' })
    assert.deepEqual(validateRequestInput({ ...valid, category: 'refund_me' }), { ok: false, message: 'Choose what happened.' })
  })

  it('needs 80 characters and 8 different words', () => {
    const words = 'one two three four five six seven eight '
    const at80 = (words + 'x'.repeat(80)).slice(0, 80)

    assert.equal(at80.length, 80)
    assert.equal(validateRequestInput({ ...valid, explanation: at80 }).ok, true)
    assert.equal(validateRequestInput({ ...valid, explanation: at80.slice(0, 79) }).ok, false)
    // Long enough, but the same few words.
    assert.equal(validateRequestInput({ ...valid, explanation: 'bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad bad.' }).ok, false)
    assert.deepEqual(validateRequestInput({ ...valid, explanation: 'a'.repeat(120) }), {
      ok: false,
      message: 'Tell us a bit more about what happened, in your own words.',
    })
    assert.equal(validateRequestInput({ ...valid, explanation: '!?.,'.repeat(40) }).ok, false)
  })

  it('needs only 20 characters and 3 words for a Brazilian withdrawal', () => {
    assert.equal(validateRequestInput({ ...valid, brief: true, explanation: 'Não quero mais, obrigado.' }).ok, true)
    assert.equal(validateRequestInput({ ...valid, brief: false, explanation: 'Não quero mais, obrigado.' }).ok, false)
    assert.equal(validateRequestInput({ ...valid, brief: true, explanation: 'não quero' }).ok, false)
  })

  it('needs the acknowledgement, and at most 2,000 characters', () => {
    assert.deepEqual(validateRequestInput({ ...valid, acknowledge: false }), { ok: false, message: 'Confirm that you understand what a refund removes.' })
    assert.equal(validateRequestInput({ ...valid, acknowledge: undefined }).ok, false)
    assert.equal(validateRequestInput({ ...valid, explanation: `${ENOUGH} ${'more words here '.repeat(200)}`.slice(0, MAX_CHARS) }).ok, true)
    assert.equal(validateRequestInput({ ...valid, explanation: `${ENOUGH} ${'more words here '.repeat(200)}`.slice(0, MAX_CHARS + 1) }).ok, false)
  })

  it('counts words as runs of letters in any language', () => {
    assert.deepEqual([...distinctWords('Não, NÃO! cores e cores; a 12 ç')], ['não', 'cores'])
  })
})

describe('the signals for the founder', () => {
  it('flag repeats, use and heavy use, the same card, and a brand-new account, never deciding anything', () => {
    assert.deepEqual(flagsFor(usage(), history(), facts), [])
    assert.deepEqual(flagsFor(usage(), history({ refundsBefore: 1, requestsBefore: 2, openRequests: 2, cardSeenOn: 1 }), facts), [
      'repeat',
      'requested_before',
      'card_seen',
      'many_open',
    ])
    assert.deepEqual(flagsFor(usage({ colorReportOpenedAt: new Date(now) }), history(), facts), ['used'])
    assert.deepEqual(flagsFor(usage({ looksWithCredit: 5, creditsGiven: 10 }), history(), { ...facts, product: 'look_pack' }), ['used', 'heavy_use'])
    assert.deepEqual(flagsFor(usage({ guideDownloads: 3 }), history(), { ...facts, product: 'outfit_guide' }), ['used', 'heavy_use'])
    assert.deepEqual(flagsFor(usage(), history({ accountCreatedAt: new Date(now - DAY - 10 * 60 * 1000) }), facts), ['new_account'])
    assert.deepEqual(flagsFor(usage(), history(), { ...facts, disputed: true, chargedDuringReview: true, creditUsed: true, oldGuarantee: true }), [
      'old_guarantee',
      'credit_used',
      'charged_during_review',
      'disputed',
    ])
  })

  it('keep the old guarantee for purchases paid before the new Terms', () => {
    const since = new Date(now)
    const before = new Date(now - DAY)

    assert.ok(oldGuarantee({ product: 'color_report', paidAt: before, firstPro: false }, usage(), history(), since))
    // Once per person, under the old Terms.
    assert.equal(oldGuarantee({ product: 'color_report', paidAt: before, firstPro: false }, usage(), history({ refundsBefore: 1 }), since), false)
    assert.ok(oldGuarantee({ product: 'look_pack', paidAt: before, firstPro: false }, usage({ looksWithCredit: 5 }), history(), since))
    assert.equal(oldGuarantee({ product: 'look_pack', paidAt: before, firstPro: false }, usage({ looksWithCredit: 6 }), history(), since), false)
    assert.ok(oldGuarantee({ product: 'pro_monthly', paidAt: before, firstPro: true }, usage(), history(), since))
    assert.equal(oldGuarantee({ product: 'pro_monthly', paidAt: before, firstPro: false }, usage(), history(), since), false)
    assert.equal(oldGuarantee({ product: 'outfit_guide', paidAt: before, firstPro: false }, usage(), history(), since), false)
    // Paid under the new Terms.
    assert.equal(oldGuarantee({ product: 'color_report', paidAt: new Date(now + HOUR), firstPro: false }, usage(), history(), since), false)
  })
})

describe('the review', () => {
  it('is due 2 business days after it arrives, skipping the weekend in Chile', () => {
    // Thursday Oct 15, 10:00 in Santiago → Monday Oct 19.
    assert.equal(businessDueAt(new Date('2026-10-15T13:00:00Z')).toISOString(), '2026-10-19T13:00:00.000Z')
    // Friday → Tuesday; Saturday → Tuesday.
    assert.equal(businessDueAt(new Date('2026-10-16T13:00:00Z')).toISOString(), '2026-10-20T13:00:00.000Z')
    assert.equal(businessDueAt(new Date('2026-10-17T13:00:00Z')).toISOString(), '2026-10-20T13:00:00.000Z')
    // Monday → Wednesday; one business day for a Brazilian withdrawal.
    assert.equal(businessDueAt(new Date('2026-10-12T13:00:00Z')).toISOString(), '2026-10-14T13:00:00.000Z')
    assert.equal(businessDueAt(new Date('2026-10-16T13:00:00Z'), 1).toISOString(), '2026-10-19T13:00:00.000Z')
  })

  it('has a short reference to quote', () => {
    for (let i = 0; i < 50; i += 1) {
      assert.match(newRef(), /^R-[0-9A-HJKMNP-TV-Z]{6}$/)
    }
  })
})
