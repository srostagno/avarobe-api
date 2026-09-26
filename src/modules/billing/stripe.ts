import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import Stripe from 'stripe'

import { env } from '../../config/env.js'
import type { PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'

// Avarobe shares the Stripe account with Trimry. Everything Avarobe creates
// carries metadata app=avarobe, and only those events are handled here
// (Trimry only handles subscriptions, Avarobe sells one-time payments).
const APP = 'avarobe'

type ProductConfig = {
  lookupKey: string
  name: string
  description: string
  amount: () => number
  credits: () => number
  days: () => number
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
  const metadata = { app: APP, product: input.product, userId: input.user._id.toString() }
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: await priceFor(input.product), quantity: 1 }],
    client_reference_id: input.user._id.toString(),
    customer_email: input.user.email,
    metadata,
    // The account is shared with Trimry: without this, card statements would
    // only say the account's name.
    payment_intent_data: { metadata, statement_descriptor_suffix: 'AVAROBE' },
    allow_promotion_codes: true,
    success_url: `${env.APP_URL}/studio/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}${input.returnPath}`,
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

// Grants a paid Avarobe checkout session: credits plus Style Kit time
// (extended from the later of now and the current end). Safe to call more
// than once for the same session. Returns the user id it granted to.
export async function grantSession(app: FastifyInstance, session: Stripe.Checkout.Session) {
  const product = session.metadata?.product as PurchaseProduct | undefined

  if (session.metadata?.app !== APP || !product || !(product in PRODUCTS)) {
    return null
  }

  if (!sessionSettled(session)) {
    return null
  }

  const userId = ObjectId.isValid(session.metadata.userId ?? '') ? new ObjectId(session.metadata.userId) : null

  if (!userId) {
    return null
  }

  // Most repeats (the webhook after the success page) stop here.
  if (await app.collections.purchases.findOne({ stripeSessionId: session.id }, { projection: { _id: 1 } })) {
    return userId
  }

  const config = PRODUCTS[product]
  const credits = config.credits()
  const kitDays = config.days()
  const mongoSession = app.mongoClient.startSession()

  try {
    await mongoSession.withTransaction(async () => {
      // A concurrent grant of the same session fails here on the unique
      // index, which aborts this transaction (handled below).
      await app.collections.purchases.insertOne(
        {
          _id: new ObjectId(),
          userId,
          product,
          stripeSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          amountTotal: session.amount_total ?? 0,
          currency: session.currency ?? 'usd',
          credits,
          kitDays,
          createdAt: new Date(),
        },
        { session: mongoSession },
      )

      const user = await app.collections.users.findOne({ _id: userId }, { session: mongoSession })

      if (!user) {
        throw new Error(`Paid session ${session.id} for a missing user.`)
      }

      const from = Math.max(Date.now(), user.styleKitUntil?.getTime() ?? 0)

      await app.collections.users.updateOne(
        { _id: userId },
        {
          $set: {
            credits: (user.credits ?? env.FREE_CREDITS) + credits,
            styleKitUntil: new Date(from + kitDays * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          },
        },
        { session: mongoSession },
      )
    })
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }
  } finally {
    await mongoSession.endSession()
  }

  return userId
}
