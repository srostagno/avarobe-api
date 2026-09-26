import type { FastifyPluginAsync } from 'fastify'
import type Stripe from 'stripe'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { serializeUser } from '../../utils/serializers.js'
import {
  BillingNotConfiguredError,
  PRODUCTS,
  createCheckout,
  grantSession,
  retrieveSession,
  sessionSettled,
  stripeConfigured,
  verifyWebhook,
} from './stripe.js'

const checkoutSchema = z.object({
  product: z.enum(['style_kit', 'top_up']),
  // Where to come back to if they cancel; only paths inside the studio.
  returnPath: z
    .string()
    .regex(/^\/studio(\/[\w\-/]*)?$/)
    .default('/studio'),
})

const confirmSchema = z.object({
  sessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/),
})

function offer() {
  return Object.fromEntries(
    Object.entries(PRODUCTS).map(([id, product]) => [
      id,
      { amount: product.amount(), currency: 'usd', credits: product.credits(), days: product.days() },
    ]),
  )
}

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/offer', async () => ({
    available: stripeConfigured(),
    products: offer(),
    free: { credits: env.FREE_CREDITS, avatarRuns: env.FREE_AVATAR_RUNS },
  }))

  app.post(
    '/checkout',
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(checkoutSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const user = await app.collections.users.findOne({ _id: userId })

      if (!user) {
        return reply.code(401).send({ message: 'Sign in again to continue.' })
      }

      try {
        const url = await createCheckout({ user, product: parsed.data.product, returnPath: parsed.data.returnPath })
        return { url }
      } catch (error) {
        if (error instanceof BillingNotConfiguredError) {
          return reply.code(503).send({ message: 'Payments are coming soon.' })
        }

        request.log.error({ err: errorMessage(error) }, 'Stripe checkout failed')
        return reply.code(502).send({ message: 'Checkout is not responding. Try again in a moment.' })
      }
    },
  )

  // The success page reports the session so access starts right away, even
  // before (or without) the webhook.
  app.post(
    '/confirm',
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(confirmSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      let session: Stripe.Checkout.Session

      try {
        session = await retrieveSession(parsed.data.sessionId)
      } catch (error) {
        request.log.warn({ err: errorMessage(error) }, 'Stripe session lookup failed')
        return reply.code(404).send({ message: 'We could not find that payment.' })
      }

      if (session.metadata?.userId !== userId.toString()) {
        return reply.code(404).send({ message: 'We could not find that payment.' })
      }

      if (!sessionSettled(session)) {
        return reply.code(409).send({ message: 'The payment is still processing. Refresh in a moment.' })
      }

      await grantSession(app, session)

      const user = await app.collections.users.findOne({ _id: userId })

      return {
        user: user ? serializeUser(user) : null,
        purchase: {
          product: session.metadata?.product ?? null,
          amount: session.amount_total ?? 0,
          currency: session.currency ?? 'usd',
          sessionId: session.id,
        },
      }
    },
  )
}

// Stripe needs the exact raw body to check the signature, so the webhook
// lives in its own plugin with a string body parser.
export const billingWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  app.post('/', { config: { rateLimit: false } }, async (request, reply) => {
    const signature = request.headers['stripe-signature']

    if (typeof signature !== 'string') {
      return reply.code(400).send({ message: 'Missing Stripe signature.' })
    }

    let event: Stripe.Event

    try {
      event = verifyWebhook(typeof request.body === 'string' ? request.body : '', signature)
    } catch (error) {
      request.log.warn({ err: errorMessage(error) }, 'Rejected Stripe webhook')
      return reply.code(400).send({ message: 'Invalid Stripe webhook.' })
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      await grantSession(app, event.data.object)
    }

    return { received: true }
  })
}

export default billingRoutes
