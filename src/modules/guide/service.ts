import { randomBytes } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { env } from '../../config/env.js'
import type { GuideOrderDocument } from '../../types/mongo.js'
import { deliverEmail } from '../../utils/email.js'
import { errorMessage } from '../../utils/http.js'
import { isDuplicateKeyError } from '../../utils/mongo-errors.js'
import { trackServerEvent } from '../analytics/service.js'
import { reportPurchase } from '../billing/conversions.js'
import { outfitGuideEmail } from '../lifecycle/templates.js'

// The Outfit Formula Book: a paid checkout becomes an order with its own
// download link, emailed once. Idempotent: the success page and the webhook
// can both report the same checkout.

export function guideDownloadUrl(order: Pick<GuideOrderDocument, 'token'>) {
  return `${env.API_PUBLIC_URL}/api/v1/guide/download/${order.token}`
}

export function isGuideSession(session: Stripe.Checkout.Session) {
  return session.metadata?.app === 'avarobe' && session.metadata?.product === 'outfit_guide'
}

// Paid, or free with a 100%-off promotion code (Stripe's no_payment_required).
// The same rule as billing's sessionSettled, kept here so the guide doesn't
// import the Stripe module that imports it.
export function guideSettled(session: Stripe.Checkout.Session) {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
}

// Comp accounts (the founder, testers) read the guide free: an order of
// their own, made once, so they get a download link like any buyer.
export async function compGuideOrder(app: FastifyInstance, userId: ObjectId, email: string) {
  const order: GuideOrderDocument = {
    _id: new ObjectId(),
    sessionId: `comp_${userId.toString()}`,
    email,
    userId,
    token: randomBytes(24).toString('base64url'),
    amount: 0,
    currency: 'usd',
    emailedAt: new Date(),
    downloads: 0,
    lastDownloadAt: null,
    createdAt: new Date(),
  }

  try {
    await app.collections.guideOrders.insertOne(order)
    return order
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    return app.collections.guideOrders.findOne({ sessionId: order.sessionId })
  }
}

export async function fulfillGuide(app: FastifyInstance, session: Stripe.Checkout.Session) {
  if (!isGuideSession(session) || !guideSettled(session)) {
    return null
  }

  const email = session.customer_details?.email ?? session.customer_email ?? null
  const userId = session.metadata?.userId && ObjectId.isValid(session.metadata.userId) ? new ObjectId(session.metadata.userId) : null
  const now = new Date()
  const fresh: GuideOrderDocument = {
    _id: new ObjectId(),
    sessionId: session.id,
    email,
    userId,
    token: randomBytes(24).toString('base64url'),
    amount: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    emailedAt: null,
    downloads: 0,
    lastDownloadAt: null,
    createdAt: now,
  }
  let order: GuideOrderDocument | null = fresh

  try {
    await app.collections.guideOrders.insertOne(fresh)
    void trackServerEvent(app, { name: 'guide_purchased', userId, props: { amount: fresh.amount, account: Boolean(userId) } })

    // A signed-in buyer's purchase goes to Meta and GA from grantSession; a
    // guest's only from here, with the same id the thank-you page uses. A
    // free (100%-off) order isn't a purchase to report.
    if (!userId && fresh.amount > 0) {
      void reportPurchase(app, {
        metadata: session.metadata,
        transactionId: session.id,
        product: 'outfit_guide',
        amount: fresh.amount,
        currency: fresh.currency,
      }).catch(() => undefined)
    }
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error
    }

    order = await app.collections.guideOrders.findOne({ sessionId: session.id })
  }

  if (!order) {
    return null
  }

  if (!order.emailedAt && order.email) {
    // Claim the send first, so two reports of the same checkout send once.
    const claimed = await app.collections.guideOrders.updateOne({ _id: order._id, emailedAt: null }, { $set: { emailedAt: now } })

    if (claimed.modifiedCount === 1) {
      try {
        const name = session.customer_details?.name?.split(' ')[0] ?? ''
        await deliverEmail({ log: app.log, to: { email: order.email }, content: outfitGuideEmail({ email: order.email, firstName: name, downloadUrl: guideDownloadUrl(order) }) })
      } catch (error) {
        app.log.error({ err: errorMessage(error), order: order._id.toString() }, 'Guide email failed')
        await app.collections.guideOrders.updateOne({ _id: order._id }, { $set: { emailedAt: null } })
      }
    }
  }

  return order
}
