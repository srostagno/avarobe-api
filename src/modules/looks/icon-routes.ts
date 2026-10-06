import { readFile } from 'node:fs/promises'

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import type { Presentation } from '../../types/mongo.js'
import { errorMessage, parseBody } from '../../utils/http.js'
import { EDITS } from './edits.js'
import { ICON_LOOKS, type IconLook } from './icons.js'
import { startTryOn } from './try-on.js'

// Everything that can be tried on in one tap: the icon looks and every
// Edit's looks (ids are unique across both).
const CATALOG: IconLook[] = [...ICON_LOOKS, ...EDITS.flatMap((edit) => edit.looks)]

const tryOnSchema = z.object({
  notes: z.string().trim().max(280).optional(),
})

// The try-on reference ships with the API. Resolved from this module so it
// works both from src (tsx) and from dist.
function iconImageUrl(look: IconLook) {
  return new URL(`../../../assets/icon-looks/${look.id}.jpg`, import.meta.url)
}

// The catalog for a wardrobe. Unisex wardrobes (and anyone without an avatar
// yet) get both, alternating so the grid mixes them.
export function looksFor<T extends Pick<IconLook, 'presentation'>>(looks: T[], presentation: Presentation | null) {
  const menswear = looks.filter((look) => look.presentation === 'menswear')
  const womenswear = looks.filter((look) => look.presentation === 'womenswear')

  if (presentation === 'menswear') {
    return menswear
  }

  if (presentation === 'womenswear') {
    return womenswear
  }

  return Array.from({ length: Math.max(menswear.length, womenswear.length) }, (_, index) => [
    womenswear[index],
    menswear[index],
  ])
    .flat()
    .filter((look): look is T => Boolean(look))
}

// The web serves the display image from its public folder. Generator-only
// fields (an Edit look's scene and source) stay here.
export function serializeIconLook(look: IconLook) {
  const { id, presentation, name, era, mood, description, person, items } = look
  return { id, presentation, name, era, mood, description, person, items, image: `/icon-looks/${id}.webp` }
}

const iconLookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const userId = requireUserId(request)
    const avatar = await app.collections.avatars.findOne({ userId }, { projection: { body: 1 } })

    return { looks: looksFor(ICON_LOOKS, avatar?.body?.presentation ?? null).map(serializeIconLook) }
  })

  // Try-on of an icon look or an Edit's look: the upload flow, with the
  // catalog image as the outfit photo. The render runs in the background.
  app.post(
    '/:id/try-on',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = requireUserId(request)
      const icon = CATALOG.find((look) => look.id === (request.params as { id?: string }).id)

      if (!icon) {
        return reply.code(404).send({ message: 'Look not found.' })
      }

      const parsed = parseBody(tryOnSchema, request.body)

      if (!parsed.ok) {
        return reply.code(400).send({ message: parsed.message })
      }

      const avatar = await app.collections.avatars.findOne({ userId })

      if (!avatar?.avatarKey || avatar.status !== 'ready') {
        return reply.code(409).send({ message: 'Your avatar needs to be ready before trying on outfits.' })
      }

      let photo: Buffer

      try {
        photo = await readFile(iconImageUrl(icon))
      } catch (error) {
        request.log.error({ err: errorMessage(error), iconId: icon.id }, 'Icon look image missing')
        return reply.code(503).send({ message: 'This look is not available right now. Try another one.' })
      }

      return startTryOn(app, request, reply, { userId, avatar, photo, notes: parsed.data.notes || null, icon })
    },
  )
}

export default iconLookRoutes
