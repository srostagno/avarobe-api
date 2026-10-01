import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument, UserDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { billingState, isAdmin } from '../billing/entitlements.js'
import { serializeReport } from '../report/routes.js'

const DAY = 24 * 60 * 60 * 1000

const listSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
})

async function viewerIfAdmin(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  const viewerId = requireUserId(request)
  const viewer = await app.collections.users.findOne({ _id: viewerId }, { projection: { email: 1 } })

  if (!viewer || !isAdmin(viewer)) {
    await reply.code(403).send({ message: 'Only admins can do this.' })
    return null
  }

  return viewerId
}

// When its newest half was written.
function writtenAt(avatar: Pick<AvatarDocument, 'colorReport' | 'styleProfile'>) {
  return Math.max(avatar.colorReport?.createdAt.getTime() ?? 0, avatar.styleProfile?.createdAt.getTime() ?? 0)
}

// How the owner has the reports now: bought, Pro, a trial, or not anymore
// (a trial or Pro that ended).
function accessOf(user: UserDocument) {
  const state = billingState(user)
  const via = user.colorReportAt || user.styleReportAt
    ? 'bought'
    : state.trialing
      ? 'trial'
      : state.proLive
        ? 'pro'
        : 'ended'

  return { color: state.colorReport, style: state.styleReport, via }
}

async function summary(app: FastifyInstance, avatar: AvatarDocument, user: UserDocument) {
  const boards = Object.values(avatar.reportBoards ?? {})
  const purchases = await app.collections.purchases
    .find({ userId: user._id }, { projection: { product: 1, createdAt: 1 } })
    .sort({ createdAt: 1 })
    .toArray()

  return {
    userId: user._id.toString(),
    account: user._id.toString().slice(-6),
    state: user.location?.region ?? null,
    season: avatar.colorAnalysis?.season ?? null,
    presentation: avatar.body?.presentation ?? null,
    color: avatar.colorReport ? { at: avatar.colorReport.createdAt.toISOString() } : null,
    style: avatar.styleProfile ? { at: avatar.styleProfile.createdAt.toISOString() } : null,
    drape: avatar.drape?.status ?? null,
    boards: {
      total: boards.length,
      ready: boards.filter((board) => board?.status === 'ready').length,
      failed: boards.filter((board) => board?.status === 'failed').length,
    },
    access: accessOf(user),
    purchases: purchases.map((purchase) => ({ product: purchase.product, at: purchase.createdAt.toISOString() })),
    // The drape test (their face in their best and worst colors), else the
    // avatar: something to recognize the report by in the list.
    thumbUrl: await signedUrlOrNull(avatar.drape?.status === 'ready' ? avatar.drape.key : (avatar.avatarKey ?? null)),
  }
}

// The reports people got, for checking their quality: the list (newest
// first) and each one exactly as its owner sees it, both halves. Admins
// only, and admins' own accounts left out; opening one is logged.
const adminReportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request, reply) => {
    const viewerId = await viewerIfAdmin(app, request, reply)

    if (!viewerId) {
      return reply
    }

    const parsed = parseBody(listSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const { days, before, limit } = parsed.data
    const since = new Date(Date.now() - days * DAY)
    const avatars = await app.collections.avatars
      .find({ $or: [{ 'colorReport.createdAt': { $gte: since } }, { 'styleProfile.createdAt': { $gte: since } }] })
      .limit(500)
      .toArray()
    const owners = await app.collections.users.find({ _id: { $in: avatars.map((avatar) => avatar.userId) } }).toArray()
    const ownerById = new Map(owners.map((user) => [user._id.toString(), user]))
    const rows = avatars
      .map((avatar) => ({ avatar, user: ownerById.get(avatar.userId.toString()), at: writtenAt(avatar) }))
      .filter((row): row is { avatar: AvatarDocument; user: UserDocument; at: number } => Boolean(row.user) && !isAdmin(row.user!))
      .filter((row) => !before || row.at < before.getTime())
      .sort((a, b) => b.at - a.at)
    const page = rows.slice(0, limit)
    const items = await Promise.all(page.map((row) => summary(app, row.avatar, row.user)))

    request.log.info({ adminId: viewerId.toString(), days, reports: items.length }, 'Admin report list')

    return {
      items,
      total: rows.length,
      nextBefore: rows.length > limit && page.length > 0 ? new Date(page[page.length - 1]!.at).toISOString() : null,
    }
  })

  app.get('/:userId', async (request, reply) => {
    const viewerId = await viewerIfAdmin(app, request, reply)

    if (!viewerId) {
      return reply
    }

    const userId: ObjectId | null = toObjectId((request.params as { userId?: string }).userId)
    const [user, avatar] = userId
      ? await Promise.all([app.collections.users.findOne({ _id: userId }), app.collections.avatars.findOne({ userId })])
      : [null, null]

    if (!user || !avatar || isAdmin(user) || (!avatar.colorReport && !avatar.styleProfile)) {
      return reply.code(404).send({ message: 'No report for this account.' })
    }

    request.log.info({ adminId: viewerId.toString(), account: user._id.toString().slice(-6) }, 'Admin report review')

    const [report, selfieUrl, avatarUrl, info] = await Promise.all([
      serializeReport(avatar, { color: Boolean(avatar.colorReport), style: Boolean(avatar.styleProfile) }),
      signedUrlOrNull(avatar.selfieKey ?? null),
      signedUrlOrNull(avatar.avatarKey ?? null),
      summary(app, avatar, user),
    ])

    return { summary: info, report, selfieUrl, avatarUrl }
  })
}

export default adminReportRoutes
