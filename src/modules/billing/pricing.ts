import type { FastifyRequest } from 'fastify'

import { env } from '../../config/env.js'
import type { PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { requestGeo } from '../analytics/geo.js'

// Prices by where the buyer is (Oct 2026): the US list in dollars, and lower
// local prices for Brazil (reais, with PIX), Mexico (pesos) and the rest of
// Latin America (dollars). By country, not language: a Spanish speaker in
// Texas pays the US price; a Brazilian on the English pages pays in reais.
export type PricingRegion = 'us' | 'br' | 'mx' | 'latam'
export type Currency = 'usd' | 'brl' | 'mxn'

const REGIONS: readonly PricingRegion[] = ['us', 'br', 'mx', 'latam']

export function isPricingRegion(value: unknown): value is PricingRegion {
  return REGIONS.includes(value as PricingRegion)
}

const LATAM = new Set(['AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PE', 'PY', 'SV', 'UY', 'VE'])

export function regionForCountry(country: string | null | undefined): PricingRegion {
  const code = (country ?? '').toUpperCase()

  if (code === 'BR') {
    return 'br'
  }

  if (code === 'MX') {
    return 'mx'
  }

  return LATAM.has(code) ? 'latam' : 'us'
}

// A signed-in buyer pays where they signed up (so a trip or a VPN doesn't
// move their price); a visitor, where they are now (the site's geo cookie).
export function pricingRegion(request: FastifyRequest, user?: Pick<UserDocument, 'location'> | null): PricingRegion {
  return regionForCountry(user?.location?.country ?? requestGeo(request)?.country)
}

export const REGION_CURRENCY: Record<PricingRegion, Currency> = { us: 'usd', br: 'brl', mx: 'mxn', latam: 'usd' }

type Listed = Exclude<PurchaseProduct, 'color_addon' | 'style_addon'>

// Minor units of each region's currency (R$ 14,90 = 1490; MX$ 79 = 7900).
const REGION_AMOUNTS: Record<Exclude<PricingRegion, 'us'>, Record<Listed, number>> = {
  br: {
    color_report: 1490,
    style_report: 1990,
    reports_bundle: 2990,
    look_pack: 1490,
    color_mirror: 2490,
    hair_advisor: 1990,
    advisors_bundle: 4990,
    event_pass: 1490,
    magazine: 2490,
    outfit_guide: 3990,
    pro_monthly: 2490,
    pro_annual: 9990,
    pro_trial: 490,
  },
  mx: {
    color_report: 7900,
    style_report: 9900,
    reports_bundle: 14900,
    look_pack: 7900,
    color_mirror: 12900,
    hair_advisor: 9900,
    advisors_bundle: 24900,
    event_pass: 7900,
    magazine: 12900,
    outfit_guide: 19900,
    pro_monthly: 12900,
    pro_annual: 49900,
    pro_trial: 1900,
  },
  latam: {
    color_report: 299,
    style_report: 399,
    reports_bundle: 599,
    look_pack: 299,
    color_mirror: 499,
    hair_advisor: 399,
    advisors_bundle: 990,
    event_pass: 299,
    magazine: 499,
    outfit_guide: 790,
    pro_monthly: 499,
    pro_annual: 1990,
    pro_trial: 100,
  },
}

const US_AMOUNTS: Record<Listed, () => number> = {
  color_report: () => env.PRICE_COLOR_REPORT_CENTS,
  style_report: () => env.PRICE_STYLE_REPORT_CENTS,
  reports_bundle: () => env.PRICE_REPORTS_BUNDLE_CENTS,
  look_pack: () => env.PRICE_LOOK_PACK_CENTS,
  color_mirror: () => env.PRICE_COLOR_MIRROR_CENTS,
  hair_advisor: () => env.PRICE_HAIR_ADVISOR_CENTS,
  advisors_bundle: () => env.PRICE_ADVISORS_BUNDLE_CENTS,
  event_pass: () => env.PRICE_EVENT_CENTS,
  magazine: () => env.PRICE_MAGAZINE_CENTS,
  outfit_guide: () => env.PRICE_OUTFIT_GUIDE_CENTS,
  pro_monthly: () => env.PRICE_PRO_MONTHLY_CENTS,
  pro_annual: () => env.PRICE_PRO_ANNUAL_CENTS,
  pro_trial: () => env.PRICE_PRO_TRIAL_CENTS,
}

function listed(product: Listed, region: PricingRegion) {
  return region === 'us' ? US_AMOUNTS[product]() : REGION_AMOUNTS[region][product]
}

// What a product costs in a region, in that region's currency. The add-ons
// complete the pair at the bundle price there.
export function regionalAmount(product: PurchaseProduct, region: PricingRegion): number {
  if (product === 'color_addon') {
    return Math.max(50, listed('reports_bundle', region) - listed('style_report', region))
  }

  if (product === 'style_addon') {
    return Math.max(50, listed('reports_bundle', region) - listed('color_report', region))
  }

  return listed(product, region)
}

export function regionalPrice(product: PurchaseProduct, region: PricingRegion) {
  return { amount: regionalAmount(product, region), currency: REGION_CURRENCY[region] }
}

// Rough dollars for a purchase in another currency, for the admin's revenue
// (Stripe settles in euros; this only keeps the totals comparable).
const USD_PER_UNIT: Record<Currency, () => number> = {
  usd: () => 1,
  brl: () => env.FX_USD_PER_BRL,
  mxn: () => env.FX_USD_PER_MXN,
}

export function toUsdCents(amount: number, currency: string) {
  const rate = USD_PER_UNIT[currency as Currency]?.() ?? 1
  return Math.round(amount * rate)
}
