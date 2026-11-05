import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { z } from 'zod'

import { env } from '../../config/env.js'
import { formatMoney } from '../../i18n/emails.js'
import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { parseBody } from '../../utils/http.js'
import { requestLocale } from '../../utils/locale.js'
import { seasonName } from '../../utils/seasons.js'
import { trackServerEvent } from '../analytics/service.js'
import { billingState, loadBillingUser } from '../billing/entitlements.js'
import { pricingRegion, regionalPrice } from '../billing/pricing.js'
import { sendColorsSaved } from '../lifecycle/service.js'

import { GIUGLIA_PLACEMENTS, GIUGLIA_TOPICS, giugliaAnswer, giugliaDisclosure, type GiugliaContext } from './answers.js'

// Every purchase here can be refunded on request within 7 days (billing/refund-requests.ts).
const REFUND_DAYS = 7

const askSchema = z
  .object({
    topic: z.enum(GIUGLIA_TOPICS),
    placement: z.enum(GIUGLIA_PLACEMENTS),
  })
  .strict()

const off = (reply: FastifyReply) => reply.code(404).send({ message: 'Not found.' })

// Giuglia in the app (Nov 2026, E-1102-giuglia1), behind GIUGLIA_IN_APP: on
// the results and the checkout she answers the doubt the person taps (no
// free text) from her own result, says she's an AI, and keeps only the
// topic as an analytics event (giuglia_question), never what was written.
const giugliaRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // Whether she's on, who she is, and the doubts she answers.
  app.get('/', async (request, reply) => {
    if (!env.GIUGLIA_IN_APP) {
      return off(reply)
    }

    requireUserId(request)

    return { enabled: true, ai: true, disclosure: giugliaDisclosure(requestLocale(request)), topics: GIUGLIA_TOPICS }
  })

  app.post('/ask', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!env.GIUGLIA_IN_APP) {
      return off(reply)
    }

    const userId = requireUserId(request)
    const parsed = parseBody(askSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const [user, avatar] = await Promise.all([
      loadBillingUser(app, userId),
      app.collections.avatars.findOne({ userId }, { projection: { colorAnalysis: 1 } }),
    ])

    if (!user) {
      return reply.code(401).send({ message: 'Sign in again to continue.' })
    }

    const analysis = avatar?.colorAnalysis ?? null

    if (!analysis) {
      return reply.code(409).send({ code: 'no_colors', message: 'See your colors first.' })
    }

    const locale = requestLocale(request)
    const region = pricingRegion(request, user)
    const state = billingState(user, Date.now(), region)
    const money = (product: 'color_report' | 'pro_monthly') => {
      const price = regionalPrice(product, region)
      return formatMoney(price.amount, price.currency, locale)
    }
    const context: GiugliaContext = {
      season: seasonName(analysis.season, locale),
      confidence: analysis.confidence,
      colorPrice: money('color_report'),
      proMonthlyPrice: money('pro_monthly'),
      colorProDays: state.colorProDays,
      ownsColorAdvisor: state.colorReport,
      refundDays: REFUND_DAYS,
    }
    const { topic, placement } = parsed.data
    const answer = giugliaAnswer(topic, context, locale)

    void trackServerEvent(app, {
      name: 'giuglia_question',
      userId,
      props: { topic, placement, region, owns: state.colorReport, action: answer.action ?? 'none' },
    })

    return { ai: true, disclosure: giugliaDisclosure(locale), answer }
  })

  // "Later" (E-1105-giuglialater): she offers to email a signed-in person
  // their colors so they don't get lost, and this sends it on their tap:
  // a link back to the studio, at most once every 7 days. A guest saves
  // with the page's email form instead. Only the outcome is kept.
  app.post('/later', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!env.GIUGLIA_IN_APP) {
      return off(reply)
    }

    const userId = requireUserId(request)
    const [user, avatar] = await Promise.all([
      app.collections.users.findOne({ _id: userId }),
      app.collections.avatars.findOne({ userId }, { projection: { colorAnalysis: 1 } }),
    ])

    if (!user || user.deletedAt) {
      return reply.code(401).send({ message: 'Sign in again to continue.' })
    }

    if (!avatar?.colorAnalysis) {
      return reply.code(409).send({ code: 'no_colors', message: 'See your colors first.' })
    }

    const result = await sendColorsSaved(app, user, avatar.colorAnalysis.season)

    void trackServerEvent(app, { name: 'giuglia_later', userId, props: { result } })

    if (result === 'no_email') {
      return reply.code(409).send({ code: 'no_email', message: 'Save your colors with your email first.' })
    }

    if (result === 'failed') {
      return reply.code(502).send({ code: 'send_failed', message: 'We could not send it. Try again in a moment.' })
    }

    return { sent: result === 'sent', already: result === 'already' }
  })
}

export default giugliaRoutes
