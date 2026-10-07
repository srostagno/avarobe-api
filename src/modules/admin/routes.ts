import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument, LifecycleEmailKind, LookDocument } from '../../types/mongo.js'
import { parseBody } from '../../utils/http.js'
import { toObjectId } from '../../utils/object-id.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { CHANNELS } from '../analytics/service.js'
import { analyticsReport } from '../analytics/report.js'
import { adminUserIds, isAdmin } from '../billing/entitlements.js'
import { whyReport } from '../survey/report.js'
import { recentCheckouts } from '../billing/stripe.js'
import { ICON_LOOKS } from '../looks/icons.js'
import { addDays, emailActivity, pacificDay, pacificStart } from './email-activity.js'
import { hairReport } from './hair-report.js'

const avatarsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  // Paging: the createdAt of the last avatar on the previous page.
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  // Only the avatars of people who paid for something.
  buyers: z.enum(['1', '0']).optional(),
})

// What each account bought (one-time products, Pro, the book), for the
// avatars review: paid purchases and paid book orders, never comp ones.
async function purchasesByUser(app: FastifyInstance, userIds: ObjectId[]) {
  const [purchases, guides] = await Promise.all([
    app.collections.purchases
      .find({ userId: { $in: userIds }, amountTotal: { $gt: 0 } }, { projection: { userId: 1, product: 1, amountTotal: 1, createdAt: 1 } })
      .toArray(),
    app.collections.guideOrders
      .find({ userId: { $in: userIds }, amount: { $gt: 0 } }, { projection: { userId: 1, amount: 1, createdAt: 1 } })
      .toArray(),
  ])
  const byUser = new Map<string, { total: number; products: string[]; lastAt: Date }>()
  const add = (userId: ObjectId | null, product: string, amount: number, at: Date) => {
    if (!userId) {
      return
    }

    const entry = byUser.get(userId.toString()) ?? { total: 0, products: [], lastAt: at }
    entry.total += amount
    entry.products.push(product)
    entry.lastAt = at > entry.lastAt ? at : entry.lastAt
    byUser.set(userId.toString(), entry)
  }

  for (const purchase of purchases) add(purchase.userId, purchase.product, purchase.amountTotal, purchase.createdAt)
  for (const order of guides) add(order.userId, 'outfit_guide', order.amount, order.createdAt)

  return byUser
}

// Everyone who ever paid for something (for the "buyers only" filter).
async function buyerIds(app: FastifyInstance) {
  const [fromPurchases, fromGuides] = await Promise.all([
    app.collections.purchases.distinct('userId', { amountTotal: { $gt: 0 } }),
    app.collections.guideOrders.distinct('userId', { amount: { $gt: 0 }, userId: { $ne: null } }),
  ])

  return [...fromPurchases, ...fromGuides].filter((id): id is ObjectId => Boolean(id))
}

const DAY_MS = 24 * 60 * 60 * 1000

const emailsSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const emailActivitySchema = z.object({ from: DAY.optional(), to: DAY.optional() })
const hairSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })
const whySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })

const EMAIL_ORDER: LifecycleEmailKind[] = [
  'welcome',
  'avatar_nudge',
  'looks_nudge',
  'upgrade_offer',
  'upgrade_reminder',
  'upgrade_last_call',
  'trial_started',
  'trial_ending',
  'checkout_rescue',
  'price_drop',
  'xsell_style',
  'xsell_color',
  'xsell_addon_last_call',
  'xsell_hair',
  'xsell_magazine',
  'xsell_event',
  'xsell_guide',
]

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

const analyticsSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  channel: z.enum(['all', ...CHANNELS]).default('all'),
})

const checkoutsSchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) })

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
    // A locked look drawn ahead of time: what the customer sees (blurred)
    // and, for QA, the picture they'd unlock.
    lockedImageUrl: look.teaser?.status === 'ready' ? await signedUrlOrNull(look.teaser.lockedKey) : null,
    teaserUrl: look.teaser?.status === 'ready' ? await signedUrlOrNull(look.teaser.key) : null,
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

    const { days, before, limit, buyers } = parsed.data
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const [admins, paid] = await Promise.all([adminUserIds(app), buyerIds(app)])
    const notAdmin = { $nin: admins }
    const inPeriod = buyers === '1' ? { createdAt: { $gte: since }, userId: { ...notAdmin, $in: paid } } : { createdAt: { $gte: since }, userId: notAdmin }
    const [found, total, stats, buyersInPeriod] = await Promise.all([
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
      app.collections.avatars.distinct('userId', { createdAt: { $gte: since }, userId: { ...notAdmin, $in: paid } }),
    ])
    const page = found.slice(0, limit)
    const bought = await purchasesByUser(app, page.map((avatar) => avatar.userId))
    const looks = await app.collections.looks
      .aggregate<LookStats>([
        { $match: { avatarId: { $in: page.map((avatar) => avatar._id) }, status: { $ne: 'locked' } } },
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
        const purchase = bought.get(avatar.userId.toString())

        return {
          id: avatar._id.toString(),
          account: avatar.userId.toString().slice(-6),
          createdAt: avatar.createdAt,
          status: avatar.status,
          error: avatar.error,
          secondsToReady: avatar.readyAt ? Math.round((avatar.readyAt.getTime() - avatar.createdAt.getTime()) / 1000) : null,
          presentation: avatar.body?.presentation ?? null,
          build: avatar.body?.build ?? null,
          // Whether a full-body photo is on file; the photo itself never leaves.
          bodyPhoto: Boolean(avatar.bodyPhotoKey),
          // The generated best-vs-worst image (like the renders, never the
          // selfie itself): the only picture a colors-only account has.
          drapePreviewUrl: avatar.drapePreview?.status === 'ready' ? await signedUrlOrNull(avatar.drapePreview.key) : null,
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
          // What this account paid for, if anything (US cents).
          buyer: purchase ? { total: purchase.total, products: purchase.products, lastAt: purchase.lastAt } : null,
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
      // Accounts with an avatar in the period that paid for something.
      buyers: buyersInPeriod.length,
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
          // Locked looks were never drawn: they'd read as renders stuck.
          { $match: { ...inPeriod, status: { $ne: 'locked' } } },
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

  // How the lifecycle emails do: for each kind, how many went out, were
  // opened, clicked and led to a purchase. A purchase counts for the last
  // email the person clicked in the 7 days before buying ("after a click");
  // "within 7 days" counts any purchase in the week after receiving one,
  // clicked or not. Opens include Apple Mail's automatic ones.
  // First-party analytics: the funnel, sources, offers and checkouts.
  app.get('/analytics', { preHandler: authenticate }, async (request, reply) => {
    if (!(await viewerIfAdmin(app, request, reply))) {
      return reply
    }

    const parsed = parseBody(analyticsSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    return analyticsReport(app, parsed.data)
  })

  // Why people come, what holds them back from an offer, what convinced
  // the ones who paid (modules/survey).
  app.get('/why', { preHandler: authenticate }, async (request, reply) => {
    if (!(await viewerIfAdmin(app, request, reply))) {
      return reply
    }

    const parsed = parseBody(whySchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    return whyReport(app, parsed.data.days)
  })

  // The Hair studio: its funnel and the accounts using it (hair-report.ts).
  app.get('/hair', { preHandler: authenticate }, async (request, reply) => {
    if (!(await viewerIfAdmin(app, request, reply))) {
      return reply
    }

    const parsed = parseBody(hairSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    return hairReport(app, parsed.data.days)
  })

  // Checkouts as Stripe has them: opened, paid, abandoned (expired) or open.
  app.get('/checkouts', { preHandler: authenticate }, async (request, reply) => {
    if (!(await viewerIfAdmin(app, request, reply))) {
      return reply
    }

    const parsed = parseBody(checkoutsSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    try {
      const admins = new Set((await adminUserIds(app)).map((id) => id.toString()))
      const checkouts = (await recentCheckouts(parsed.data.days)).filter((item) => !item.userId || !admins.has(item.userId))

      return {
        checkouts: checkouts.map((item) => ({ ...item, userId: item.userId ? item.userId.slice(-6) : null })),
      }
    } catch (error) {
      request.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Stripe checkouts not listed')
      return reply.code(502).send({ message: 'Stripe did not answer. Try again in a moment.' })
    }
  })

  // Emails sent per Pacific day and per kind between two days, both
  // included; the last 7 days by default (email-activity.ts).
  app.get('/emails/activity', { preHandler: authenticate }, async (request, reply) => {
    if (!(await viewerIfAdmin(app, request, reply))) {
      return reply
    }

    const parsed = parseBody(emailActivitySchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const to = parsed.data.to ?? pacificDay(new Date())
    const from = parsed.data.from ?? addDays(to, -6)

    if (from > to || addDays(from, 366) < to) {
      return reply.code(400).send({ message: 'Pick a start on or before the end, at most a year apart.' })
    }

    const sends = await app.collections.emailSends
      .find(
        { sentAt: { $gte: pacificStart(from), $lt: pacificStart(addDays(to, 1)) }, userId: { $nin: await adminUserIds(app) } },
        { projection: { kind: 1, sentAt: 1, opens: 1, firstOpenAt: 1, clicks: 1 } },
      )
      .toArray()

    return emailActivity(sends, from, to, EMAIL_ORDER)
  })

  app.get('/emails', { preHandler: authenticate }, async (request, reply) => {
    const viewerId = await viewerIfAdmin(app, request, reply)

    if (!viewerId) {
      return reply
    }

    const parsed = parseBody(emailsSchema, request.query)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const since = new Date(Date.now() - parsed.data.days * DAY_MS)
    const adminIds = await adminUserIds(app)
    const sends = await app.collections.emailSends
      .find({ sentAt: { $gte: since }, userId: { $nin: adminIds } })
      .sort({ sentAt: -1 })
      .toArray()
    const userIds = [...new Set(sends.map((send) => send.userId.toString()))].map((id) => new ObjectId(id))
    const purchases = await app.collections.purchases
      .find({ userId: { $in: userIds }, createdAt: { $gte: since } }, { projection: { userId: 1, amountTotal: 1, createdAt: 1, product: 1 } })
      .toArray()
    const sendsByUser = new Map<string, typeof sends>()

    for (const send of sends) {
      const key = send.userId.toString()
      sendsByUser.set(key, [...(sendsByUser.get(key) ?? []), send])
    }

    // Last-click attribution, one email per purchase.
    const attributed = new Map<string, { purchases: number; revenue: number }>()
    const withinWeek = new Map<string, number>()

    for (const purchase of purchases) {
      const bought = purchase.createdAt.getTime()
      const userSends = sendsByUser.get(purchase.userId.toString()) ?? []
      const clicked = userSends
        .filter((send) => send.firstClickAt && send.firstClickAt.getTime() <= bought && bought - send.firstClickAt.getTime() <= 7 * DAY_MS)
        .sort((a, b) => (b.lastClickAt?.getTime() ?? 0) - (a.lastClickAt?.getTime() ?? 0))[0]

      if (clicked) {
        const key = clicked._id.toString()
        const current = attributed.get(key) ?? { purchases: 0, revenue: 0 }
        attributed.set(key, { purchases: current.purchases + 1, revenue: current.revenue + purchase.amountTotal })
      }

      for (const send of userSends) {
        const received = send.sentAt.getTime()

        if (received <= bought && bought - received <= 7 * DAY_MS) {
          withinWeek.set(send._id.toString(), (withinWeek.get(send._id.toString()) ?? 0) + 1)
        }
      }
    }

    const kinds = new Map<string, { sent: number; opened: number; clicked: number; unsubscribed: number; purchases: number; revenue: number; boughtWithinWeek: number }>()

    for (const send of sends) {
      const row = kinds.get(send.kind) ?? { sent: 0, opened: 0, clicked: 0, unsubscribed: 0, purchases: 0, revenue: 0, boughtWithinWeek: 0 }
      const credit = attributed.get(send._id.toString())
      row.sent += 1
      row.opened += send.opens > 0 || send.firstOpenAt ? 1 : 0
      row.clicked += send.clicks > 0 ? 1 : 0
      row.unsubscribed += send.unsubscribedAt ? 1 : 0
      row.purchases += credit?.purchases ?? 0
      row.revenue += credit?.revenue ?? 0
      row.boughtWithinWeek += withinWeek.has(send._id.toString()) ? 1 : 0
      kinds.set(send.kind, row)
    }

    return {
      days: parsed.data.days,
      kinds: EMAIL_ORDER.filter((kind) => kinds.has(kind)).map((kind) => ({ kind, ...kinds.get(kind)! })),
      recent: sends.slice(0, 40).map((send) => ({
        id: send._id.toString(),
        account: send.userId.toString().slice(-6),
        kind: send.kind,
        subject: send.subject,
        sentAt: send.sentAt,
        opened: send.opens > 0 || Boolean(send.firstOpenAt),
        clicks: send.clicks,
        unsubscribed: Boolean(send.unsubscribedAt),
        purchased: attributed.has(send._id.toString()),
      })),
    }
  })
}

export default adminRoutes