import type { FeedbackProduct, ProHalfOffer, UserDocument } from '../../types/mongo.js'
import { REGION_CURRENCY, regionalAmount, type PricingRegion } from '../billing/pricing.js'

// The rating at the end of each paid advisor's report (Silvio, Oct 2026):
// "How likely are you to recommend it?" 0–10 (the NPS question), a written
// review, and, for those who liked it, Pro's first month at half price.

export const FEEDBACK_PRODUCTS = ['color_advisor', 'style_advisor', 'hair_advisor'] as const satisfies readonly FeedbackProduct[]

export const COMMENT_MAX = 1000

// 9–10 recommend it, 7–8 are lukewarm, 0–6 would warn a friend off.
export function npsGroup(score: number) {
  return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor'
}

// Promoters' share minus detractors', from −100 to 100; null without answers.
export function npsScore(scores: number[]) {
  if (scores.length === 0) {
    return null
  }

  const promoters = scores.filter((score) => score >= 9).length
  const detractors = scores.filter((score) => score <= 6).length

  return Math.round(((promoters - detractors) / scores.length) * 100)
}

// Pro's first month at half price: for those who rated an advisor 7 or
// more and never had Pro (not even a trial), once per person, for a few days.
export const PRO_HALF = {
  percent: 50,
  minScore: 7,
  hours: 72,
}

type OfferFields = Pick<UserDocument, 'pro' | 'proTrialAt' | 'proHalfOffer'>

export function offerOpen(offer: ProHalfOffer | null | undefined, now = Date.now()): offer is ProHalfOffer {
  return Boolean(offer && !offer.usedAt && offer.until.getTime() > now)
}

// Whether a rating of `score` brings the offer now: never to anyone who had
// Pro, a trial or the offer already, nor to an admin's free access.
export function earnsOffer(user: OfferFields, score: number, comp: boolean) {
  return score >= PRO_HALF.minScore && !comp && !user.pro && !user.proTrialAt && !user.proHalfOffer
}

// The first month's price in the buyer's region: half of Pro monthly,
// rounded down to the cent, and what comes off.
export function halfPrice(region: PricingRegion) {
  const amount = regionalAmount('pro_monthly', region)
  const price = Math.floor((amount * (100 - PRO_HALF.percent)) / 100)

  return { amount, price, off: amount - price, currency: REGION_CURRENCY[region] }
}

// What the page shows of an open offer.
export function offerView(offer: ProHalfOffer | null | undefined, region: PricingRegion, now = Date.now()) {
  if (!offerOpen(offer, now)) {
    return null
  }

  return { percent: PRO_HALF.percent, from: offer.from, until: offer.until.toISOString(), ...halfPrice(region) }
}
