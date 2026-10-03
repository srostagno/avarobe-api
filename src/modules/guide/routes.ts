import fs from 'node:fs'
import path from 'node:path'

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { optionalUserId } from '../analytics/service.js'
import { attributionMetadata } from '../billing/conversions.js'
import { billingState, isAdmin, loadBillingUser } from '../billing/entitlements.js'
import { createGuideCheckout, retrieveSession, stripeConfigured } from '../billing/stripe.js'
import { compGuideOrder, fulfillGuide, guideDownloadUrl, guideSettled, isGuideSession } from './service.js'

// Meta's _fbc can be long; attributionMetadata drops what Stripe can't keep.
const idField = z.string().trim().min(1).max(1000).optional()

const checkoutSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
  attribution: z.object({ gaClientId: idField, fbp: idField, fbc: idField }).optional().catch(undefined),
})

const sessionSchema = z.object({ session_id: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/) })

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
    const user = userId ? await app.collections.users.findOne({ _id: userId }, { projection: { email: 1 } }) : null

    try {
      const url = await createGuideCheckout({
        userId: user ? user._id.toString() : null,
        email: parsed.data.email ?? null,
        // An admin's test purchase never reaches Meta or GA as a sale.
        attribution: user && isAdmin(user) ? {} : attributionMetadata(parsed.data.attribution, request),
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

    return { downloadUrl: guideDownloadUrl(order), email: order.email }
  })

  // Whether the signed-in person has the guide (bought with this account, or
  // as a guest with the same email; comp accounts always), and its link.
  app.get('/mine', { preHandler: authenticate }, async (request) => {
    const userId = requireUserId(request)
    const user = await loadBillingUser(app, userId)

    if (!user) {
      return { owned: false, downloadUrl: null }
    }

    let order = await app.collections.guideOrders.findOne({ $or: [{ userId }, { email: user.email }] }, { sort: { createdAt: 1 } })

    if (!order && billingState(user).comp) {
      order = await compGuideOrder(app, userId, user.email)
    }

    return order ? { owned: true, downloadUrl: guideDownloadUrl(order) } : { owned: false, downloadUrl: null }
  })

  app.get('/download/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = (request.params as { token?: string }).token ?? ''
    const order = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await app.collections.guideOrders.findOne({ token }) : null

    if (!order) {
      return reply.code(404).type('text/plain').send('This download link is not valid. Write to hello@avarobe.com and we will send you a new one.')
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
