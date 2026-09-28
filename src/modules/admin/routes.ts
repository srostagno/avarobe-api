import type { FastifyPluginAsync } from 'fastify'
import type { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { adminUserIds, isAdmin } from '../billing/entitlements.js'

const avatarsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  // Paging: the createdAt of the last avatar on the previous page.
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
})

type LookStats = { _id: ObjectId; total: number; ready: number; failed: number; up: number; down: number }

// Avatars made before versioning only have the key.
function renders(avatar: AvatarDocument) {
  if (avatar.versions?.length) {
    return avatar.versions
  }

  return avatar.avatarKey ? [{ id: 'initial', key: avatar.avatarKey, source: 'create' as const, createdAt: avatar.createdAt }] : []
}

// Quality review of the avatars people made. Only the generated renders are
// returned: never the selfie or the full-body photo, and nothing that names
// the person (no email or name; the account shows as a short code). Admins'
// own avatars are left out. Each view is logged.
const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/avatars', { preHandler: authenticate }, async (request, reply) => {
    const viewerId = requireUserId(request)
    const viewer = await app.collections.users.findOne({ _id: viewerId }, { projection: { email: 1 } })

    if (!viewer || !isAdmin(viewer)) {
      return reply.code(403).send({ message: 'Only admins can do this.' })
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
}

export default adminRoutes
