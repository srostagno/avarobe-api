import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument, LookDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { adminUserIds, isAdmin } from '../billing/entitlements.js'
import { ICON_LOOKS } from '../looks/icons.js'

const avatarsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  // Paging: the createdAt of the last avatar on the previous page.
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
})

const LOOK_FILTERS = ['all', 'down', 'up', 'failed', 'tryon', 'remix'] as const

const looksSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  filter: z.enum(LOOK_FILTERS).default('all'),
  // The looks of one avatar (from the Avatars tab).
  avatarId: z.string().optional(),
})

const LOOK_FILTER_QUERIES: Record<(typeof LOOK_FILTERS)[number], Record<string, unknown>> = {
  all: {},
  down: { 'feedback.rating': 'down' },
  up: { 'feedback.rating': 'up' },
  failed: { status: 'failed' },
  tryon: { source: 'tryon' },
  remix: { remixOf: { $type: 'objectId' } },
}

const ICON_NAMES = new Map(ICON_LOOKS.map((icon) => [icon.id, icon.name]))

async function viewerIfAdmin(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  const viewerId = requireUserId(request)
  const viewer = await app.collections.users.findOne({ _id: viewerId }, { projection: { email: 1 } })

  if (!viewer || !isAdmin(viewer)) {
    await reply.code(403).send({ message: 'Only admins can do this.' })
    return null
  }

  return viewerId
}

// What a reviewer needs to judge a look against its brief. Photos people
// uploaded to try on are left out (they can show anyone); icon try-ons name
// the catalog look, whose image is ours.
async function reviewLook(look: LookDocument) {
  return {
    id: look._id.toString(),
    account: look.userId.toString().slice(-6),
    avatarId: look.avatarId.toString(),
    createdAt: look.createdAt,
    status: look.status,
    error: look.error,
    secondsToReady: look.readyAt ? Math.round((look.readyAt.getTime() - look.createdAt.getTime()) / 1000) : null,
    imageUrl: await signedUrlOrNull(look.imageKey),
    source: look.source ?? 'stylist',
    icon: look.iconId ? { id: look.iconId, name: ICON_NAMES.get(look.iconId) ?? look.iconId } : null,
    remix: look.remixOf ? (look.remix ?? { change: 'custom' as const, detail: null }) : null,
    occasion: { text: look.occasion.text, dressCode: look.occasion.dressCode, asks: look.occasion.asks ?? [] },
    plan: {
      title: look.plan.title,
      vibe: look.plan.vibe,
      summary: look.plan.summary,
      whyItWorks: look.plan.whyItWorks,
      items: (look.plan.items ?? []).map((item) => ({
        slot: item.slot,
        name: item.name,
        color: item.color,
        colorHex: item.colorHex,
        fromPhoto: item.fromPhoto ?? null,
      })),
      tasteApplied: look.plan.tasteApplied ?? [],
    },
    feedback: look.feedback
      ? { rating: look.feedback.rating, aspects: look.feedback.aspects, pieces: look.feedback.pieces, note: look.feedback.note }
      : null,
    favorite: look.favorite,
  }
}

type LookStats = { _id: ObjectId; total: number; ready: number; failed: number; up: number; down: number }

// Avatars made before versioning only have the key.
function renders(avatar: AvatarDocument) {
  if (avatar.versions?.length) {
    return avatar.versions
  }

  return avatar.avatarKey ? [{ id: 'initial', key: avatar.avatarKey, source: 'create' as const, createdAt: avatar.createdAt }] : []
}

// Quality review for admins. Nothing returned names the person (no email or
// name; the account shows as a short code), admins' own work is left out and
// each view is logged. The privacy notice discloses this review.
const adminRoutes: FastifyPluginAsync = async (app) => {
  // The avatars people made. Only the generated renders are returned, never
  // the selfie or the full-body photo.
  app.get('/avatars', { preHandler: authenticate }, async (request, reply) => {
    const viewerId = await viewerIfAdmin(app, request, reply)

    if (!viewerId) {
      return reply
    }

    const parsed = parseBody(avatarsSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const { days, before, limit } = parsed.data
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const inPeriod = { createdAt: { $gte: since }, userId: { $nin: await adminUserIds(app) } }
    const [found, total, stats] = await Promise.all([
      app.collections.avatars
        .find(before ? { ...inPeriod, createdAt: { $gte: since, $lt: before } } : inPeriod, {
          projection: { selfieKey: 0, colorReport: 0, styleProfile: 0, reportBoards: 0, drape: 0 },
        })
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray(),
      app.collections.avatars.countDocuments(inPeriod),
      app.collections.avatars
        .aggregate<{ _id: null; ready: number; failed: number; refined: number }>([
          { $match: inPeriod },
          {
            $group: {
              _id: null,
              ready: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
              refined: {
                $sum: {
                  $cond: [{ $in: ['refine', { $ifNull: ['$versions.source', []] }] }, 1, 0],
                },
              },
            },
          },
        ])
        .toArray(),
    ])
    const page = found.slice(0, limit)
    const looks = await app.collections.looks
      .aggregate<LookStats>([
        { $match: { avatarId: { $in: page.map((avatar) => avatar._id) } } },
        {
          $group: {
            _id: '$avatarId',
            total: { $sum: 1 },
            ready: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            up: { $sum: { $cond: [{ $eq: ['$feedback.rating', 'up'] }, 1, 0] } },
            down: { $sum: { $cond: [{ $eq: ['$feedback.rating', 'down'] }, 1, 0] } },
          },
        },
      ])
      .toArray()
    const looksByAvatar = new Map(looks.map((row) => [row._id.toString(), row]))

    const items = await Promise.all(
      page.map(async (avatar) => {
        const versions = renders(avatar)
        const lookStats = looksByAvatar.get(avatar._id.toString())

        return {
          id: avatar._id.toString(),
          account: avatar.userId.toString().slice(-6),
          createdAt: avatar.createdAt,
          status: avatar.status,
          error: avatar.error,
          secondsToReady: avatar.readyAt ? Math.round((avatar.readyAt.getTime() - avatar.createdAt.getTime()) / 1000) : null,
          presentation: avatar.body.presentation,
          build: avatar.body.build,
          // Whether a full-body photo is on file; the photo itself never leaves.
          bodyPhoto: Boolean(avatar.bodyPhotoKey),
          renders: avatar.generations,
          versions: await Promise.all(
            versions.map(async (version) => ({
              id: version.id,
              source: version.source,
              createdAt: version.createdAt,
              current: version.key === avatar.avatarKey,
              url: await signedUrlOrNull(version.key),
            })),
          ),
          analysis: avatar.colorAnalysis
            ? {
                season: avatar.colorAnalysis.season,
                undertone: avatar.colorAnalysis.undertone,
                contrast: avatar.colorAnalysis.contrast,
                confidence: avatar.colorAnalysis.confidence,
                photoNote: avatar.colorAnalysis.photoNote,
                colors: avatar.colorAnalysis.bestColors.slice(0, 6),
              }
            : null,
          looks: {
            total: lookStats?.total ?? 0,
            ready: lookStats?.ready ?? 0,
            failed: lookStats?.failed ?? 0,
            up: lookStats?.up ?? 0,
            down: lookStats?.down ?? 0,
          },
        }
      }),
    )

    request.log.info({ adminId: viewerId.toString(), days, avatars: items.length }, 'Admin avatar review')

    return {
      days,
      total,
      ready: stats[0]?.ready ?? 0,
      failed: stats[0]?.failed ?? 0,
      refined: stats[0]?.refined ?? 0,
      items,
      nextBefore: found.length > limit ? page.at(-1)?.createdAt ?? null : null,
    }
  })

  // The looks people made, newest first, with the brief they typed, what
  // the stylist planned and their feedback.
  app.get('/looks', { preHandler: authenticate }, async (request, reply) => {
    const viewerId = await viewerIfAdmin(app, request, reply)

    if (!viewerId) {
      return reply
    }

    const parsed = parseBody(looksSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const { days, before, limit, filter } = parsed.data
    const avatarId = parsed.data.avatarId ? toObjectId(parsed.data.avatarId) : null

    if (parsed.data.avatarId && !avatarId) {
      return reply.code(400).send({ message: 'Invalid avatar id.' })
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const inPeriod = {
      createdAt: { $gte: since },
      userId: { $nin: await adminUserIds(app) },
      ...(avatarId ? { avatarId } : {}),
    }
    const matching = { ...inPeriod, ...LOOK_FILTER_QUERIES[filter] }
    const [found, stats] = await Promise.all([
      app.collections.looks
        .find(before ? { ...matching, createdAt: { $gte: since, $lt: before } } : matching, {
          projection: { referenceKey: 0, previewKey: 0, pieces: 0, analysis: 0 },
        })
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray(),
      app.collections.looks
        .aggregate<{ _id: null; total: number; ready: number; failed: number; up: number; down: number }>([
          { $match: inPeriod },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              ready: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
              up: { $sum: { $cond: [{ $eq: ['$feedback.rating', 'up'] }, 1, 0] } },
              down: { $sum: { $cond: [{ $eq: ['$feedback.rating', 'down'] }, 1, 0] } },
            },
          },
        ])
        .toArray(),
    ])
    const page = found.slice(0, limit)
    const items = await Promise.all(page.map(reviewLook))

    request.log.info({ adminId: viewerId.toString(), days, filter, looks: items.length }, 'Admin look review')

    return {
      days,
      filter,
      total: stats[0]?.total ?? 0,
      ready: stats[0]?.ready ?? 0,
      failed: stats[0]?.failed ?? 0,
      up: stats[0]?.up ?? 0,
      down: stats[0]?.down ?? 0,
      items,
      nextBefore: found.length > limit ? page.at(-1)?.createdAt ?? null : null,
    }
  })
}

export default adminRoutes
