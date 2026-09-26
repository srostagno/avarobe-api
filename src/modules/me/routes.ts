import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, requireUserId } from '../../plugins/authenticate.js'
import { clearAuthCookies } from '../../utils/auth-session.js'
import { parseBody } from '../../utils/http.js'
import { serializeUser } from '../../utils/serializers.js'
import { storage } from '../../utils/storage.js'
import { lookStorageKeys } from '../looks/service.js'

const updateSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
})

const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate)

  app.patch('/', async (request, reply) => {
    const parsed = parseBody(updateSchema, request.body)

    if (!parsed.ok) {
      return reply.code(400).send({ message: parsed.message })
    }

    const user = await app.collections.users.findOneAndUpdate(
      { _id: requireUserId(request) },
      { $set: { firstName: parsed.data.firstName, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' })
    }

    return { user: serializeUser(user) }
  })

  // Deletes the account and every photo and render tied to it. Promised in
  // the privacy notice, so it hard-deletes rather than soft-deleting.
  app.delete('/', async (request, reply) => {
    const userId = requireUserId(request)
    const [avatar, looks] = await Promise.all([
      app.collections.avatars.findOne({ userId }),
      app.collections.looks
        .find({ userId }, { projection: { imageKey: 1, previewKey: 1, referenceKey: 1, pieces: 1 } })
        .toArray(),
    ])
    const keys = [
      ...new Set(
        [
          avatar?.selfieKey,
          avatar?.bodyPhotoKey,
          avatar?.avatarKey,
          avatar?.job?.previewKey,
          ...(avatar?.versions ?? []).map((version) => version.key),
          ...looks.flatMap(lookStorageKeys),
        ].filter((key): key is string => Boolean(key)),
      ),
    ]

    await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
    await Promise.all([
      app.collections.looks.deleteMany({ userId }),
      app.collections.collections.deleteMany({ userId }),
      app.collections.avatars.deleteMany({ userId }),
      app.collections.refreshTokens.deleteMany({ userId }),
      app.collections.usageCounters.deleteMany({ userId }),
      app.collections.passkeys.deleteMany({ userId }),
      app.collections.authChallenges.deleteMany({ userId }),
      app.collections.shopSearches.deleteMany({ userId }),
    ])
    await app.collections.users.deleteOne({ _id: userId })

    request.log.info({ userId: userId.toString(), files: keys.length }, 'Account deleted')
    clearAuthCookies(reply)

    return { ok: true }
  })
}

export default meRoutes
