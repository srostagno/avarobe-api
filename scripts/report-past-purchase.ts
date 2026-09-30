// Sends a purchase Meta never got to the Conversions API, with the time it
// was bought (Meta takes events up to 7 days old). Only when the checkout
// carried browser ids, which the web sends only if the buyer allowed
// tracking (no opt-out, no GPC). The Stripe session id is the event id, so
// Meta drops it if the purchase did arrive after all.
//
//   corepack pnpm exec tsx scripts/report-past-purchase.ts [stripe session id]
//
// Without an id it takes the latest purchase. Runs on the server, where the
// Meta token and the live Stripe key are.
import { MongoClient } from 'mongodb'
import Stripe from 'stripe'

import { env } from '../src/config/env.js'
import { sendMetaPurchase } from '../src/modules/billing/conversions.js'
import type { PurchaseDocument, UserDocument } from '../src/types/mongo.js'

const MAX_AGE = 7 * 24 * 60 * 60 * 1000

if (!env.META_CAPI_TOKEN || !env.STRIPE_SECRET_KEY) {
  throw new Error('META_CAPI_TOKEN and STRIPE_SECRET_KEY are needed (run it on the server).')
}

const client = await MongoClient.connect(env.MONGODB_URI)

try {
  const db = client.db(env.MONGODB_DB)
  const sessionId = process.argv[2]
  const purchase = await db
    .collection<PurchaseDocument>('purchases')
    .findOne(sessionId ? { stripeSessionId: sessionId } : {}, { sort: { createdAt: -1 } })

  if (!purchase?.stripeSessionId) {
    throw new Error('No such purchase.')
  }

  const age = Date.now() - purchase.createdAt.getTime()

  if (age > MAX_AGE) {
    throw new Error(`Bought ${Math.round(age / 86_400_000)} days ago; Meta only takes 7.`)
  }

  // Pro purchases are kept under their invoice; the checkout that started
  // the subscription has the browser ids and the id the live report uses.
  const stripe = new Stripe(env.STRIPE_SECRET_KEY)
  let session: Stripe.Checkout.Session | undefined

  if (purchase.stripeSessionId.startsWith('in_')) {
    const invoice = await stripe.invoices.retrieve(purchase.stripeSessionId)
    const subscription = invoice.parent?.subscription_details?.subscription
    const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id

    if (subscriptionId) {
      session = (await stripe.checkout.sessions.list({ subscription: subscriptionId, limit: 1 })).data[0]
    }
  } else {
    session = await stripe.checkout.sessions.retrieve(purchase.stripeSessionId)
  }

  if (!session) {
    throw new Error(`No checkout found for ${purchase.stripeSessionId}.`)
  }

  const metadata = { ...session.metadata }

  if (!metadata.ga_cid && !metadata.fbp && !metadata.fbc) {
    throw new Error('The checkout carried no browser ids (tracking off for this buyer). Not sending.')
  }

  // Older checkouts dropped long _fbc cookies; rebuild it from the ad click
  // the account came in on.
  if (!metadata.fbc) {
    const user = await db.collection<UserDocument>('users').findOne({ _id: purchase.userId })
    const fbclid = user?.acquisition?.fbclid

    if (fbclid) {
      metadata.fbc = `fb.1.${user.createdAt.getTime()}.${fbclid}`
    }
  }

  const sent = sendMetaPurchase({
    metadata,
    transactionId: session.id,
    product: session.metadata?.product ?? purchase.product,
    amount: purchase.amountTotal,
    currency: purchase.currency,
    eventTime: purchase.createdAt,
  })

  if (!sent) {
    throw new Error('Nothing to match the purchase on in Meta (no _fbp, _fbc or ad click). Not sent.')
  }

  console.log(
    `${purchase.product} ${purchase.amountTotal / 100} ${purchase.currency.toUpperCase()} from ${purchase.createdAt.toISOString()}:`,
    await sent,
  )
} finally {
  await client.close()
}
