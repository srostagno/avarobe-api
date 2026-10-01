import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { storage } from '../../utils/storage.js'
import { deleteHairstyles } from '../hair/service.js'
import { lookStorageKeys } from '../looks/service.js'
import { boardKeys } from '../report/boards.js'

// Everything someone made in the app: their photos, avatar, colors and
// reports, looks, haircuts, taste notes and collections, files included.
// Their account, sign-in and purchases stay. Used when they delete the
// account, and when an admin starts over as a brand-new user.
export async function deleteUserContent(app: FastifyInstance, userId: ObjectId) {
  const [avatar, looks] = await Promise.all([
    app.collections.avatars.findOne({ userId }),
    app.collections.looks
      .find({ userId }, { projection: { imageKey: 1, previewKey: 1, referenceKey: 1, pieces: 1, teaser: 1 } })
      .toArray(),
  ])
  const keys = [
    ...new Set(
      [
        avatar?.selfieKey,
        avatar?.bodyPhotoKey,
        avatar?.avatarKey,
        avatar?.job?.previewKey,
        avatar?.drape?.key,
        avatar?.drapePreview?.key,
        avatar?.drapePreview?.lockedKey,
        ...boardKeys(avatar?.reportBoards),
        ...(avatar?.versions ?? []).flatMap((version) => [version.key, version.hair?.refKey]),
        ...looks.flatMap(lookStorageKeys),
      ].filter((key): key is string => Boolean(key)),
    ),
  ]

  await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
  await deleteHairstyles(app, userId)
  await Promise.all([
    app.collections.looks.deleteMany({ userId }),
    app.collections.tastes.deleteMany({ userId }),
    app.collections.collections.deleteMany({ userId }),
    app.collections.avatars.deleteMany({ userId }),
    app.collections.usageCounters.deleteMany({ userId }),
    app.collections.shopSearches.deleteMany({ userId }),
  ])

  return { files: keys.length }
}
