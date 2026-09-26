import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import Stripe from 'stripe'

import { env } from '../../config/env.js'
import type { PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'

// Avarobe shares the Stripe account with Trimry. Everything Avarobe creates
// carries metadata app=avarobe and only that is handled here. Trimry's
// webhook skips one-time payments, and it can't match Avarobe subscriptions:
// they use their own customers and never send a Trimry-shaped reference.
const APP = 'avarobe'
const DAY_MS = 24 * 60 * 60 * 1000

type ProductConfig = {
  lookupKey: string
  name: string
  description: string
  amount: () => number
  // Credits and Style Kit days granted per payment (per month for Plus).
  credits: () => number
  days: () => number
  recurring?: 'month'
  // The Color Report unlocks the full palette and color report for good.
  unlocksColor?: boolean
}

export const PRODUCTS: Record<PurchaseProduct, ProductConfig> = {
  style_kit: {
    lookupKey: 'avarobe_style_kit_v1',
    name: 'Avarobe Style Kit',
    description: 'Advanced color analysis, your style profile, try-ons, shopping and looks for your occasions.',
    amount: () => env.STYLE_KIT_PRICE_CENTS,
    credits: () => env.STYLE_KIT_CREDITS,
    days: () => env.STYLE_KIT_DAYS,
  },
  top_up: {
    lookupKey: 'avarobe_top_up_v1',
    name: 'Avarobe credits top-up',
    description: 'More looks and try-ons, and more time with your Style Kit.',
    amount: () => env.TOP_UP_PRICE_CENTS,
    credits: () => env.TOP_UP_CREDITS,
    days: () => env.TOP_UP_DAYS,
  },
  color_report: {
    lookupKey: 'avarobe_color_report_v1',
    name: 'Avarobe Color Report',
    description: 'Your full palette, advanced color analysis and a drape test.',
    amount: () => env.COLOR_REPORT_PRICE_CENTS,
    credits: () => env.COLOR_REPORT_CREDITS,
    days: () => 0,
    unlocksColor: true,
  },
  kit_upgrade: {
    lookupKey: 'avarobe_kit_upgrade_v1',
    name: 'Avarobe Style Kit (upgrade)',
    description: 'The Style Kit, with your Color Report counted toward it.',
    amount: () => env.KIT_UPGRADE_PRICE_CENTS,
    credits: () => env.STYLE_KIT_CREDITS,
    days: () => env.STYLE_KIT_DAYS,
  },
  plus: {
    lookupKey: 'avarobe_plus_monthly_v1',
    name: 'Avarobe Plus',
    description: 'Everything in the Style Kit, with new credits every month.',
    amount: () => env.PLUS_PRICE_CENTS,
    credits: () => env.PLUS_MONTHLY_CREDITS,
    days: () => 0,
    recurring: 'month',
  },
}

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

export async function createCheckout(input: {
  user: Pick<UserDocument, '_id' | 'email'>
  product: PurchaseProduct
  returnPath: string
}) {
  const userId = input.user._id.toString()
  const metadata = { app: APP, product: input.product, userId }
  const common = {
    line_items: [{ price: await priceFor(input.product), quantity: 1 }],
    // Not a bare ObjectId, so Trimry's webhook can never take it for one of
    // its own records.
    client_reference_id: `${APP}_${userId}`,
    customer_email: input.user.email,
    metadata,
    allow_promotion_codes: true,
    success_url: `${env.APP_URL}/studio/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}${input.returnPath}`,
  }
  const session = PRODUCTS[input.product].recurring
    ? await stripe().checkout.sessions.create({
        ...common,
        mode: 'subscription',
        subscription_data: { metadata },
      })
    : await stripe().checkout.sessions.create({
        ...common,
        mode: 'payment',
        // The account is shared with Trimry: without this, card statements
        // would only say the account's name.
        payment_intent_data: { metadata, statement_descriptor_suffix: 'AVAROBE' },
      })

  if (!session.url) {
    throw new Error('Stripe returned a checkout session without a URL.')
  }

  return session.url
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

// Paid, or free through a 100% promotion code (gifted Kits, live tests).
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

type Grant = {
  userId: ObjectId
  product: PurchaseProduct
  paymentKey: string
  paymentIntentId: string | null
  amount: number
  currency: string
  // Extra fields to set on the user alongside credits and Kit time.
  set?: (user: UserDocument) => Partial<UserDocument>
}

// Records one payment and applies it to the user in a transaction: credits,
// Style Kit time (extended from the later of now and the current end), and
// any product-specific fields. Returns false if it was already applied.
async function applyGrant(app: FastifyInstance, grant: Grant) {
  if (await app.collections.purchases.findOne({ stripeSessionId: grant.paymentKey }, { projection: { _id: 1 } })) {
    return false
  }

  const config = PRODUCTS[grant.product]
  const credits = config.credits()
  const kitDays = config.days()
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
          kitDays,
          createdAt: new Date(),
        },
        { session: mongoSession },
      )

      const user = await app.collections.users.findOne({ _id: grant.userId }, { session: mongoSession })

      if (!user) {
        throw new Error(`Payment ${grant.paymentKey} for a missing user.`)
      }

      const kitFrom = Math.max(Date.now(), user.styleKitUntil?.getTime() ?? 0)

      await app.collections.users.updateOne(
        { _id: grant.userId },
        {
          $set: {
            credits: (user.credits ?? env.FREE_CREDITS) + credits,
            ...(kitDays > 0 ? { styleKitUntil: new Date(kitFrom + kitDays * DAY_MS) } : {}),
            ...(config.unlocksColor ? { colorReportAt: user.colorReportAt ?? new Date() } : {}),
            ...(grant.set?.(user) ?? {}),
            updatedAt: new Date(),
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

// Grants a paid Avarobe checkout session. For Plus it grants the first
// month through its invoice, the same key the invoice webhook uses.
export async function grantSession(app: FastifyInstance, session: Stripe.Checkout.Session) {
  const userId = avarobeUserId(session.metadata)
  const product = session.metadata?.product as PurchaseProduct | undefined

  if (!userId || !product || !(product in PRODUCTS) || !sessionSettled(session)) {
    return null
  }

  if (session.mode === 'subscription') {
    const subscriptionId = readId(session.subscription)

    if (!subscriptionId) {
      return null
    }

    await grantPlusMonth(app, {
      userId,
      paymentKey: readId(session.invoice) ?? session.id,
      subscriptionId,
      customerId: readId(session.customer),
      periodEnd: (await subscriptionPeriodEnd(subscriptionId)) ?? new Date(Date.now() + 31 * DAY_MS),
      amount: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
    })

    return userId
  }

  await applyGrant(app, {
    userId,
    product,
    paymentKey: session.id,
    paymentIntentId: readId(session.payment_intent),
    amount: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
  })

  return userId
}

// One paid month of Plus: its credits, and the subscription's state.
async function grantPlusMonth(
  app: FastifyInstance,
  input: {
    userId: ObjectId
    paymentKey: string
    subscriptionId: string
    customerId: string | null
    periodEnd: Date
    amount: number
    currency: string
  },
) {
  const applied = await applyGrant(app, {
    userId: input.userId,
    product: 'plus',
    paymentKey: input.paymentKey,
    paymentIntentId: null,
    amount: input.amount,
    currency: input.currency,
    set: (user) => ({
      plus: {
        subscriptionId: input.subscriptionId,
        customerId: input.customerId,
        status: 'active',
        periodEnd: input.periodEnd,
        cancelAtPeriodEnd: user.plus?.subscriptionId === input.subscriptionId ? user.plus.cancelAtPeriodEnd : false,
      },
    }),
  })

  // Already granted (the success page and the webhook both report it); still
  // keep the period end current.
  if (!applied) {
    await app.collections.users.updateOne(
      { _id: input.userId, 'plus.subscriptionId': input.subscriptionId },
      { $max: { 'plus.periodEnd': input.periodEnd } },
    )
  }
}

// invoice.paid: the first month (if the success page didn't get there
// first) and every renewal.
export async function handleInvoicePaid(app: FastifyInstance, invoice: Stripe.Invoice) {
  const details = invoice.parent?.subscription_details
  const userId = avarobeUserId(details?.metadata)
  const subscriptionId = readId(details?.subscription)

  if (!userId || !subscriptionId || !invoice.id) {
    return
  }

  const lineEnd = invoice.lines.data[0]?.period.end

  await grantPlusMonth(app, {
    userId,
    paymentKey: invoice.id,
    subscriptionId,
    customerId: readId(invoice.customer),
    periodEnd: lineEnd ? new Date(lineEnd * 1000) : new Date(Date.now() + 31 * DAY_MS),
    amount: invoice.amount_paid,
    currency: invoice.currency,
  })
}

// customer.subscription.updated / deleted: cancellations, failed payments.
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

  await app.collections.users.updateOne(
    { _id: userId },
    {
      $set: {
        plus: {
          subscriptionId: subscription.id,
          customerId: readId(subscription.customer),
          status: subscription.status,
          periodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        updatedAt: new Date(),
      },
    },
  )
}

// Cancels Plus at the end of the paid period, or undoes that. Done here
// rather than in Stripe's Customer Portal: portal settings are shared with
// Trimry's account, and the first configuration becomes the account default.
export async function setPlusCancellation(app: FastifyInstance, subscriptionId: string, cancel: boolean) {
  const subscription = await stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel })

  await handleSubscriptionChange(app, subscription)
  return subscription
}
