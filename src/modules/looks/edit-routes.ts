import type { FastifyPluginAsync } from 'fastify'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { presentationOf } from '../avatar/body.js'
import { EDITS, UPCOMING_EDITS, type Edit } from './edits.js'
import { catalogTable, looksFor, serializeIconLook } from './icon-routes.js'
import { ICON_LOOKS } from './icons.js'

const DAY = 24 * 60 * 60 * 1000
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
    const avatar = await app.collections.avatars.findOne({ userId }, { projection: { body: 1, presentation: 1 } })

    // Someone who came for their colors told us how they shop before the body.
    return editsFor(avatar ? presentationOf(avatar) : null)
  })
}

export default editRoutes
