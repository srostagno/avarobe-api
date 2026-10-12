import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import type { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate } from '../../plugins/authenticate.js'
import type { RefundRejectCode, RefundRequestDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import {
  REJECT_CODES,
  RefundRequestError,
  approveRefundRequest,
  dueAt,
  flagsFor,
  noteRefundRequest,
  planFor,
  refundHistory,
  refundUsage,
  rejectRefundRequest,
} from '../billing/refund-requests.js'
import { adminViewer } from './guard.js'

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN = ['pending', 'failed', 'approved'] as const

const listSchema = z.object({
  status: z.enum(['open', 'pending', 'failed', 'approved', 'refunded', 'rejected', 'all']).default('open'),
  market: z.enum(['all', 'br', 'other']).default('all'),
  // The period for decided requests (open ones are listed however old).
  days: z.coerce.number().int().min(1).max(365).default(90),
  // Paging decided requests: the createdAt of the last row of the page before.
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const approveSchema = z.object({
  // The plan's total the admin read: approving refunds exactly this.
  expectedAmount: z.number().int().min(1),
  note: z.string().trim().max(1000).optional(),
})

const rejectSchema = z.object({
  code: z.enum(REJECT_CODES as [RefundRejectCode, ...RefundRejectCode[]]),
  // Shown to the customer in their email; required (20+) for 'other'.
  note: z.string().trim().max(1000).optional(),
  cdcOverride: z.boolean().optional(),
})

const noteSchema = z.object({ note: z.string().max(2000) })

// Brazilian purchases: by region or currency, and every withdrawal.
const BRAZIL = [{ 'market.region': 'br' }, { 'market.currency': 'brl' }, { 'statutory.law': 'br_cdc_49' }]

// One line of the queue.
export function adminRow(request: RefundRequestDocument, now = new Date()) {
  const due = dueAt(request)
  const open = (OPEN as readonly string[]).includes(request.status)

  return {
    id: request._id.toString(),
    ref: request.ref,
    createdAt: request.createdAt.toISOString(),
    dueAt: due.toISOString(),
    overdue: open && due.getTime() < now.getTime(),
    status: request.status,
    email: request.email,
    account: request.userId?.toString().slice(-6) ?? null,
    product: request.product,
    amount: request.amount,
    currency: request.currency,
    amountUsd: request.amountUsd,
    category: request.reasonCategory,
    excerpt: request.explanation.length > 140 ? `${request.explanation.slice(0, 139)}…` : request.explanation,
    flags: request.flags,
    statutory: Boolean(request.statutory),
    statutoryUntil: request.statutory?.until.toISOString() ?? null,
    oldGuarantee: request.oldGuarantee,
    hasAttachment: Boolean(request.attachment),
    locale: request.locale,
    country: request.market.signupCountry ?? request.market.requestCountry ?? request.market.card?.country ?? null,
    decision: request.decision
      ? {
          outcome: request.decision.outcome,
          by: request.decision.by,
          at: request.decision.at.toISOString(),
          code: request.decision.code,
          note: request.decision.note,
          cdcOverride: request.decision.cdcOverride,
          adminEmail: request.decision.adminEmail,
        }
      : null,
  }
}

// The whole request for the detail sheet, without its storage key.
function serializeRequest(request: RefundRequestDocument, now = new Date()) {
  const rest: Partial<RefundRequestDocument> = { ...request }
  const row = adminRow(request, now)

  delete rest.openKey
  delete rest.attachment

  return {
    ...rest,
    id: request._id.toString(),
    attachment: request.attachment ? { bytes: request.attachment.bytes } : null,
    dueAt: row.dueAt,
    overdue: row.overdue,
    accountDeleted: Boolean(request.accountDeletedAt),
  }
}

// Open requests first by what can't wait (a Brazilian withdrawal), then the
// oldest; decided ones newest first.
function queueOrder(a: RefundRequestDocument, b: RefundRequestDocument) {
  const statutory = Number(Boolean(b.statutory)) - Number(Boolean(a.statutory))
  return statutory !== 0 ? statutory : a.createdAt.getTime() - b.createdAt.getTime()
}

async function listRequests(app: FastifyInstance, query: z.infer<typeof listSchema>, now = new Date()) {
  const since = new Date(now.getTime() - query.days * DAY_MS)
  const market = query.market === 'br' ? { $or: BRAZIL } : query.market === 'other' ? { $nor: BRAZIL } : {}
  const openOnly = ['open', 'pending', 'failed', 'approved'].includes(query.status)
  const status = query.status === 'open' ? { status: { $in: [...OPEN] } } : query.status === 'all' ? {} : { status: query.status }
  const [open, refunded, rejected] = await Promise.all([
    app.collections.refundRequests.find({ status: { $in: [...OPEN] }, ...market }).limit(500).toArray(),
    app.collections.refundRequests.countDocuments({ status: 'refunded', createdAt: { $gte: since }, ...market }),
    app.collections.refundRequests.countDocuments({ status: 'rejected', createdAt: { $gte: since }, ...market }),
  ])
  const counts = {
    pending: open.filter((request) => request.status === 'pending').length,
    failed: open.filter((request) => request.status === 'failed').length,
    approved: open.filter((request) => request.status === 'approved').length,
    refunded,
    rejected,
    overdue: open.filter((request) => dueAt(request).getTime() < now.getTime()).length,
    statutory: open.filter((request) => request.statutory).length,
  }

  if (openOnly) {
    const rows = open.filter((request) => query.status === 'open' || request.status === query.status).sort(queueOrder)
    return { counts, rows: rows.map((request) => adminRow(request, now)), next: null }
  }

  const rows = await app.collections.refundRequests
    .find({ ...status, ...market, createdAt: { $gte: since, ...(query.before ? { $lt: query.before } : {}) } })
    .sort({ createdAt: -1 })
    .limit(query.limit + 1)
    .toArray()
  const page = rows.slice(0, query.limit)

  return {
    counts,
    rows: page.map((request) => adminRow(request, now)),
    next: rows.length > query.limit ? (page[page.length - 1]?.createdAt.toISOString() ?? null) : null,
  }
}

// Everything the founder decides with: the request, its screenshot, usage
// when asked and now, the signals now, exactly what approving does, the
// customer, and their other requests (by account, email or card).
async function requestDetail(app: FastifyInstance, request: RefundRequestDocument, now = new Date()) {
  const [user, guideOrder, attachmentUrl, planned] = await Promise.all([
    request.userId ? app.collections.users.findOne({ _id: request.userId }) : null,
    request.guideOrderId ? app.collections.guideOrders.findOne({ _id: request.guideOrderId }) : null,
    signedUrlOrNull(request.attachment?.key ?? null),
    planFor(app, request, now),
  ])
  const userId = user ? request.userId : null
  const [usageNow, historyNow, purchases, guestOrders, byUser, byEmail, byCard] = await Promise.all([
    refundUsage(app, { userId, guideOrder, since: request.purchasedAt, covers: request.covers, now }),
    refundHistory(app, {
      userId,
      email: request.email,
      emailHash: request.emailHash,
      fingerprint: request.market.card?.fingerprint ?? null,
      excludeId: request._id,
    }),
    userId ? app.collections.purchases.find({ userId, amountTotal: { $gt: 0 } }).sort({ createdAt: -1 }).limit(50).toArray() : [],
    !userId && request.email
      ? app.collections.guideOrders.find({ email: request.email, amount: { $gt: 0 } }).sort({ createdAt: -1 }).limit(20).toArray()
      : [],
    request.userId
      ? app.collections.refundRequests.find({ userId: request.userId, _id: { $ne: request._id } }).sort({ createdAt: -1 }).limit(20).toArray()
      : [],
    app.collections.refundRequests
      .find({ emailHash: request.emailHash, _id: { $ne: request._id }, ...(request.userId ? { userId: { $ne: request.userId } } : {}) })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray(),
    request.market.card?.fingerprint
      ? app.collections.refundRequests
          .find({ 'market.card.fingerprint': request.market.card.fingerprint, emailHash: { $ne: request.emailHash } })
          .sort({ createdAt: -1 })
          .limit(20)
          .toArray()
      : [],
  ])
  const flagsNow = flagsFor(usageNow, historyNow, {
    product: request.product,
    purchasedAt: request.purchasedAt,
    creditUsed: request.flags.includes('credit_used'),
    disputed: request.market.disputed,
    chargedDuringReview: planned.chargedDuringReview,
    oldGuarantee: request.oldGuarantee,
  })
  const paid = [
    ...purchases.map((purchase) => ({
      product: purchase.product,
      amount: purchase.amountTotal,
      currency: purchase.currency,
      at: purchase.createdAt.toISOString(),
      refundedAt: purchase.refundedAt?.toISOString() ?? null,
    })),
    ...guestOrders.map((order) => ({
      product: 'outfit_guide',
      amount: order.amount,
      currency: order.currency,
      at: order.createdAt.toISOString(),
      refundedAt: order.refundedAt?.toISOString() ?? null,
    })),
  ]

  return {
    request: serializeRequest(request, now),
    attachmentUrl,
    usageNow,
    historyNow,
    flagsNow,
    plan: planned.plan,
    customer: {
      email: request.email,
      firstName: request.firstName,
      userId: request.userId?.toString() ?? null,
      accountDeleted: Boolean(request.userId) && !user,
      createdAt: user?.createdAt.toISOString() ?? null,
      country: user?.location?.country ?? request.market.signupCountry ?? request.market.requestCountry ?? null,
      region: user?.location?.region ?? null,
      locale: user?.locale ?? request.locale,
      channel: user?.acquisition?.channel ?? null,
      campaign: user?.acquisition?.campaign ?? null,
      purchases: paid,
      paidUsd: historyNow.paidUsd,
    },
    related: {
      byUser: byUser.map((other) => adminRow(other, now)),
      byEmail: byEmail.map((other) => adminRow(other, now)),
      byCard: byCard.map((other) => adminRow(other, now)),
    },
  }
}

function refusal(reply: FastifyReply, error: unknown) {
  if (error instanceof RefundRequestError) {
    return reply.code(error.status).send({ message: error.message, request: error.current ? serializeRequest(error.current) : null })
  }

  throw error
}

// Admin → Refunds: the queue of refund requests, each one in full, and the
// founder's decisions. The first admin routes that write: each one is
// admin-only and logged with who did it.
const adminRefundRequestRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  const read = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }

  app.get('/', read, async (request, reply) => {
    if (!(await adminViewer(app, request, reply))) {
      return reply
    }

    const parsed = parseBody(listSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    return listRequests(app, parsed.data)
  })

  const target = async (id: string | undefined, reply: FastifyReply): Promise<ObjectId | null> => {
    const requestId = toObjectId(id)

    if (!requestId) {
      await reply.code(404).send({ message: 'Refund request not found.' })
      return null
    }

    return requestId
  }

  app.get('/:id', read, async (request, reply) => {
    const viewer = await adminViewer(app, request, reply)

    if (!viewer) {
      return reply
    }

    const requestId = await target((request.params as { id?: string }).id, reply)

    if (!requestId) {
      return reply
    }

    const found = await app.collections.refundRequests.findOne({ _id: requestId })

    if (!found) {
      return reply.code(404).send({ message: 'Refund request not found.' })
    }

    request.log.info({ adminId: viewer.id.toString(), requestId: requestId.toString() }, 'Admin refund request viewed')
    return requestDetail(app, found)
  })

  app.post('/:id/approve', write, async (request, reply) => {
    const viewer = await adminViewer(app, request, reply)

    if (!viewer) {
      return reply
    }

    const requestId = await target((request.params as { id?: string }).id, reply)

    if (!requestId) {
      return reply
    }

    const parsed = parseBody(approveSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    request.log.info({ adminId: viewer.id.toString(), requestId: requestId.toString(), action: 'approve', expectedAmount: parsed.data.expectedAmount }, 'Admin refund request')

    try {
      const updated = await approveRefundRequest(app, {
        id: requestId,
        adminId: viewer.id,
        adminEmail: viewer.email,
        expectedAmount: parsed.data.expectedAmount,
        note: parsed.data.note || null,
      })
      return { request: serializeRequest(updated) }
    } catch (error) {
      return refusal(reply, error)
    }
  })

  app.post('/:id/reject', write, async (request, reply) => {
    const viewer = await adminViewer(app, request, reply)

    if (!viewer) {
      return reply
    }

    const requestId = await target((request.params as { id?: string }).id, reply)

    if (!requestId) {
      return reply
    }

    const parsed = parseBody(rejectSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    request.log.info(
      { adminId: viewer.id.toString(), requestId: requestId.toString(), action: 'reject', code: parsed.data.code, cdcOverride: Boolean(parsed.data.cdcOverride) },
      'Admin refund request',
    )

    try {
      const updated = await rejectRefundRequest(app, {
        id: requestId,
        adminId: viewer.id,
        adminEmail: viewer.email,
        code: parsed.data.code,
        note: parsed.data.note || null,
        cdcOverride: Boolean(parsed.data.cdcOverride),
      })
      return { request: serializeRequest(updated) }
    } catch (error) {
      return refusal(reply, error)
    }
  })

  app.post('/:id/note', write, async (request, reply) => {
    const viewer = await adminViewer(app, request, reply)

    if (!viewer) {
      return reply
    }

    const requestId = await target((request.params as { id?: string }).id, reply)

    if (!requestId) {
      return reply
    }

    const parsed = parseBody(noteSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    request.log.info({ adminId: viewer.id.toString(), requestId: requestId.toString(), action: 'note' }, 'Admin refund request')

    try {
      return { request: serializeRequest(await noteRefundRequest(app, { id: requestId, note: parsed.data.note })) }
    } catch (error) {
      return refusal(reply, error)
    }
  })
}

export default adminRefundRequestRoutes
