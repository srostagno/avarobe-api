import fs from 'node:fs'
import path from 'node:path'

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { requestLocale, toLocale } from '../../utils/locale.js'
import { translateMessage } from '../../utils/translate-message.js'
import { pricingRegion } from '../billing/pricing.js'
import { optionalUserId } from '../analytics/service.js'
import { attributionMetadata } from '../billing/conversions.js'
import { billingState, isAdmin, loadBillingUser } from '../billing/entitlements.js'
import { brazilWithdrawalUntil, guideRefundableUntil } from '../billing/refunds.js'
import {
  REQUEST_RATE_LIMIT,
  RefundRequestError,
  brazilian,
  createGuideRefundRequest,
  customerView,
  guideOrderRequest,
  orderCardCountry,
} from '../billing/refund-requests.js'
import { createGuideCheckout, retrieveSession, stripeConfigured } from '../billing/stripe.js'
import type { GuideOrderDocument } from '../../types/mongo.js'
import type { Locale } from '../../utils/locale.js'
import { requestGeo } from '../analytics/geo.js'
import { compGuideOrder, fulfillGuide, guideDownloadUrl, guideRefundToken, guideSettled, isGuideSession } from './service.js'

// Meta's _fbc can be long; attributionMetadata drops what Stripe can't keep.
const idField = z.string().trim().min(1).max(1000).optional()

const checkoutSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
  attribution: z.object({ gaClientId: idField, fbp: idField, fbc: idField }).optional().catch(undefined),
})

const sessionSchema = z.object({ session_id: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/) })

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/

// The form's fields are checked by the request itself (validateRequestInput),
// so its message is the customer's.
const refundRequestSchema = z.object({
  token: z.string().regex(TOKEN),
  category: z.unknown(),
  explanation: z.unknown(),
  acknowledge: z.unknown(),
})

// What the thank-you page and the refund page show of an order: its link,
// and the refund request (`token`: the refund key): until when one can be
// asked (`requestableUntil`), the one asked, and Brazil's withdrawal while
// it lasts. `refundableUntil` stays for the web before Oct 12, 2026, always
// null, so it never offers a one-tap refund.
async function orderView(app: FastifyInstance, order: GuideOrderDocument, locale: Locale) {
  const [request, account] = await Promise.all([
    guideOrderRequest(app, order._id),
    order.userId ? app.collections.users.findOne({ _id: order.userId }, { projection: { location: 1, locale: 1 } }) : null,
  ])
  const signupCountry = account?.location?.country ?? null
  const brazil = brazilian({
    currency: order.currency,
    signupCountry,
    cardCountry: await orderCardCountry(app, order, { signupCountry, requested: Boolean(request) }),
    locale: account?.locale,
    pageLocale: locale,
  })
  const until = request ? null : guideRefundableUntil(order, Date.now(), brazil)
  const withdrawal = brazil ? guideRefundableUntil(order, Date.now(), true) : null

  return {
    downloadUrl: order.refundedAt ? null : guideDownloadUrl(order),
    email: order.email,
    token: order.amount > 0 ? await guideRefundToken(app, order) : null,
    amount: order.amount,
    currency: order.currency,
    refundableUntil: null,
    requestableUntil: until?.toISOString() ?? null,
    refundRequest: request ? customerView(request, locale) : null,
    withdrawal: withdrawal ? { law: 'br_cdc_49' as const, until: brazilWithdrawalUntil(order.createdAt).toISOString() } : null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
  }
}

function pdfPath() {
  return path.isAbsolute(env.OUTFIT_GUIDE_PDF) ? env.OUTFIT_GUIDE_PDF : path.resolve(process.cwd(), env.OUTFIT_GUIDE_PDF)
}

// The Outfit Formula Book: a guest checkout, the order after paying, and the
// download behind each order's link.
const guideRoutes: FastifyPluginAsync = async (app) => {
  app.post('/checkout', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = parseBody(checkoutSchema, request.body ?? {})

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    if (!stripeConfigured()) {
      return reply.code(503).send({ message: 'Checkout is not available right now.' })
    }

    // Signed in or not: the guide is sold to anyone, and a signed-in buyer's
    // account is noted on the order.
    const userId = await optionalUserId(request)
    const user = userId ? await app.collections.users.findOne({ _id: userId }, { projection: { email: 1, location: 1 } }) : null

    try {
      const url = await createGuideCheckout({
        userId: user ? user._id.toString() : null,
        email: parsed.data.email ?? null,
        // An admin's test purchase never reaches Meta or GA as a sale.
        attribution: user && isAdmin(user) ? {} : attributionMetadata(parsed.data.attribution, request),
        locale: requestLocale(request),
        region: pricingRegion(request, user),
      })
      return { url }
    } catch (error) {
      request.log.error({ err: errorMessage(error) }, 'Guide checkout failed')
      return reply.code(502).send({ message: 'We could not open the checkout. Please try again.' })
    }
  })

  // The thank-you page: confirms the payment and hands over the link (the
  // same one the email carries).
  app.get('/session', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = parseBody(sessionSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const session = await retrieveSession(parsed.data.session_id).catch(() => null)

    if (!session || !isGuideSession(session)) {
      return reply.code(404).send({ message: 'We could not find this order.' })
    }

    if (!guideSettled(session)) {
      return reply.code(409).send({ message: 'Your payment is still processing. This page will update in a moment.' })
    }

    const order = await fulfillGuide(app, session)

    if (!order) {
      return reply.code(502).send({ message: 'We could not prepare your download. Please refresh.' })
    }

    return orderView(app, order, requestLocale(request))
  })

  // The refund page the guide email links to (the web's /guide/thanks with
  // ?refund=<refund key>): the order behind the link.
  app.get('/order/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = (request.params as { token?: string }).token ?? ''
    const order = TOKEN.test(token) ? await app.collections.guideOrders.findOne({ refundToken: token }) : null

    if (!order) {
      return reply.code(404).send({ message: 'We could not find this order.' })
    }

    return orderView(app, order, requestLocale(request))
  })

  // A refund request for the book, guests included: the order's refund key
  // (in its email and on the thank-you page; the download link can't ask),
  // the category, their explanation and that they know the link stops. 201
  // new, 200 the open one already there.
  app.post('/refund-requests', { config: { rateLimit: REQUEST_RATE_LIMIT } }, async (request, reply) => {
    const parsed = parseBody(refundRequestSchema, request.body ?? {})

    if (!parsed.ok) {
      return reply.code(404).send({ message: 'We could not find this order.' })
    }

    const locale = requestLocale(request)

    try {
      const { request: created, created: isNew } = await createGuideRefundRequest(app, {
        token: parsed.data.token,
        category: parsed.data.category,
        explanation: parsed.data.explanation,
        acknowledge: parsed.data.acknowledge,
        locale,
        requestCountry: requestGeo(request)?.country ?? null,
      })
      const order = await app.collections.guideOrders.findOne({ refundToken: parsed.data.token })

      return reply
        .code(isNew ? 201 : 200)
        .send({ request: customerView(created, locale), created: isNew, order: order ? await orderView(app, order, locale) : null })
    } catch (error) {
      if (error instanceof RefundRequestError) {
        return reply.code(error.status).send({ message: error.message, ...(error.blocked ? { code: error.blocked } : {}) })
      }

      throw error
    }
  })

  // The one-tap refund of the web before Oct 12, 2026: refunds are
  // requested and reviewed now.
  app.post('/refund', async (_request, reply) => {
    return reply.code(409).send({ code: 'refund_review', message: 'Refunds are now reviewed by our team: request one from the link in your book’s email.' })
  })

  // Whether the signed-in person has the guide (bought with this account, or
  // as a guest with the same email; comp accounts always), and its link.
  app.get('/mine', { preHandler: authenticate }, async (request) => {
    const userId = requireUserId(request)
    const [user, account] = await Promise.all([
      loadBillingUser(app, userId),
      app.collections.users.findOne({ _id: userId }, { projection: { emailVerifiedAt: 1 } }),
    ])

    if (!user) {
      return { owned: false, downloadUrl: null }
    }

    // A guest purchase counts only once the account has proven that email;
    // otherwise anyone could sign up with a buyer's address and take the link.
    const match = account?.emailVerifiedAt ? [{ userId }, { email: user.email.toLowerCase() }] : [{ userId }]
    // A refunded order no longer counts.
    let order = await app.collections.guideOrders.findOne({ $or: match, refundedAt: null }, { sort: { createdAt: 1 } })

    if (!order && billingState(user).comp) {
      order = await compGuideOrder(app, userId, user.email)
    }

    return order ? { owned: true, downloadUrl: guideDownloadUrl(order) } : { owned: false, downloadUrl: null }
  })

  app.get('/download/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = (request.params as { token?: string }).token ?? ''
    const order = TOKEN.test(token) ? await app.collections.guideOrders.findOne({ token }) : null
    // Opened straight in a browser: plain text in their language (their
    // account's, or the browser's).
    const account = order?.userId ? await app.collections.users.findOne({ _id: order.userId }, { projection: { locale: 1 } }) : null
    const locale = account?.locale ?? toLocale(request.headers['accept-language'])
    const say = (text: string) => reply.code(404).type('text/plain; charset=utf-8').send(translateMessage(text, locale))

    if (!order) {
      return say('This download link is not valid. Write to hello@avarobe.com and we will send you a new one.')
    }

    if (order.refundedAt) {
      return say('This order was refunded, so its download link no longer works.')
    }

    const file = pdfPath()

    if (!fs.existsSync(file)) {
      request.log.error({ file }, 'Guide PDF missing')
      return reply.code(503).type('text/plain').send('The guide is being updated. Please try again in a few minutes.')
    }

    await app.collections.guideOrders.updateOne({ _id: order._id }, { $inc: { downloads: 1 }, $set: { lastDownloadAt: new Date() } })

    return reply
      .header('Content-Type', 'application/pdf')
      // Inline: Instagram's and Facebook's in-app browsers ignore downloads
      // but open a PDF, which can then be shared or saved to Files.
      .header('Content-Disposition', 'inline; filename="The-Outfit-Formula-Book.pdf"')
      .header('Cache-Control', 'private, no-store')
      .send(fs.createReadStream(file))
  })
}

export default guideRoutes
