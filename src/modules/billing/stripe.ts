import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import Stripe from 'stripe'

import { env } from '../../config/env.js'
import type { ProSubscription, PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { PRODUCT_COPY } from '../../i18n/products.js'
import { isPlaceholderEmail } from '../../utils/deleted-accounts.js'
import { appUrl, isLocale, type Locale } from '../../utils/locale.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { trackServerEvent } from '../analytics/service.js'
import { fulfillGuide, isGuideSession } from '../guide/service.js'
import { sendTrialStartedEmail } from '../lifecycle/service.js'
import { reportPurchase } from './conversions.js'
import {
  annualFirstWeek,
  colorAddonCents,
  PRO_GRACE_MS,
  PRO_LIVE_STATUSES,
  proIsLive,
  rolloverCapApplies,
  rolloverCredits,
  rolloverCreditsExpression,
  styleAddonCents,
} from './entitlements.js'
import { isPricingRegion, type PricingRegion, REGION_CURRENCY, regionalAmount, regionalPrice, toUsdCents } from './pricing.js'

// Avarobe shares the Stripe account with Trimry. Everything Avarobe creates
// carries metadata app=avarobe and only that is handled here. Trimry's
// webhook skips one-time payments, and it can't match Avarobe subscriptions:
// they use their own customers and never send a Trimry-shaped reference.
const APP = 'avarobe'

type ProductConfig = {
  lookupKey: string
  name: string
  description: string
  amount: () => number
  // Credits per payment (per month for Pro).
  credits: () => number
  recurring?: 'month' | 'year'
  // What the payment unlocks, for good: the advisors, the color mirror.
  unlocks?: { color?: boolean; style?: boolean; mirror?: boolean; hair?: boolean }
  // Event Stylist passes per payment.
  events?: number
  // Personal magazines per payment.
  magazines?: number
}

export const PRODUCTS: Record<PurchaseProduct, ProductConfig> = {
  color_report: {
    lookupKey: 'avarobe_color_report_v2',
    name: 'Avarobe Color Advisor',
    description: 'Your full palette and a visual color report on your own face: drape test, boards and guides.',
    amount: () => env.PRICE_COLOR_REPORT_CENTS,
    credits: () => 0,
    unlocks: { color: true },
  },
  style_report: {
    lookupKey: 'avarobe_style_report_v1',
    name: 'Avarobe Style Advisor',
    description: 'Your style profile: the cuts, necklines and pieces that flatter you, shown on your avatar.',
    amount: () => env.PRICE_STYLE_REPORT_CENTS,
    credits: () => 0,
    unlocks: { style: true },
  },
  reports_bundle: {
    lookupKey: 'avarobe_reports_bundle_v1',
    name: 'Avarobe Color + Style Advisors',
    description: 'Both reports: your full color report and your style profile.',
    amount: () => env.PRICE_REPORTS_BUNDLE_CENTS,
    credits: () => 0,
    unlocks: { color: true, style: true },
  },
  color_addon: {
    lookupKey: 'avarobe_color_addon_v1',
    name: 'Avarobe Color Advisor (completes your set)',
    description: 'The Color Advisor at the bundle price, with your Style Advisor counted toward it.',
    amount: colorAddonCents,
    credits: () => 0,
    unlocks: { color: true },
  },
  style_addon: {
    lookupKey: 'avarobe_style_addon_v1',
    name: 'Avarobe Style Advisor (completes your set)',
    description: 'The Style Advisor at the bundle price, with your Color Advisor counted toward it.',
    amount: styleAddonCents,
    credits: () => 0,
    unlocks: { style: true },
  },
  color_mirror: {
    lookupKey: 'avarobe_color_mirror_v1',
    name: 'Avarobe Color Mirror',
    description: 'Every fabric draped under your face, live on your camera, with your #1 color and what each color does to you.',
    amount: () => env.PRICE_COLOR_MIRROR_CENTS,
    credits: () => 0,
    unlocks: { color: true, mirror: true },
  },
  hair_advisor: {
    lookupKey: 'avarobe_hair_advisor_v1',
    name: 'Avarobe Hair & Grooming Advisor',
    description: 'Every haircut picked for your face, shown on you with what to tell your stylist, and the hair colors that suit you.',
    amount: () => env.PRICE_HAIR_ADVISOR_CENTS,
    credits: () => 0,
    unlocks: { hair: true },
  },
  advisors_bundle: {
    lookupKey: 'avarobe_advisors_bundle_v1',
    name: 'Avarobe Color, Style and Hair & Grooming Advisors',
    description: 'All three advisors: your colors with the live mirror, your style profile, and every cut on you.',
    amount: () => env.PRICE_ADVISORS_BUNDLE_CENTS,
    credits: () => 0,
    unlocks: { color: true, style: true, hair: true, mirror: true },
  },
  outfit_guide: {
    lookupKey: 'avarobe_outfit_guide_v1',
    name: 'The Outfit Formula Book',
    description: '120 outfit formulas that always work, with the Color, Shape and Finish method. A PDF guide, yours to keep.',
    amount: () => env.PRICE_OUTFIT_GUIDE_CENTS,
    credits: () => 0,
  },
  event_pass: {
    lookupKey: 'avarobe_event_pass_v1',
    name: 'Avarobe Event Stylist',
    description: 'Dressed for one event: three looks on you for its dress code, similar pieces in stores, and how to finish them.',
    amount: () => env.PRICE_EVENT_CENTS,
    credits: () => 0,
    events: 1,
  },
  magazine: {
    lookupKey: 'avarobe_magazine_v1',
    name: 'Your Personal Magazine',
    description: 'Your own magazine: a cover, a letter from your stylist and ten looks on you, on location, in your colors.',
    amount: () => env.PRICE_MAGAZINE_CENTS,
    credits: () => 0,
    magazines: 1,
  },
  look_pack: {
    lookupKey: 'avarobe_look_pack_v1',
    name: 'Avarobe look pack',
    description: 'More looks for your occasions. They never expire.',
    amount: () => env.PRICE_LOOK_PACK_CENTS,
    credits: () => env.LOOK_PACK_CREDITS,
  },
  pro_monthly: {
    lookupKey: 'avarobe_pro_monthly_v1',
    name: 'Avarobe Pro (monthly)',
    description: 'New looks every month, all three advisors (Color, Style, Hair & Grooming), try-ons, similar pieces in stores and more.',
    amount: () => env.PRICE_PRO_MONTHLY_CENTS,
    credits: () => env.PRO_MONTHLY_CREDITS,
    recurring: 'month',
  },
  pro_annual: {
    lookupKey: 'avarobe_pro_annual_v1',
    name: 'Avarobe Pro (annual)',
    description: 'Everything in Pro for a year, with all three advisors included: Color, Style and Hair & Grooming.',
    amount: () => env.PRICE_PRO_ANNUAL_CENTS,
    credits: () => env.PRO_MONTHLY_CREDITS,
    recurring: 'year',
    unlocks: { color: true, style: true, hair: true },
  },
  // The fee for the first days of Pro. It's charged with the monthly
  // subscription's first (trial) invoice; the subscription itself is
  // pro_monthly and starts charging when the trial ends.
  pro_trial: {
    lookupKey: 'avarobe_pro_trial_fee_v1',
    name: 'Avarobe Pro trial',
    description: 'Your first days of Avarobe Pro. Then monthly, until you cancel.',
    amount: () => env.PRICE_PRO_TRIAL_CENTS,
    credits: () => env.PRO_TRIAL_CREDITS,
  },
}

const isPro = (product: string): product is 'pro_monthly' | 'pro_annual' =>
  product === 'pro_monthly' || product === 'pro_annual'

export class BillingNotConfiguredError extends Error {}

let client: Stripe | null = null

export function stripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY)
}

function stripe() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new BillingNotConfiguredError('Payments are not set up yet.')
  }

  client ??= new Stripe(env.STRIPE_SECRET_KEY)
  return client
}

const priceIds = new Map<string, string>()

// What card statements say for Pro (Oct 2026). The account is Trimry's, so
// without it a subscription charge would only carry the account's name;
// one-time payments add the suffix instead (`TRIMRY* AVAROBE`). Stripe takes
// a subscription invoice's descriptor from its first item's product.
const PRO_DESCRIPTOR = 'AVAROBE'
const describedProducts = new Set<string>()

// The descriptor is a nicety: if Stripe ever refuses it (its rules, the
// shared account, a hiccup), the checkout goes on without it and says so in
// the logs; it's tried again on the next run.
function descriptorRefused(productId: string, error: unknown) {
  console.error(
    `Stripe refused updating Pro product ${productId} (AVAROBE statement descriptor or copy); checkout goes on without it:`,
    error instanceof Error ? error.message : error,
  )
}

// Pro's products from before get the descriptor once per run (`current`: the
// descriptor already read, for a product just read), and the English one its
// current name and description (`copy`; the other languages' are kept up to
// date in localizedProduct).
async function ensureDescriptor(productId: string, options: { current?: string | null; copy?: { name: string; description: string } } = {}) {
  if (describedProducts.has(productId)) {
    return
  }

  try {
    const product = options.current !== undefined && !options.copy ? null : await stripe().products.retrieve(productId)
    const descriptor = product ? product.statement_descriptor : options.current

    if (product && options.copy && (product.name !== options.copy.name || product.description !== options.copy.description)) {
      await stripe().products.update(productId, { name: options.copy.name, description: options.copy.description })
    }

    if (descriptor !== PRO_DESCRIPTOR) {
      await stripe().products.update(productId, { statement_descriptor: PRO_DESCRIPTOR })
    }

    describedProducts.add(productId)
  } catch (error) {
    descriptorRefused(productId, error)
  }
}

// The product's name and description in the buyer's language.
export function productCopy(product: PurchaseProduct, locale: Locale = 'en') {
  const config = PRODUCTS[product]

  return locale === 'en' ? { name: config.name, description: config.description } : PRODUCT_COPY[locale][product]
}

const LOCALE_KEY: Record<Exclude<Locale, 'en'>, string> = { 'pt-BR': 'ptbr', es: 'es' }

// Checkout shows the product's own name, so each language has its own
// product (same metadata.product), under an id it's found by. The first use
// after a restart brings its name and description up to date.
async function localizedProduct(product: PurchaseProduct, locale: Exclude<Locale, 'en'>) {
  const id = `${PRODUCTS[product].lookupKey}_${LOCALE_KEY[locale]}`
  const copy = PRODUCT_COPY[locale][product]
  const descriptor = PRODUCTS[product].recurring ? { statement_descriptor: PRO_DESCRIPTOR } : {}

  try {
    const existing = await stripe().products.retrieve(id)

    if (existing.name !== copy.name || existing.description !== copy.description || !existing.active) {
      await stripe().products.update(id, { name: copy.name, description: copy.description, active: true })
    }

    if (PRODUCTS[product].recurring) {
      await ensureDescriptor(id, { current: existing.statement_descriptor ?? null })
    }

    return id
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.statusCode !== 404) {
      throw error
    }
  }

  try {
    await stripe().products.create({ id, ...copy, ...descriptor, metadata: { app: APP, product, locale } })
  } catch (error) {
    if (!PRODUCTS[product].recurring) {
      throw error
    }

    descriptorRefused(id, error)
    await stripe().products.create({ id, ...copy, metadata: { app: APP, product, locale } })
  }

  return id
}

// A new product in English (Pro's with the descriptor, without it if refused).
async function createProduct(product: PurchaseProduct) {
  const config = PRODUCTS[product]
  const base = { name: config.name, description: config.description, metadata: { app: APP, product } }

  if (config.recurring) {
    try {
      return (await stripe().products.create({ ...base, statement_descriptor: PRO_DESCRIPTOR })).id
    } catch (error) {
      descriptorRefused(config.lookupKey, error)
    }
  }

  return (await stripe().products.create(base)).id
}

// Finds the product's price by lookup key, creating product and price the
// first time (so a new account or live mode needs no dashboard setup). A
// changed amount gets a new price that takes over the lookup key. Each
// pricing region has its own price (and currency) on the same product; each
// language other than English, its own product.
async function priceFor(product: PurchaseProduct, region: PricingRegion = 'us', locale: Locale = 'en') {
  const config = PRODUCTS[product]
  const regional = region === 'us' ? config.lookupKey : `${config.lookupKey}_${region}`
  const lookupKey = locale === 'en' ? regional : `${regional}_${LOCALE_KEY[locale]}`
  const { amount, currency } = region === 'us' ? { amount: config.amount(), currency: 'usd' } : regionalPrice(product, region)
  const cacheKey = `${lookupKey}:${amount}`
  const cached = priceIds.get(cacheKey)

  if (cached) {
    return cached
  }

  const localized = locale === 'en' ? null : await localizedProduct(product, locale)
  const existing = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  const current = existing.data[0]

  // Pro's products from before the descriptor get it now (localized ones
  // above).
  if (config.recurring && !localized && typeof current?.product === 'string') {
    await ensureDescriptor(current.product, { copy: { name: config.name, description: config.description } })
  }

  if (current && current.unit_amount === amount && current.currency === currency) {
    priceIds.set(cacheKey, current.id)
    return current.id
  }

  // A region's first price joins the product the US price already has.
  const usPrice =
    !localized && !current && region !== 'us'
      ? (await stripe().prices.list({ lookup_keys: [config.lookupKey], limit: 1 })).data[0]
      : undefined
  const knownProduct =
    localized ??
    (typeof current?.product === 'string' ? current.product : typeof usPrice?.product === 'string' ? usPrice.product : null)

  if (config.recurring && !localized && !current && typeof usPrice?.product === 'string') {
    await ensureDescriptor(usPrice.product, { copy: { name: config.name, description: config.description } })
  }

  const productId = knownProduct ?? (await createProduct(product))
  const price = await stripe().prices.create({
    product: productId,
    currency,
    unit_amount: amount,
    ...(config.recurring ? { recurring: { interval: config.recurring } } : {}),
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { app: APP, product, region, locale },
  })

  priceIds.set(cacheKey, price.id)
  return price.id
}

// A one-time discount of `cents` for the first payment (reports counted
// toward Pro annual). One coupon per amount and currency, created on first use.
async function creditCoupon(cents: number, currency = 'usd') {
  const id = currency === 'usd' ? `avarobe_report_credit_${cents}` : `avarobe_report_credit_${cents}_${currency}`

  try {
    return (await stripe().coupons.retrieve(id)).id
  } catch {
    return (
      await stripe().coupons.create({
        id,
        name: 'Your reports, counted toward Pro',
        amount_off: cents,
        currency,
        duration: 'once',
        metadata: { app: APP },
      })
    ).id
  }
}

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', 'pt-BR': 'pt-BR', es: 'es-MX' }

const money = (cents: number, currency = 'usd', locale: Locale = 'en') =>
  new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

const longDate = (date: Date, locale: Locale = 'en') =>
  date.toLocaleDateString(INTL_LOCALE[locale], { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

// Checkout's own language for the buyer's (it localizes everything but our text).
const STRIPE_LOCALE: Record<Locale, Stripe.Checkout.SessionCreateParams.Locale> = { en: 'en', 'pt-BR': 'pt-BR', es: 'es-419' }

// When a trial started now would end (Stripe counts whole days from now).
export function trialEndFrom(now = new Date()) {
  return new Date(now.getTime() + env.PRO_TRIAL_DAYS * 24 * 60 * 60 * 1000)
}

// Checkout shows the Stripe account's name, Trimry's, unless told otherwise.
// This covers the top of the page; Stripe keeps the account name in its
// terms line and receipts. (Accepted by the API; not yet in this SDK's types.)
const BRANDING = {
  display_name: 'Avarobe',
  icon: { type: 'url', url: 'https://www.avarobe.com/brand/avarobe-logo.png' },
  background_color: '#F7F4EF',
  button_color: '#171412',
  border_style: 'pill',
  font_family: 'inter',
}

// The embedded form takes everything but the icon (Stripe refuses one there).
const EMBEDDED_BRANDING = Object.fromEntries(Object.entries(BRANDING).filter(([key]) => key !== 'icon'))

// What checkout says next to the pay button: how a subscription renews and
// how to cancel it, as auto-renewal laws ask; for one-time payments, that
// there is nothing recurring.
export function submitMessage(product: PurchaseProduct, region: PricingRegion = 'us', locale: Locale = 'en') {
  const config = PRODUCTS[product]
  const currency = REGION_CURRENCY[region]
  const price = (item: PurchaseProduct) => money(regionalAmount(item, region), currency, locale)
  const days = env.PRO_TRIAL_DAYS
  const ends = longDate(trialEndFrom(), locale)

  if (product === 'pro_trial') {
    return {
      en: `${price('pro_trial')} today for ${days} days of Pro. Then ${price('pro_monthly')} per month starting ${ends}, until you cancel. Cancel anytime before then in your Avarobe account settings and you won't be charged again.`,
      'pt-BR': `${price('pro_trial')} hoje por ${days} dias de Pro. Depois, ${price('pro_monthly')} por mês a partir de ${ends}, até você cancelar. Cancele quando quiser antes disso nas configurações da sua conta Avarobe e você não será cobrado de novo.`,
      es: `${price('pro_trial')} hoy por ${days} días de Pro. Después, ${price('pro_monthly')} al mes a partir del ${ends}, hasta que canceles. Cancela cuando quieras antes de esa fecha en la configuración de tu cuenta de Avarobe y no se te volverá a cobrar.`,
    }[locale]
  }

  if (config.recurring) {
    const every = { month: { en: 'month', 'pt-BR': 'mês', es: 'mes' }, year: { en: 'year', 'pt-BR': 'ano', es: 'año' } }[config.recurring][locale]
    const renews = {
      en: `Renews automatically at ${price(product)} per ${every} until you cancel. Cancel anytime in your Avarobe account settings; you keep Pro until the end of the period you paid for.`,
      'pt-BR': `Renova automaticamente por ${price(product)} por ${every} até você cancelar. Cancele quando quiser nas configurações da sua conta Avarobe; o Pro continua até o fim do período pago.`,
      es: `Se renueva automáticamente por ${price(product)} al ${every} hasta que canceles. Cancela cuando quieras en la configuración de tu cuenta de Avarobe; conservas Pro hasta el final del período que pagaste.`,
    }[locale]
    // Annual's first month comes in two parts (annualFirstWeek), said
    // before paying.
    const week = product === 'pro_annual' ? annualFirstWeek() : null

    return week
      ? `${renews} ${
          {
            en: `Your first ${week.now} looks come right away; the rest of the month’s ${env.PRO_MONTHLY_CREDITS} arrive ${week.days} days after you subscribe.`,
            'pt-BR': `Seus primeiros ${week.now} looks chegam na hora; o restante dos ${env.PRO_MONTHLY_CREDITS} do mês chega ${week.days} dias depois da assinatura.`,
            es: `Tus primeros ${week.now} looks llegan al instante; el resto de los ${env.PRO_MONTHLY_CREDITS} del mes llega ${week.days} días después de suscribirte.`,
          }[locale]
        }`
      : renews
  }

  return { en: 'One-time payment. No subscription.', 'pt-BR': 'Pagamento único. Sem assinatura.', es: 'Pago único. Sin suscripción.' }[locale]
}

// Every checkout asks them to accept our terms (Oct 2026): a required
// checkbox with Stripe's consent_collection, worded and linked here. The
// wording is required for it too: without it Stripe wants a terms URL in the
// account's dashboard, which is Trimry's (tested in test mode, hosted,
// embedded and subscription checkouts alike). A subscription's box also
// takes the renewal itself (California's automatic renewal law and the FTC
// ask for consent to it, not only a sentence beside Pay): the price and how
// often, until they cancel.
export function termsAcceptance(locale: Locale, product?: PurchaseProduct, region: PricingRegion = 'us') {
  const terms = appUrl(locale, '/terms')
  const privacy = appUrl(locale, '/privacy')
  const plan = product === 'pro_trial' ? 'pro_monthly' : product
  const recurring = plan ? PRODUCTS[plan].recurring : undefined

  if (plan && recurring) {
    const price = money(regionalAmount(plan, region), REGION_CURRENCY[region], locale)
    const trial = product === 'pro_trial'

    return {
      en: `I agree to Avarobe’s [Terms](${terms}) and [Privacy Policy](${privacy}), and that ${trial ? 'after the trial ' : ''}Pro renews automatically at ${price} per ${recurring} until I cancel.`,
      'pt-BR': `Concordo com os [Termos](${terms}) e a [Política de Privacidade](${privacy}) do Avarobe, e que ${trial ? 'depois do teste ' : ''}o Pro renova automaticamente por ${price} por ${recurring === 'year' ? 'ano' : 'mês'} até eu cancelar.`,
      es: `Acepto los [Términos](${terms}) y la [Política de Privacidad](${privacy}) de Avarobe, y que ${trial ? 'después de la prueba ' : ''}Pro se renueva automáticamente por ${price} al ${recurring === 'year' ? 'año' : 'mes'} hasta que lo cancele.`,
    }[locale]
  }

  return {
    en: `I agree to Avarobe’s [Terms](${terms}) and [Privacy Policy](${privacy}).`,
    'pt-BR': `Concordo com os [Termos](${terms}) e a [Política de Privacidade](${privacy}) do Avarobe.`,
    es: `Acepto los [Términos](${terms}) y la [Política de Privacidad](${privacy}) de Avarobe.`,
  }[locale]
}

// The sentence beside Pay when Stripe ever refuses the checkbox (the
// fallback in openSession): what a guest's checkout said before it.
const PAY_TERMS: Record<Locale, string> = {
  en: 'By paying, you agree to Avarobe’s terms and privacy policy.',
  'pt-BR': 'Ao pagar, você concorda com os termos e a política de privacidade do Avarobe.',
  es: 'Al pagar, aceptas los términos y la política de privacidad de Avarobe.',
}

// Opens a checkout with the terms checkbox. If Stripe refuses that one
// setting (it shouldn't, see termsAcceptance), it's logged and the checkout
// opens anyway, with the sentence beside Pay instead: a checkout never fails
// over it.
async function openSession(params: Stripe.Checkout.SessionCreateParams, locale: Locale, product?: PurchaseProduct, region?: PricingRegion) {
  const text = params.custom_text?.submit
  const submit = text ? text.message : ''

  try {
    return await stripe().checkout.sessions.create({
      ...params,
      consent_collection: { terms_of_service: 'required' },
      custom_text: { ...params.custom_text, terms_of_service_acceptance: { message: termsAcceptance(locale, product, region) } },
    })
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || !/consent|terms of service|terms_of_service/i.test(`${error.param ?? ''} ${error.message}`)) {
      throw error
    }

    console.error('Stripe refused the terms checkbox; checkout opened with the sentence instead:', error.message)

    return stripe().checkout.sessions.create({
      ...params,
      custom_text: { ...params.custom_text, submit: { message: `${submit} ${PAY_TERMS[locale]}`.trim() } },
    })
  }
}

export async function createCheckout(input: {
  user: Pick<UserDocument, '_id' | 'email' | 'locale'>
  product: PurchaseProduct
  returnPath: string
  // Reports bought recently, counted toward Pro annual.
  discountCents?: number
  // Analytics ids for server-side purchase events (conversions.ts).
  attribution?: Record<string, string>
  // Checkout inside our page (Stripe's embedded form) instead of Stripe's:
  // the web asks for it in Instagram's and Facebook's browsers, where a
  // card is typed either way and leaving for checkout.stripe.com lost most
  // buyers (Oct 5: 3 of 16 paid there, 9 of 18 in Safari or Chrome).
  embedded?: boolean
  // Where the buyer pays from (billing/pricing.ts): price and currency.
  region?: PricingRegion
  // Which offer led here (first-party analytics). It rides in the metadata
  // to the purchase, so a checkout opened from an email (no click in the
  // app to count) is attributed too.
  placement?: string
}): Promise<{ url: string | null; clientSecret: string | null }> {
  const userId = input.user._id.toString()
  const region = input.region ?? 'us'
  const locale = input.user.locale ?? 'en'
  const guest = isPlaceholderEmail(input.user.email)
  const metadata = {
    ...input.attribution,
    app: APP,
    product: input.product,
    userId,
    region,
    locale,
    ...(input.placement ? { placement: input.placement } : {}),
  }
  const discount =
    input.discountCents && input.discountCents > 0 ? await creditCoupon(input.discountCents, REGION_CURRENCY[region]) : null
  const common = {
    line_items: [{ price: await priceFor(input.product, region, locale), quantity: 1 }],
    locale: STRIPE_LOCALE[locale],
    // Not a bare ObjectId, so Trimry's webhook can never take it for one of
    // its own records.
    client_reference_id: `${APP}_${userId}`,
    // A guest has no email yet: Stripe asks for it, and the account takes
    // it once the payment goes through (guest-checkout.ts).
    ...(guest ? {} : { customer_email: input.user.email }),
    metadata,
    // Stripe takes either a discount or the promotion code field. The field
    // is left to subscriptions: on a $5 purchase it sends people off to
    // hunt for a code.
    ...(discount
      ? { discounts: [{ coupon: discount }] }
      : PRODUCTS[input.product].recurring || input.product === 'pro_trial'
        ? { allow_promotion_codes: true }
        : {}),
    custom_text: { submit: { message: submitMessage(input.product, region, locale) } },
    // The embedded form comes back to the same success page; closing it is
    // the way back, so it has no cancel link.
    ...(input.embedded
      ? {
          ui_mode: 'embedded' as const,
          branding_settings: EMBEDDED_BRANDING,
          return_url: `${appUrl(input.user.locale, '/studio/billing/success')}?session_id={CHECKOUT_SESSION_ID}`,
        }
      : {
          branding_settings: BRANDING,
          success_url: `${appUrl(input.user.locale, '/studio/billing/success')}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl(input.user.locale, input.returnPath)}?checkout=cancelled&product=${input.product}`,
        }),
  }
  const params: Stripe.Checkout.SessionCreateParams =
    input.product === 'pro_trial'
      ? {
          ...common,
          mode: 'subscription',
          // The monthly plan with a trial, plus the trial fee on its first
          // invoice. The subscription is pro_monthly; `trial` marks how it
          // started, so its first invoice is granted as the trial.
          line_items: [
            { price: await priceFor('pro_monthly', region, locale), quantity: 1 },
            { price: await priceFor('pro_trial', region, locale), quantity: 1 },
          ],
          subscription_data: {
            trial_period_days: env.PRO_TRIAL_DAYS,
            metadata: { ...metadata, product: 'pro_monthly', trial: 'pro_trial' },
          },
        }
      : PRODUCTS[input.product].recurring
    ? { ...common, mode: 'subscription', subscription_data: { metadata } }
    : {
        ...common,
        mode: 'payment',
        // The account is shared with Trimry: without this, card statements
        // would only say the account's name.
        payment_intent_data: { metadata, statement_descriptor_suffix: 'AVAROBE' },
      }
  const session = await openSession(params, locale, input.product, region)

  if (input.embedded ? !session.client_secret : !session.url) {
    throw new Error('Stripe returned a checkout session without a URL or client secret.')
  }

  return { url: session.url ?? null, clientSecret: input.embedded ? session.client_secret : null }
}

// The Outfit Formula Book: a checkout open to guests (Stripe asks for the
// email). A signed-in buyer's account is noted too, so it shows in their
// purchases.
export async function createGuideCheckout(input: {
  userId: string | null
  email: string | null
  attribution?: Record<string, string>
  locale?: Locale
  region?: PricingRegion
}) {
  const metadata = { ...input.attribution, app: APP, product: 'outfit_guide', ...(input.userId ? { userId: input.userId } : {}) }
  // Branding rides along like in createCheckout (newer than these types).
  const extra = { branding_settings: BRANDING }
  const params: Stripe.Checkout.SessionCreateParams = {
    ...extra,
    mode: 'payment',
    line_items: [{ price: await priceFor('outfit_guide', input.region ?? 'us', input.locale ?? 'en'), quantity: 1 }],
    locale: STRIPE_LOCALE[input.locale ?? 'en'],
    client_reference_id: `${APP}_guide_${input.userId ?? 'guest'}`,
    ...(input.email ? { customer_email: input.email } : {}),
    metadata,
    custom_text: {
      submit: {
        message: {
          en: 'One-time payment. Instant PDF download, and we email it to you too.',
          'pt-BR': 'Pagamento único. Download imediato do PDF, e também enviamos por e-mail.',
          es: 'Pago único. Descarga inmediata del PDF, y también te lo enviamos por email.',
        }[input.locale ?? 'en'],
      },
    },
    payment_intent_data: { metadata, statement_descriptor_suffix: 'AVAROBE' },
    success_url: `${appUrl(input.locale, '/guide/thanks')}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl(input.locale, '/guide')}?checkout=cancelled`,
  }
  const session = await openSession(params, input.locale ?? 'en')

  if (!session.url) {
    throw new Error('Stripe returned a checkout session without a URL.')
  }

  return session.url
}

// The latest Avarobe checkouts as Stripe has them (the admin's checkout
// table): what was opened, and whether it was paid, abandoned or is open.
// Checkouts opened between two moments (the admin's Pacific days).
export async function recentCheckouts(since: Date, until: Date) {
  const sessions: Stripe.Checkout.Session[] = []
  const created = { gte: Math.floor(since.getTime() / 1000), lt: Math.floor(until.getTime() / 1000) }

  for await (const session of stripe().checkout.sessions.list({ created, limit: 100 })) {
    if (session.metadata?.app === APP) {
      sessions.push(session)
    }

    if (sessions.length >= 200) {
      break
    }
  }

  return sessions.map((session) => ({
    id: session.id.slice(-8),
    createdAt: new Date(session.created * 1000).toISOString(),
    product: session.metadata?.product ?? 'unknown',
    userId: session.metadata?.userId ?? null,
    amount: session.amount_total ?? 0,
    status: session.status ?? 'unknown',
    paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
  }))
}

export async function retrieveSession(sessionId: string) {
  return stripe().checkout.sessions.retrieve(sessionId)
}

// Gives a payment back in full (an approved refund request). `idempotencyKey`
// is one per approval attempt (billing/refunds.ts refundKey): a network
// retry of the same call refunds once, and a new attempt after a Stripe
// error is never answered with the earlier attempt's result. Refunding twice
// is stopped by the purchase marked first and by Stripe's
// charge_already_refunded.
export async function refundPayment(paymentIntentId: string, metadata: Record<string, string>, idempotencyKey: string) {
  const refund = await stripe().refunds.create(
    { payment_intent: paymentIntentId, reason: 'requested_by_customer', metadata: { ...metadata, app: APP } },
    { idempotencyKey },
  )

  return refund.id
}

// The payment behind a paid invoice (a Pro payment), as API 2025-08-27.basil
// has it: through the invoice's payments.
async function invoicePaymentIntent(invoiceId: string) {
  const payments = await stripe().invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 1 })
  return readId(payments.data[0]?.payment.payment_intent)
}

// A Pro payment given back in full: its invoice's payment, refunded like any
// other (tested in test mode). Returns the refund and the payment it found.
export async function refundInvoice(invoiceId: string, metadata: Record<string, string>, idempotencyKey: string) {
  const paymentIntentId = await invoicePaymentIntent(invoiceId)

  if (!paymentIntentId) {
    throw new Error(`Invoice ${invoiceId} has no paid payment to refund.`)
  }

  return { refundId: await refundPayment(paymentIntentId, metadata, idempotencyKey), paymentIntentId }
}

export type PaymentFacts = {
  brand: string | null
  last4: string | null
  country: string | null
  // Stripe's anonymous card id: the same card on another account's request.
  fingerprint: string | null
  disputed: boolean
}

// The card behind a payment, for a refund request: who's in Brazil (the
// card's country is one of the signals), the same card elsewhere, a dispute.
// Best effort and quick: a refund request never waits on it for long.
export async function paymentFacts(source: { paymentIntentId?: string | null; invoiceId?: string | null }): Promise<PaymentFacts | null> {
  const paymentIntentId = source.paymentIntentId ?? (source.invoiceId ? await invoicePaymentIntent(source.invoiceId) : null)

  if (!paymentIntentId) {
    return null
  }

  const intent = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }, { timeout: 3_000 })
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
  const card = charge?.payment_method_details?.card

  return {
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    country: card?.country ?? null,
    fingerprint: card?.fingerprint ?? null,
    disputed: Boolean(charge?.disputed),
  }
}

// Stripe said the charge was refunded already (in its dashboard, say): the
// money is back, which is what a refund wanted.
export function alreadyRefunded(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'charge_already_refunded'
}

// Payments made with Stripe's test keys (local QA, an admin's smoke test).
export function stripeTestMode() {
  return Boolean(env.STRIPE_SECRET_KEY?.match(/^(sk|rk)_test_/))
}

// The invoice a payment paid, for a refund made in Stripe on a Pro payment
// recorded before purchases kept their payment (charge.refunded).
export async function invoiceOfPayment(paymentIntentId: string) {
  const payments = await stripe().invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 })
  return readId(payments.data[0]?.invoice)
}

export function verifyWebhook(payload: string, signature: string) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new BillingNotConfiguredError('The Stripe webhook secret is not set.')
  }

  return stripe().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET)
}

// Paid, or free through a 100% promotion code (gifts, live tests).
export function sessionSettled(session: Stripe.Checkout.Session) {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
}

const readId = (value: string | { id?: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null)

export function avarobeUserId(metadata: Stripe.Metadata | null | undefined) {
  if (metadata?.app !== APP || !ObjectId.isValid(metadata.userId ?? '')) {
    return null
  }

  return new ObjectId(metadata.userId)
}

export function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

type Grant = {
  userId: ObjectId
  product: PurchaseProduct
  paymentKey: string
  paymentIntentId: string | null
  amount: number
  currency: string
  // Extra fields to set on the user alongside credits and reports.
  set?: (user: UserDocument) => Partial<UserDocument>
  // The offer the checkout came from (createCheckout's placement).
  placement?: string | null
  // Credits this payment grants, when not the product's usual (annual's
  // first payment holds some back).
  credits?: number
  // A Pro renewal or plan switch: its looks roll over only up to
  // PRO_ROLLOVER_CAP (rolloverCredits), once a payment since the cap marked
  // the subscription (rolloverCapApplies). The purchase records what it added.
  rollover?: boolean
  // The terms accepted at checkout (session.consent), when known.
  terms?: 'accepted' | null
}

// Records one payment and applies it to the user in a transaction: credits,
// the reports it unlocks and any product-specific fields. Returns false if
// it was already applied.
async function applyGrant(app: FastifyInstance, grant: Grant) {
  if (await app.collections.purchases.findOne({ stripeSessionId: grant.paymentKey }, { projection: { _id: 1 } })) {
    return false
  }

  const config = PRODUCTS[grant.product]
  const due = grant.credits ?? config.credits()
  // What she paid for, for products that unlock her colors: her season now
  // and the read it came from (a later read can't silently replace it).
  const avatar =
    config.unlocks?.color || config.unlocks?.mirror
      ? await app.collections.avatars.findOne({ userId: grant.userId }, { projection: { colorAnalysis: 1, colorsSource: 1 } })
      : null
  const colorRead = avatar?.colorAnalysis ? { season: avatar.colorAnalysis.season, readId: avatar.colorsSource?.readId ?? null } : null
  const mongoSession = app.mongoClient.startSession()

  try {
    await mongoSession.withTransaction(async () => {
      const user = await app.collections.users.findOne({ _id: grant.userId }, { session: mongoSession })

      if (!user) {
        throw new Error(`Payment ${grant.paymentKey} for a missing user.`)
      }

      const balance = user.credits ?? env.FREE_CREDITS
      const credits = grant.rollover && rolloverCapApplies(user.pro) ? rolloverCredits(balance, due) : due

      // A concurrent grant of the same payment fails here on the unique
      // index, which aborts this transaction (handled below).
      await app.collections.purchases.insertOne(
        {
          _id: new ObjectId(),
          userId: grant.userId,
          product: grant.product,
          stripeSessionId: grant.paymentKey,
          stripePaymentIntentId: grant.paymentIntentId,
          amountTotal: grant.amount,
          currency: grant.currency,
          amountUsd: toUsdCents(grant.amount, grant.currency),
          credits,
          ...(credits < due ? { creditsOverCap: due - credits } : {}),
          createdAt: new Date(),
          ...(config.unlocks?.color || config.unlocks?.mirror ? { colorRead } : {}),
          ...(grant.placement ? { placement: grant.placement } : {}),
          ...(grant.terms ? { terms: grant.terms } : {}),
        },
        { session: mongoSession },
      )

      const now = new Date()

      await app.collections.users.updateOne(
        { _id: grant.userId },
        {
          $set: {
            credits: balance + credits,
            paidAt: user.paidAt ?? now,
            ...(config.unlocks?.color ? { colorReportAt: user.colorReportAt ?? now } : {}),
            ...(config.unlocks?.style ? { styleReportAt: user.styleReportAt ?? now } : {}),
            // A Style Advisor bought after the split doesn't bring the cuts.
            ...(config.unlocks?.style && !config.unlocks.hair && !user.styleReportAt ? { styleWithoutHair: true } : {}),
            ...(config.unlocks?.hair ? { hairAdvisorAt: user.hairAdvisorAt ?? now } : {}),
            ...(config.unlocks?.mirror ? { colorMirrorAt: user.colorMirrorAt ?? now } : {}),
            ...(config.events ? { eventCredits: (user.eventCredits ?? 0) + config.events } : {}),
            ...(config.magazines ? { magazineCredits: (user.magazineCredits ?? 0) + config.magazines } : {}),
            ...(grant.set?.(user) ?? {}),
            updatedAt: now,
          },
        },
        { session: mongoSession },
      )
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false
    }

    throw error
  } finally {
    await mongoSession.endSession()
  }

  await trackServerEvent(app, {
    name: 'purchase_completed',
    userId: grant.userId,
    props: {
      product: grant.product,
      amount: grant.amount,
      currency: grant.currency,
      ...(grant.placement ? { placement: grant.placement } : {}),
    },
  })

  return true
}

async function subscriptionPeriodEnd(subscriptionId: string) {
  try {
    const subscription = await stripe().subscriptions.retrieve(subscriptionId)
    const end = subscription.items.data[0]?.current_period_end

    return end ? new Date(end * 1000) : null
  } catch {
    return null
  }
}

async function subscriptionTrialEnd(subscriptionId: string) {
  try {
    const subscription = await stripe().subscriptions.retrieve(subscriptionId)

    return subscription.trial_end ? new Date(subscription.trial_end * 1000) : null
  } catch {
    return null
  }
}

// Grants a paid Avarobe checkout session. For Pro it grants the first
// payment through its invoice, the same key the invoice webhook uses.
export async function grantSession(app: FastifyInstance, session: Stripe.Checkout.Session) {
  // The Outfit Formula Book, guests included: its own order and email; a
  // signed-in buyer's purchase is recorded below like any other.
  if (isGuideSession(session)) {
    await fulfillGuide(app, session)
  }

  const userId = avarobeUserId(session.metadata)
  const product = session.metadata?.product

  if (!userId || !product || !(product in PRODUCTS) || !sessionSettled(session)) {
    return null
  }

  if (session.mode === 'subscription') {
    const subscriptionId = readId(session.subscription)

    if (subscriptionId && product === 'pro_trial') {
      const applied = await grantProTrial(app, {
        userId,
        paymentKey: readId(session.invoice) ?? session.id,
        subscriptionId,
        customerId: readId(session.customer),
        trialEnd: (await subscriptionTrialEnd(subscriptionId)) ?? trialEndFrom(),
        amount: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        placement: session.metadata?.placement ?? null,
        terms: termsOf(session),
      })

      if (applied) {
        void reportSession(app, session, product)
      } else {
        await noteTerms(app, readId(session.invoice) ?? session.id, session)
      }

      return userId
    }

    if (!subscriptionId || !isPro(product)) {
      return null
    }

    const applied = await grantProPayment(app, {
      userId,
      product,
      paymentKey: readId(session.invoice) ?? session.id,
      subscriptionId,
      customerId: readId(session.customer),
      periodEnd: (await subscriptionPeriodEnd(subscriptionId)) ?? addMonths(new Date(), product === 'pro_annual' ? 12 : 1),
      amount: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      first: true,
      placement: session.metadata?.placement ?? null,
      terms: termsOf(session),
    })

    if (applied) {
      void reportSession(app, session, product)
    } else {
      // invoice.paid granted it first: the checkbox is only on the session.
      await noteTerms(app, readId(session.invoice) ?? session.id, session)
    }

    return userId
  }

  const applied = await applyGrant(app, {
    userId,
    product: product as PurchaseProduct,
    paymentKey: session.id,
    paymentIntentId: readId(session.payment_intent),
    amount: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    placement: session.metadata?.placement ?? null,
    terms: termsOf(session),
  })

  if (applied) {
    void reportSession(app, session, product)
  }

  return userId
}

// Whether they ticked the terms at checkout (consent_collection).
function termsOf(session: Stripe.Checkout.Session) {
  return session.consent?.terms_of_service === 'accepted' ? ('accepted' as const) : null
}

async function noteTerms(app: FastifyInstance, paymentKey: string, session: Stripe.Checkout.Session) {
  const terms = termsOf(session)

  if (terms) {
    await app.collections.purchases.updateOne({ stripeSessionId: paymentKey, terms: null }, { $set: { terms } })
  }
}

// Once per purchase, whichever of the success page or the webhooks grants
// it. Pro goes by its first invoice, the id the invoice webhook has too.
function reportSession(app: FastifyInstance, session: Stripe.Checkout.Session, product: string) {
  return reportPurchase(app, {
    metadata: session.metadata,
    transactionId: readId(session.invoice) ?? session.id,
    product,
    amount: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    checkout: { email: session.customer_details?.email ?? session.customer_email, country: session.customer_details?.address?.country },
  }).catch(() => undefined)
}

// A subscription's first invoice, when invoice.paid grants it before the
// checkout does. The subscription carries the checkout's browser ids.
function reportFirstInvoice(app: FastifyInstance, invoice: Stripe.Invoice, invoiceId: string, product: string) {
  return reportPurchase(app, {
    metadata: invoice.parent?.subscription_details?.metadata,
    transactionId: invoiceId,
    product,
    amount: invoice.amount_paid,
    currency: invoice.currency,
    checkout: { email: invoice.customer_email, country: invoice.customer_address?.country },
  }).catch(() => undefined)
}

// One Pro payment (the first one, a renewal, or the switch to annual): its
// credits, the reports annual includes, and the subscription's state.
// Annual plans get the rest of each year's monthly looks from
// refillAnnualCredits, starting a month after every annual payment. A new
// annual subscription's first month comes in two parts (annualFirstWeek).
// Renewals and switches roll over up to PRO_ROLLOVER_CAP; the first payment
// adds its looks in full, and so does the next payment of a subscription paid
// before the cap (rolloverCapApplies).
// Every payment starts a new month of avatar renders (the object is
// replaced) and marks the subscription as under the avatar and rollover caps.
async function grantProPayment(
  app: FastifyInstance,
  input: {
    userId: ObjectId
    product: 'pro_monthly' | 'pro_annual'
    paymentKey: string
    subscriptionId: string
    customerId: string | null
    periodEnd: Date
    amount: number
    currency: string
    // The subscription's first payment (not a renewal or a plan switch).
    first?: boolean
    placement?: string | null
    terms?: 'accepted' | null
    // The invoice's payment, when the invoice carries it (for refunds).
    paymentIntentId?: string | null
  },
) {
  const interval = input.product === 'pro_annual' ? 'year' : 'month'
  const now = new Date()
  const firstWeek = input.product === 'pro_annual' && input.first ? annualFirstWeek() : null
  const applied = await applyGrant(app, {
    userId: input.userId,
    product: input.product,
    paymentKey: input.paymentKey,
    paymentIntentId: input.paymentIntentId ?? null,
    amount: input.amount,
    currency: input.currency,
    placement: input.placement ?? null,
    terms: input.terms ?? null,
    ...(firstWeek ? { credits: firstWeek.now } : {}),
    rollover: !input.first,
    set: (user) => ({
      pro: {
        subscriptionId: input.subscriptionId,
        customerId: input.customerId,
        status: 'active',
        interval,
        periodEnd: input.periodEnd,
        cancelAtPeriodEnd: user.pro?.subscriptionId === input.subscriptionId ? user.pro.cancelAtPeriodEnd : false,
        nextCreditsAt: interval === 'year' ? addMonths(now, 1) : null,
        avatarCap: true,
        rolloverCap: true,
        ...(firstWeek ? { heldCredits: { amount: firstWeek.held, at: new Date(now.getTime() + firstWeek.days * 24 * 60 * 60 * 1000) } } : {}),
      },
    }),
  })

  // Already granted (the success page and the webhook both report it); still
  // keep the period end current, and the payment the other one didn't have.
  if (!applied) {
    await app.collections.users.updateOne(
      { _id: input.userId, 'pro.subscriptionId': input.subscriptionId },
      { $max: { 'pro.periodEnd': input.periodEnd } },
    )
    await notePayment(app, input.paymentKey, input.paymentIntentId)
  }

  return applied
}

async function notePayment(app: FastifyInstance, paymentKey: string, paymentIntentId: string | null | undefined) {
  if (paymentIntentId) {
    await app.collections.purchases.updateOne({ stripeSessionId: paymentKey, stripePaymentIntentId: null }, { $set: { stripePaymentIntentId: paymentIntentId } })
  }
}

// The payment an invoice.paid event carries, when it carries its payments.
function paidIntent(invoice: Stripe.Invoice) {
  return readId(invoice.payments?.data.find((payment) => payment.status === 'paid')?.payment.payment_intent)
}

// The trial's first invoice (the trial fee): the trial looks, and Pro in
// 'trialing' until the first monthly charge. Its key is that invoice, like
// every Pro payment, so the success page and the webhook grant it once.
async function grantProTrial(
  app: FastifyInstance,
  input: {
    userId: ObjectId
    paymentKey: string
    subscriptionId: string
    customerId: string | null
    trialEnd: Date
    amount: number
    currency: string
    placement?: string | null
    terms?: 'accepted' | null
    paymentIntentId?: string | null
  },
) {
  const now = new Date()
  const applied = await applyGrant(app, {
    userId: input.userId,
    product: 'pro_trial',
    paymentKey: input.paymentKey,
    paymentIntentId: input.paymentIntentId ?? null,
    amount: input.amount,
    currency: input.currency,
    placement: input.placement ?? null,
    terms: input.terms ?? null,
    set: (user) => ({
      proTrialAt: user.proTrialAt ?? now,
      pro: {
        subscriptionId: input.subscriptionId,
        customerId: input.customerId,
        status: 'trialing',
        interval: 'month',
        periodEnd: input.trialEnd,
        cancelAtPeriodEnd: false,
        nextCreditsAt: null,
        trialEnd: input.trialEnd,
        avatarCap: true,
        rolloverCap: true,
      },
    }),
  })

  if (applied) {
    void sendTrialStartedEmail(app, input.userId).catch((error: unknown) => {
      app.log.error({ err: error, userId: input.userId.toString() }, 'Trial email failed')
    })
  } else {
    await notePayment(app, input.paymentKey, input.paymentIntentId)
  }

  return applied
}

// invoice.paid: the first payment (if the success page didn't get there
// first), every renewal and the switch from monthly to annual. A trial's
// first invoice is the trial fee; the first monthly charge comes when the
// trial ends, as a regular renewal.
export async function handleInvoicePaid(app: FastifyInstance, invoice: Stripe.Invoice) {
  const details = invoice.parent?.subscription_details
  const userId = avarobeUserId(details?.metadata)
  const subscriptionId = readId(details?.subscription)
  const product = details?.metadata?.product ?? ''

  if (!userId || !subscriptionId || !invoice.id || !isPro(product)) {
    return
  }

  // Renewals and the switch to annual aren't purchases from an ad.
  const first = invoice.billing_reason === 'subscription_create'

  if (details?.metadata?.trial === 'pro_trial' && first) {
    const applied = await grantProTrial(app, {
      userId,
      paymentKey: invoice.id,
      subscriptionId,
      customerId: readId(invoice.customer),
      trialEnd: (await subscriptionTrialEnd(subscriptionId)) ?? trialEndFrom(),
      amount: invoice.amount_paid,
      currency: invoice.currency,
      placement: details?.metadata?.placement ?? null,
      paymentIntentId: paidIntent(invoice),
    })

    if (applied) {
      void reportFirstInvoice(app, invoice, invoice.id, 'pro_trial')
    }

    return
  }

  // A plan change inside a trial bills $0 and the trial goes on: nothing
  // was paid, so nothing is granted.
  if (invoice.billing_reason === 'subscription_update' && invoice.total <= 0) {
    return
  }

  // The line for the new period (a plan switch also carries a proration
  // credit line for the unused time).
  const lineEnd = Math.max(0, ...invoice.lines.data.map((line) => line.period.end))

  const applied = await grantProPayment(app, {
    userId,
    product,
    paymentKey: invoice.id,
    subscriptionId,
    customerId: readId(invoice.customer),
    periodEnd: lineEnd ? new Date(lineEnd * 1000) : addMonths(new Date(), product === 'pro_annual' ? 12 : 1),
    amount: invoice.amount_paid,
    currency: invoice.currency,
    first,
    // Only the first payment came from an offer.
    placement: first ? (details?.metadata?.placement ?? null) : null,
    paymentIntentId: paidIntent(invoice),
  })

  if (applied && first) {
    void reportFirstInvoice(app, invoice, invoice.id, product)
  }
}

function intervalOf(subscription: Stripe.Subscription): ProSubscription['interval'] {
  return subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'year' : 'month'
}

// customer.subscription.updated / deleted: cancellations, failed payments,
// plan changes. The monthly-looks schedule of annual plans is left to the
// payments, except that a monthly plan has none.
export async function handleSubscriptionChange(app: FastifyInstance, subscription: Stripe.Subscription) {
  const userId = avarobeUserId(subscription.metadata)

  if (!userId) {
    return
  }

  const end = subscription.items.data[0]?.current_period_end
  const periodEnd = subscription.ended_at
    ? new Date(subscription.ended_at * 1000)
    : end
      ? new Date(end * 1000)
      : null
  const interval = intervalOf(subscription)
  const now = new Date()

  // A late event about an older subscription (one refunded and cancelled at
  // once, then a new one bought; webhooks retry for days) never overwrites
  // the newer one while that one is live.
  const result = await app.collections.users.updateOne(
    {
      _id: userId,
      $or: [
        { 'pro.subscriptionId': subscription.id },
        { 'pro.subscriptionId': null },
        { 'pro.status': { $nin: [...PRO_LIVE_STATUSES] } },
        { 'pro.periodEnd': null },
        { 'pro.periodEnd': { $lte: new Date(now.getTime() - PRO_GRACE_MS) } },
      ],
    },
    {
      $set: {
        'pro.subscriptionId': subscription.id,
        'pro.customerId': readId(subscription.customer),
        'pro.status': subscription.status,
        'pro.interval': interval,
        'pro.periodEnd': periodEnd,
        'pro.cancelAtPeriodEnd': subscription.cancel_at_period_end,
        'pro.trialEnd': subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        ...(interval === 'month' ? { 'pro.nextCreditsAt': null } : {}),
        updatedAt: now,
      },
    },
  )

  if (result.matchedCount === 0) {
    app.log.info({ userId: userId.toString(), subscriptionId: subscription.id, status: subscription.status }, 'Subscription event for an older subscription ignored')
  }
}

// Cancels Pro at the end of the paid period, or undoes that. Done here
// rather than in Stripe's Customer Portal: portal settings are shared with
// Trimry's account, and the first configuration becomes the account default.
export async function setProCancellation(app: FastifyInstance, subscriptionId: string, cancel: boolean) {
  const subscription = await stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel })

  await handleSubscriptionChange(app, subscription)
  return subscription
}

// Ends Pro right away when they delete their account, so a trial doesn't
// turn into a charge (or a renewal go through) for an account that no
// longer exists. One Stripe already removed is fine.
export async function cancelProNow(subscriptionId: string) {
  try {
    await stripe().subscriptions.cancel(subscriptionId)
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
      return
    }

    throw error
  }
}

export class SwitchDeclinedError extends Error {}

// A plan change Stripe charges right away, and what that payment grants.
// The payment has to go through or nothing changes.
async function chargeSubscriptionChange(
  app: FastifyInstance,
  subscriptionId: string,
  params: Stripe.SubscriptionUpdateParams,
) {
  let updated: Stripe.Subscription

  try {
    updated = await stripe().subscriptions.update(subscriptionId, {
      ...params,
      payment_behavior: 'error_if_incomplete',
      cancel_at_period_end: false,
      expand: ['latest_invoice'],
    })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeCardError) {
      throw new SwitchDeclinedError(error.message)
    }

    throw error
  }

  await handleSubscriptionChange(app, updated)

  const invoice = updated.latest_invoice

  if (invoice && typeof invoice !== 'string' && invoice.status === 'paid') {
    await handleInvoicePaid(app, invoice)
  }

  return updated
}

// Moves a monthly plan to annual right away. Stripe charges the annual
// price minus the unused part of the month, and the year starts today.
export async function switchToAnnual(app: FastifyInstance, subscriptionId: string) {
  const current = await stripe().subscriptions.retrieve(subscriptionId)
  const item = current.items.data[0]

  if (!item) {
    throw new Error(`Subscription ${subscriptionId} has no items.`)
  }

  // In the currency and language it was bought in: Stripe refuses to mix
  // currencies on one subscription.
  const region = isPricingRegion(current.metadata?.region) ? current.metadata.region : 'us'
  const locale = isLocale(current.metadata?.locale) ? current.metadata.locale : 'en'

  return chargeSubscriptionChange(app, subscriptionId, {
    items: [{ id: item.id, price: await priceFor('pro_annual', region, locale) }],
    proration_behavior: 'always_invoice',
    // The trial ends with it. Otherwise Stripe keeps the trial going and
    // charges nothing today.
    ...(current.status === 'trialing' ? { trial_end: 'now' as const } : {}),
    metadata: { ...current.metadata, product: 'pro_annual' },
  })
}

// Ends a trial early: the first monthly charge today, and the month (with
// its looks) starts now.
export async function startProNow(app: FastifyInstance, subscriptionId: string) {
  return chargeSubscriptionChange(app, subscriptionId, { trial_end: 'now' })
}

// The monthly looks of annual plans, a month apart until the paid year ends
// (the renewal payment grants the next year's first month), each with a new
// month of avatar renders; they roll over up to PRO_ROLLOVER_CAP (in full
// for a subscription last paid before the cap, rolloverCapApplies). Also the
// rest of a new annual plan's first month, once its week is up (in full,
// like the first payment); dropped without looks if Pro ended meanwhile (a
// refund, a cancellation).
export async function refillAnnualCredits(app: FastifyInstance, now = new Date()) {
  const held = await app.collections.users
    .find({ 'pro.heldCredits.at': { $lte: now } }, { projection: { pro: 1 } })
    .limit(500)
    .toArray()
  let refilled = 0

  for (const user of held) {
    const hold = user.pro?.heldCredits

    if (!hold) {
      continue
    }

    const live = proIsLive(user.pro, now.getTime())
    const result = await app.collections.users.updateOne(
      { _id: user._id, 'pro.heldCredits.at': hold.at },
      { ...(live ? { $inc: { credits: hold.amount } } : {}), $unset: { 'pro.heldCredits': '' }, $set: { updatedAt: now } },
    )

    if (live && result.modifiedCount > 0) {
      refilled += 1

      // They came with the first payment: a refund of it takes them back too.
      const first = await app.collections.purchases.findOne(
        { userId: user._id, product: 'pro_annual', refundedAt: null },
        { sort: { createdAt: -1 }, projection: { _id: 1 } },
      )

      if (first) {
        await app.collections.purchases.updateOne({ _id: first._id }, { $inc: { credits: hold.amount } })
      }
    }
  }

  const due = await app.collections.users
    .find({ 'pro.interval': 'year', 'pro.nextCreditsAt': { $lte: now } }, { projection: { pro: 1 } })
    .limit(500)
    .toArray()
  let capped = 0

  for (const user of due) {
    const pro = user.pro
    const next = pro?.nextCreditsAt

    if (!pro || !next || !proIsLive(pro, now.getTime()) || !pro.periodEnd || next.getTime() >= pro.periodEnd.getTime()) {
      continue
    }

    // In one step on the stored balance, so a look spent meanwhile still
    // counts: up to the cap, and never less than she has.
    const before = await app.collections.users.findOneAndUpdate(
      { _id: user._id, 'pro.nextCreditsAt': next },
      [
        {
          $set: {
            credits: rolloverCreditsExpression(env.PRO_MONTHLY_CREDITS),
            'pro.nextCreditsAt': addMonths(next, 1),
            'pro.avatarRuns': 0,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: 'before', projection: { credits: 1, 'pro.rolloverCap': 1 } },
    )

    if (before) {
      refilled += 1

      if (rolloverCapApplies(before.pro) && rolloverCredits(before.credits ?? env.FREE_CREDITS, env.PRO_MONTHLY_CREDITS) < env.PRO_MONTHLY_CREDITS) {
        capped += 1
      }
    }
  }

  if (capped > 0) {
    app.log.info({ capped, cap: env.PRO_ROLLOVER_CAP }, 'Annual Pro looks held at the rollover cap')
  }

  return refilled
}

export function startCreditRefills(app: FastifyInstance) {
  const run = () => {
    void refillAnnualCredits(app)
      .then((count) => {
        if (count > 0) {
          app.log.info({ count }, 'Annual Pro looks refilled')
        }
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'Annual refill crashed'))
  }

  setTimeout(run, 90 * 1000).unref()
  setInterval(run, 10 * 60 * 1000).unref()
}
