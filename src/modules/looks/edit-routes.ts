import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { parseBody } from '../../utils/http.js'
import { presentationOf } from '../avatar/body.js'
import { EDITS, UPCOMING_EDITS, type Edit } from './edits.js'
import { catalogTable, looksFor, serializeIconLook } from './icon-routes.js'
import { ICON_LOOKS } from './icons.js'

const DAY = 24 * 60 * 60 * 1000
// Looks picked to try on next: a few, never drawn until they ask.
const MAX_PICKS = 3

const picksSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(60)).max(MAX_PICKS),
})
// An Edit shows as new for its first week.
const NEW_FOR = 7 * DAY

// The icon looks, always there after the season's Edits.
const ICONS: Edit = {
  id: 'icons',
  name: 'Icons',
  emoji: '✨',
  tagline: 'Looks inspired by the eras and styles everyone knows.',
  droppedAt: '2026-09-27',
  looks: ICON_LOOKS.map((look) => ({ ...look, scene: 'studio' })),
}

// The Edits for a wardrobe, newest first, then the icons; and the next drop.
// Names and taglines come in the request's language (i18n/catalog.*.ts).
export function editsFor(presentation: Parameters<typeof looksFor>[1], now = new Date()) {
  const table = catalogTable()
  const dropped = EDITS.filter((edit) => new Date(`${edit.droppedAt}T00:00:00Z`).getTime() <= now.getTime()).sort((a, b) =>
    b.droppedAt.localeCompare(a.droppedAt),
  )
  const upcoming = UPCOMING_EDITS.find((edit) => new Date(`${edit.at}T00:00:00Z`).getTime() > now.getTime())
  const next = upcoming ? { ...upcoming, name: table?.upcoming[upcoming.name] ?? upcoming.name } : null

  return {
    edits: [...dropped, ICONS]
      .map((edit) => {
        const looks = looksFor(edit.looks, presentation).map(serializeIconLook)
        const age = now.getTime() - new Date(`${edit.droppedAt}T00:00:00Z`).getTime()
        const text = table?.edits[edit.id]

        return {
          id: edit.id,
          name: text?.name ?? edit.name,
          emoji: edit.emoji,
          tagline: text?.tagline ?? edit.tagline,
          droppedAt: edit.droppedAt,
          isNew: edit.id !== 'icons' && age < NEW_FOR,
          looks,
        }
      })
      .filter((edit) => edit.looks.length > 0),
    next,
  }
}

const editRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  // Their wardrobe's looks in every Edit; a look is tried on through
  // /looks/icons/:id/try-on, like an icon look.
  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const [avatar, user] = await Promise.all([
      app.collections.avatars.findOne({ userId }, { projection: { body: 1, presentation: 1 } }),
      app.collections.users.findOne({ _id: userId }, { projection: { lookPicks: 1 } }),
    ])

    // Someone who came for their colors told us how they shop before the body.
    return { ...editsFor(avatar ? presentationOf(avatar) : null), picks: user?.lookPicks?.ids ?? [] }
  })

  // The looks they picked to try on next (the Halloween flow). Kept, not
  // drawn: after buying they're asked whether to try them on.
  app.post('/picks', async (request, reply) => {
    const parsed = parseBody(picksSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const known = new Set(EDITS.flatMap((edit) => edit.looks.map((look) => look.id)))
    const ids = [...new Set(parsed.data.ids)].filter((id) => known.has(id))

    await app.collections.users.updateOne(
      { _id: requireUserId(request) },
      { $set: { lookPicks: ids.length > 0 ? { ids, at: new Date() } : null, updatedAt: new Date() } },
    )

    return { picks: ids }
  })
}

export default editRoutes
