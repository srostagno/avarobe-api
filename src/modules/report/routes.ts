import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { AvatarDocument, BoardKind } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { signedUrlOrNull } from '../../utils/storage.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import {
  PaywallError,
  hasColorAccess,
  hasKit,
  requireColorAccess,
  requireKit,
  sendPaywall,
} from '../billing/entitlements.js'
import { BOARD_KINDS, COLOR_BOARDS, STYLE_BOARDS, buildColorBoards, buildStyleBoards, startBoards, writeBoards } from './boards.js'
import { generateColorReport, generateStyleProfile, startDrapeTest } from './service.js'

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

// The style half (profile and boards) needs the Style Kit; the Color Report
// unlocks the rest.
async function serializeReport(avatar: AvatarDocument | null, kit: boolean) {
  return {
    color: avatar?.colorReport?.data ?? null,
    drape: avatar?.drape
      ? {
          status: avatar.drape.status,
          url: await signedUrlOrNull(avatar.drape.key),
          wear: avatar.drape.wear,
          avoid: avatar.drape.avoid,
        }
      : null,
    style: kit ? (avatar?.styleProfile?.data ?? null) : null,
    boards: await serializeBoards(avatar?.reportBoards, kit ? BOARD_KINDS : COLOR_BOARDS),
  }
}

// The Style Kit reports: advanced color analysis with a drape test, and the
// style profile, each with its visual boards. Generated on request and kept
// until the selfie (color) or the body (style) changes. Writing them never
// costs credits, so a report from before the boards is simply written again.
const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)

    const [kit, color] = await Promise.all([hasKit(app, userId), hasColorAccess(app, userId)])

    if (!color) {
      return { available: false, colorAvailable: false, color: null, drape: null, style: null, boards: {} }
    }

    const report = await serializeReport(await app.collections.avatars.findOne({ userId }), kit)

    return { available: kit, colorAvailable: true, ...report }
  })

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
        await requireColorAccess(app, userId, 'The advanced color report')
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

      const kit = await hasKit(app, userId)

      if (avatar.colorReport && !parsed.data.refresh) {
        return serializeReport(avatar, kit)
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

      return serializeReport(updated, kit)
    },
  )

  // Retries a drape test that failed.
  app.post(
    '/color/drape',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)

      try {
        await requireColorAccess(app, userId, 'The drape test')
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

      return serializeReport(avatar, await hasKit(app, userId))
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
          await requireColorAccess(app, userId, 'This color test')
        } else {
          await requireKit(app, userId, 'This style test')
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

      return serializeReport(avatar, color ? await hasKit(app, userId) : true)
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
        await requireKit(app, userId, 'Your style profile')
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

      if (avatar.styleProfile && !parsed.data.refresh) {
        return serializeReport(avatar, true)
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

        return serializeReport(updated, true)
      } catch (error) {
        request.log.error({ err: errorMessage(error) }, 'Style profile failed')
        await releaseGenerations(app, userId, 'report', 1)
        return reply.code(502).send({ message: 'We could not write your style profile. Try again.' })
      }
    },
  )
}

export default reportRoutes
