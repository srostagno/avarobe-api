import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import Stripe from 'stripe'

import { env } from '../../config/env.js'
import type { ProSubscription, PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { trackServerEvent } from '../analytics/service.js'
import { fulfillGuide, isGuideSession } from '../guide/service.js'
import { sendTrialStartedEmail } from '../lifecycle/service.js'
import { reportPurchase } from './conversions.js'
import { colorAddonCents, proIsLive, styleAddonCents } from './entitlements.js'

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
    description: 'Dressed for one event: three looks on you for its dress code, the pieces in stores, and how to finish them.',
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
    description: 'New looks every month, your color and style reports, try-ons, every piece in stores and more.',
    amount: () => env.PRICE_PRO_MONTHLY_CENTS,
    credits: () => env.PRO_MONTHLY_CREDITS,
    recurring: 'month',
  },
  pro_annual: {
    lookupKey: 'avarobe_pro_annual_v1',
    name: 'Avarobe Pro (annual)',
    description: 'Everything in Pro for a year, with your Color and Style Advisors included.',
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

const priceIds = new Map<PurchaseProduct, string>()

// Finds the product's price by lookup key, creating product and price the
// first time (so a new account or live mode needs no dashboard setup). A
// changed amount gets a new price that takes over the lookup key.
async function priceFor(product: PurchaseProduct) {
  const config = PRODUCTS[product]
  const cached = priceIds.get(product)

  if (cached) {
    return cached
  }

  const existing = await stripe().prices.list({ lookup_keys: [config.lookupKey], active: true, limit: 1 })
  const current = existing.data[0]

  if (current && current.unit_amount === config.amount() && current.currency === 'usd') {
    priceIds.set(product, current.id)
    return current.id
  }

  const productId =
    typeof current?.product === 'string'
      ? current.product
      : (
          await stripe().products.create({
            name: config.name,
            description: config.description,
            metadata: { app: APP, product },
          })
        ).id
  const price = await stripe().prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: config.amount(),
    ...(config.recurring ? { recurring: { interval: config.recurring } } : {}),
    lookup_key: config.lookupKey,
    transfer_lookup_key: true,
    metadata: { app: APP, product },
  })

  priceIds.set(product, price.id)
  return price.id
}

// A one-time discount of `cents` for the first payment (reports counted
// toward Pro annual). One coupon per amount, created on first use.
async function creditCoupon(cents: number) {
  const id = `avarobe_report_credit_${cents}`

  try {
    return (await stripe().coupons.retrieve(id)).id
  } catch {
    return (
      await stripe().coupons.create({
        id,
        name: 'Your reports, counted toward Pro',
        amount_off: cents,
        currency: 'usd',
        duration: 'once',
        metadata: { app: APP },
      })
    ).id
  }
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

const longDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

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
function submitMessage(product: PurchaseProduct) {
  const config = PRODUCTS[product]

  if (product === 'pro_trial') {
    return `${money(config.amount())} today for ${env.PRO_TRIAL_DAYS} days of Pro. Then ${money(env.PRICE_PRO_MONTHLY_CENTS)} per month starting ${longDate(trialEndFrom())}, until you cancel. Cancel anytime before then in your Avarobe account settings and you won't be charged again.`
  }

  if (config.recurring) {
    return `Renews automatically at ${money(config.amount())} per ${config.recurring} until you cancel. Cancel anytime in your Avarobe account settings; you keep Pro until the end of the period you paid for.`
  }

  return 'One-time payment. No subscription.'
}

export async function createCheckout(input: {
  user: Pick<UserDocument, '_id' | 'email'>
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
}): Promise<{ url: string | null; clientSecret: string | null }> {
  const userId = input.user._id.toString()
  const metadata = { ...input.attribution, app: APP, product: input.product, userId }
  const discount = input.discountCents && input.discountCents > 0 ? await creditCoupon(input.discountCents) : null
  const common = {
    line_items: [{ price: await priceFor(input.product), quantity: 1 }],
    // Not a bare ObjectId, so Trimry's webhook can never take it for one of
    // its own records.
    client_reference_id: `${APP}_${userId}`,
    customer_email: input.user.email,
    metadata,
    // Stripe takes either a discount or the promotion code field. The field
    // is left to subscriptions: on a $5 purchase it sends people off to
    // hunt for a code.
    ...(discount
      ? { discounts: [{ coupon: discount }] }
      : PRODUCTS[input.product].recurring || input.product === 'pro_trial'
        ? { allow_promotion_codes: true }
        : {}),
    custom_text: { submit: { message: submitMessage(input.product) } },
    // The embedded form comes back to the same success page; closing it is
    // the way back, so it has no cancel link.
    ...(input.embedded
      ? {
          ui_mode: 'embedded' as const,
          branding_settings: EMBEDDED_BRANDING,
          return_url: `${env.APP_URL}/studio/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        }
      : {
          branding_settings: BRANDING,
          success_url: `${env.APP_URL}/studio/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.APP_URL}${input.returnPath}?checkout=cancelled&product=${input.product}`,
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
            { price: await priceFor('pro_monthly'), quantity: 1 },
            { price: await priceFor('pro_trial'), quantity: 1 },
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
  const session = await stripe().checkout.sessions.create(params)

  if (input.embedded ? !session.client_secret : !session.url) {
    throw new Error('Stripe returned a checkout session without a URL or client secret.')
  }

  return { url: session.url ?? null, clientSecret: input.embedded ? session.client_secret : null }
}

// The Outfit Formula Book: a checkout open to guests (Stripe asks for the
// email). A signed-in buyer's account is noted too, so it shows in their
// purchases.
export async function createGuideCheckout(input: { userId: string | null; email: string | null; attribution?: Record<string, string> }) {
  const metadata = { ...input.attribution, app: APP, product: 'outfit_guide', ...(input.userId ? { userId: input.userId } : {}) }
  // Branding rides along like in createCheckout (newer than these types).
  const extra = { branding_settings: BRANDING }
  const params: Stripe.Checkout.SessionCreateParams = {
    ...extra,
    mode: 'payment',
    line_items: [{ price: await priceFor('outfit_guide'), quantity: 1 }],
    client_reference_id: `${APP}_guide_${input.userId ?? 'guest'}`,
    ...(input.email ? { customer_email: input.email } : {}),
    metadata,
    custom_text: { submit: { message: 'One-time payment. Instant PDF download, and we email it to you too.' } },
    payment_intent_data: { metadata, statement_descriptor_suffix: 'AVAROBE' },
    success_url: `${env.APP_URL}/guide/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/guide?checkout=cancelled`,
  }
  const session = await stripe().checkout.sessions.create(params)

  if (!session.url) {
    throw new Error('Stripe returned a checkout session without a URL.')
  }

  return session.url
}

// The latest Avarobe checkouts as Stripe has them (the admin's checkout
// table): what was opened, and whether it was paid, abandoned or is open.
export async function recentCheckouts(days: number) {
  const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000)
  const sessions: Stripe.Checkout.Session[] = []

  for await (const session of stripe().checkout.sessions.list({ created: { gte: since }, limit: 100 })) {
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

function avarobeUserId(metadata: Stripe.Metadata | null | undefined) {
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
}

// Records one payment and applies it to the user in a transaction: credits,
// the reports it unlocks and any product-specific fields. Returns false if
// it was already applied.
async function applyGrant(app: FastifyInstance, grant: Grant) {
  if (await app.collections.purchases.findOne({ stripeSessionId: grant.paymentKey }, { projection: { _id: 1 } })) {
    return false
  }

  const config = PRODUCTS[grant.product]
  const credits = config.credits()
  const mongoSession = app.mongoClient.startSession()

  try {
    await mongoSession.withTransaction(async () => {
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
          credits,
          createdAt: new Date(),
        },
        { session: mongoSession },
      )

      const user = await app.collections.users.findOne({ _id: grant.userId }, { session: mongoSession })

      if (!user) {
        throw new Error(`Payment ${grant.paymentKey} for a missing user.`)
      }

      const now = new Date()

      await app.collections.users.updateOne(
        { _id: grant.userId },
        {
          $set: {
            credits: (user.credits ?? env.FREE_CREDITS) + credits,
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
    props: { product: grant.product, amount: grant.amount, currency: grant.currency },
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
      })

      if (applied) {
        void reportSession(app, session, product)
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
    })

    if (applied) {
      void reportSession(app, session, product)
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
  })

  if (applied) {
    void reportSession(app, session, product)
  }

  return userId
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
  }).catch(() => undefined)
}

// One Pro payment (the first one, a renewal, or the switch to annual): its
// credits, the reports annual includes, and the subscription's state.
// Annual plans get the rest of each year's monthly looks from
// refillAnnualCredits, starting a month after every annual payment.
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
  },
) {
  const interval = input.product === 'pro_annual' ? 'year' : 'month'
  const applied = await applyGrant(app, {
    userId: input.userId,
    product: input.product,
    paymentKey: input.paymentKey,
    paymentIntentId: null,
    amount: input.amount,
    currency: input.currency,
    set: (user) => ({
      pro: {
        subscriptionId: input.subscriptionId,
        customerId: input.customerId,
        status: 'active',
        interval,
        periodEnd: input.periodEnd,
        cancelAtPeriodEnd: user.pro?.subscriptionId === input.subscriptionId ? user.pro.cancelAtPeriodEnd : false,
        nextCreditsAt: interval === 'year' ? addMonths(new Date(), 1) : null,
      },
    }),
  })

  // Already granted (the success page and the webhook both report it); still
  // keep the period end current.
  if (!applied) {
    await app.collections.users.updateOne(
      { _id: input.userId, 'pro.subscriptionId': input.subscriptionId },
      { $max: { 'pro.periodEnd': input.periodEnd } },
    )
  }

  return applied
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
  },
) {
  const now = new Date()
  const applied = await applyGrant(app, {
    userId: input.userId,
    product: 'pro_trial',
    paymentKey: input.paymentKey,
    paymentIntentId: null,
    amount: input.amount,
    currency: input.currency,
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
      },
    }),
  })

  if (applied) {
    void sendTrialStartedEmail(app, input.userId).catch((error: unknown) => {
      app.log.error({ err: error, userId: input.userId.toString() }, 'Trial email failed')
    })
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

  await app.collections.users.updateOne(
    { _id: userId },
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
        updatedAt: new Date(),
      },
    },
  )
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

  return chargeSubscriptionChange(app, subscriptionId, {
    items: [{ id: item.id, price: await priceFor('pro_annual') }],
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
// (the renewal payment grants the next year's first month).
export async function refillAnnualCredits(app: FastifyInstance, now = new Date()) {
  const due = await app.collections.users
    .find({ 'pro.interval': 'year', 'pro.nextCreditsAt': { $lte: now } }, { projection: { pro: 1 } })
    .limit(500)
    .toArray()
  let refilled = 0

  for (const user of due) {
    const pro = user.pro
    const next = pro?.nextCreditsAt

    if (!pro || !next || !proIsLive(pro, now.getTime()) || !pro.periodEnd || next.getTime() >= pro.periodEnd.getTime()) {
      continue
    }

    const result = await app.collections.users.updateOne(
      { _id: user._id, 'pro.nextCreditsAt': next },
      { $inc: { credits: env.PRO_MONTHLY_CREDITS }, $set: { 'pro.nextCreditsAt': addMonths(next, 1), updatedAt: now } },
    )
    refilled += result.modifiedCount
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
