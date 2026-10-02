import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument, BoardKind } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import {
  PaywallError,
  billingState,
  loadBillingUser,
  requireColorReport,
  requireStyleReport,
  sendPaywall,
} from '../billing/entitlements.js'
import { BOARD_KINDS, COLOR_BOARDS, STYLE_BOARDS, buildColorBoards, buildStyleBoards, startBoards, writeBoards } from './boards.js'
import { generateColorReport, generateStyleProfile, startDrapePreview, startDrapeTest } from './service.js'

const refreshSchema = z.object({ refresh: z.boolean().default(false) })

const REPORT_LIMIT_MESSAGE = 'You’ve updated your report a few times today. Come back tomorrow for another take.'

const boardSchema = z.object({ kind: z.enum([...COLOR_BOARDS, ...STYLE_BOARDS]) })

const isColorBoard = (kind: BoardKind) => (COLOR_BOARDS as readonly BoardKind[]).includes(kind)

// Boards go out with a signed URL once ready; the prompt stays on the server.
async function serializeBoards(boards: AvatarDocument['reportBoards'], kinds: readonly BoardKind[]) {
  const entries = await Promise.all(
    kinds.map(async (kind) => {
      const board = boards?.[kind]

      return board
        ? ([
            kind,
            {
              status: board.status,
              url: board.status === 'ready' ? await signedUrlOrNull(board.key) : null,
              layout: board.layout,
              panels: board.panels,
              size: board.size,
            },
          ] as const)
        : null
    }),
  )

  return Object.fromEntries(entries.filter((entry) => entry !== null))
}

type ReportAccess = { color: boolean; style: boolean }

// Each half goes out only with its report: the Color Advisor (the color
// report, drape test and color boards) and the Style Advisor (the style
// profile and its boards). The admin review shows it the same way.
export async function serializeReport(avatar: AvatarDocument | null, access: ReportAccess) {
  const kinds = BOARD_KINDS.filter((kind) => (isColorBoard(kind) ? access.color : access.style))

  return {
    colorAvailable: access.color,
    styleAvailable: access.style,
    color: access.color ? (avatar?.colorReport?.data ?? null) : null,
    drape:
      access.color && avatar?.drape
        ? {
            status: avatar.drape.status,
            url: await signedUrlOrNull(avatar.drape.key),
            wear: avatar.drape.wear,
            avoid: avatar.drape.avoid,
          }
        : null,
    style: access.style ? (avatar?.styleProfile?.data ?? null) : null,
    boards: await serializeBoards(avatar?.reportBoards, kinds),
  }
}

async function reportAccess(app: Parameters<FastifyPluginAsync>[0], userId: Parameters<typeof loadBillingUser>[1]) {
  const user = await loadBillingUser(app, userId)
  const state = user ? billingState(user) : null

  return { color: Boolean(state?.colorReport), style: Boolean(state?.styleReport) }
}

// The reports: the Color Advisor (advanced color analysis with a drape test)
// and the Style Advisor (the style profile), each with its visual boards. Generated on request and kept
// until the selfie (color) or the body (style) changes. Writing them never
// costs credits, so a report from before the boards is simply written again.
const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)

    const access = await reportAccess(app, userId)

    if (!access.color && !access.style) {
      return serializeReport(null, access)
    }

    return serializeReport(await app.collections.avatars.findOne({ userId }), access)
  })

  // The free best-vs-worst preview, for avatars made before it existed (new
  // avatars start it when they're ready). Idempotent: it starts once per
  // selfie, and again only after a failure.
  app.post(
    '/preview',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const avatar = await app.collections.avatars.findOne({ userId }, { projection: { _id: 1, status: 1 } })

      if (!avatar || avatar.status !== 'ready') {
        return reply.code(409).send({ message: 'Your avatar needs to be ready first.' })
      }

      const started = await startDrapePreview(app, avatar._id)
      return { started }
    },
  )

  app.post(
    '/color',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(refreshSchema, request.body ?? {})

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      try {
        await requireColorReport(app, userId, 'The advanced color report')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.colorAnalysis || !avatar.avatarKey) {
        return reply.code(409).send({ message: 'Your avatar and colors need to be ready first.' })
      }

      const access = await reportAccess(app, userId)

      if (avatar.colorReport && !parsed.data.refresh) {
        return serializeReport(avatar, access)
      }

      if (!(await reserveGenerations(app, userId, 'report', 1))) {
        return reply.code(429).send({ message: REPORT_LIMIT_MESSAGE })
      }

      let data: Awaited<ReturnType<typeof generateColorReport>>

      try {
        data = await generateColorReport(avatar)
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Color report failed')
        await releaseGenerations(app, userId, 'report', 1)
        return reply.code(502).send({ message: 'We could not write your color report. Try again.' })
      }

      const updated = await writeBoards(app, avatar._id, COLOR_BOARDS, buildColorBoards(data, avatar), {
        colorReport: { data, createdAt: new Date() },
        drape: {
          status: 'processing',
          key: avatar.drape?.key ?? null,
          wear: data.drape.wear,
          avoid: data.drape.avoid,
          updatedAt: new Date(),
        },
      })

      startDrapeTest(app, avatar._id)
      startBoards(app, avatar._id, COLOR_BOARDS)

      return serializeReport(updated, access)
    },
  )

  // Retries a drape test that failed.
  app.post(
    '/color/drape',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)

      try {
        await requireColorReport(app, userId, 'The drape test')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOneAndUpdate(
        { userId, 'drape.status': 'failed' },
        { $set: { 'drape.status': 'processing', 'drape.updatedAt': new Date() } },
        { returnDocument: 'after' },
      )

      if (!avatar) {
        return reply.code(409).send({ message: 'There is no drape test to retry.' })
      }

      startDrapeTest(app, avatar._id)

      return serializeReport(avatar, await reportAccess(app, userId))
    },
  )

  // Retries one board that failed, with the access its report needs. Several
  // can fail together, hence the looser limit.
  app.post(
    '/boards/:kind/retry',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(boardSchema, request.params)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const { kind } = parsed.data
      const color = isColorBoard(kind)

      try {
        if (color) {
          await requireColorReport(app, userId, 'This color test')
        } else {
          await requireStyleReport(app, userId, 'This style test')
        }
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOneAndUpdate(
        { userId, [`reportBoards.${kind}.status`]: 'failed' },
        { $set: { [`reportBoards.${kind}.status`]: 'processing', [`reportBoards.${kind}.updatedAt`]: new Date() } },
        { returnDocument: 'after' },
      )

      if (!avatar) {
        return reply.code(409).send({ message: 'There is nothing to retry here.' })
      }

      startBoards(app, avatar._id, [kind])

      return serializeReport(avatar, await reportAccess(app, userId))
    },
  )

  app.post(
    '/style',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const parsed = parseBody(refreshSchema, request.body ?? {})

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      try {
        await requireStyleReport(app, userId, 'Your style profile')
      } catch (error) {
        if (error instanceof PaywallError) {
          return sendPaywall(reply, error)
        }

        throw error
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.colorAnalysis) {
        return reply.code(409).send({ message: 'Your avatar and colors need to be ready first.' })
      }

      const access = await reportAccess(app, userId)

      if (avatar.styleProfile && !parsed.data.refresh) {
        return serializeReport(avatar, access)
      }

      if (!(await reserveGenerations(app, userId, 'report', 1))) {
        return reply.code(429).send({ message: REPORT_LIMIT_MESSAGE })
      }

      try {
        const data = await generateStyleProfile(app, avatar)
        const updated = await writeBoards(app, avatar._id, STYLE_BOARDS, buildStyleBoards(data, avatar), {
          styleProfile: { data, createdAt: new Date() },
        })

        startBoards(app, avatar._id, STYLE_BOARDS)

        return serializeReport(updated, access)
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Style profile failed')
        await releaseGenerations(app, userId, 'report', 1)
        return reply.code(502).send({ message: 'We could not write your style profile. Try again.' })
      }
    },
  )
}

export default reportRoutes
