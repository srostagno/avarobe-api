import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { storage } from '../../utils/storage.js'
import { checkStorageKeys } from '../check/service.js'
import { deleteHairstyles } from '../hair/service.js'
import { deleteLookData } from '../look/service.js'
import { lookStorageKeys } from '../looks/service.js'
import { boardKeys } from '../report/boards.js'

// Everything someone made in the app: their photos, avatar, colors and
// reports, looks, haircuts, taste notes, collections and Look Great, and the pictures
// made for their emails, files included. Their account, sign-in and
// purchases stay. Used when an admin starts over as a brand-new user; a
// deleted account keeps all of it but its pictures (delete-account.ts).
export async function deleteUserContent(app: FastifyInstance, userId: ObjectId) {
  const [user, avatar, looks, checks] = await Promise.all([
    app.collections.users.findOne({ _id: userId }, { projection: { xsellAssets: 1 } }),
    app.collections.avatars.findOne({ userId }),
    app.collections.looks
      .find({ userId }, { projection: { imageKey: 1, previewKey: 1, referenceKey: 1, pieces: 1, teaser: 1 } })
      .toArray(),
    app.collections.colorChecks.find({ userId }, { projection: { garmentKey: 1, imageKey: 1 } }).toArray(),
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
        ...checks.flatMap(checkStorageKeys),
        // Cross-sell pictures (lifecycle/assets.ts): most are a look's or a
        // haircut's, the magazine cover is its own file.
        ...Object.values(user?.xsellAssets ?? {}).map((asset) => asset?.key),
      ].filter((key): key is string => Boolean(key)),
    ),
  ]

  await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)))
  await deleteHairstyles(app, userId)
  const look = await deleteLookData(app, userId, { profile: true })
  await Promise.all([
    app.collections.looks.deleteMany({ userId }),
    app.collections.tastes.deleteMany({ userId }),
    app.collections.collections.deleteMany({ userId }),
    app.collections.avatars.deleteMany({ userId }),
    app.collections.usageCounters.deleteMany({ userId }),
    app.collections.shopSearches.deleteMany({ userId }),
    app.collections.surveyAnswers.deleteMany({ userId }),
    app.collections.colorChecks.deleteMany({ userId }),
    app.collections.styleEvents.deleteMany({ userId }),
    app.collections.users.updateOne({ _id: userId }, { $unset: { xsellAssets: '', lookPhotosAdded: '' } }),
  ])

  return { files: keys.length + look.photos }
}

// A deleted account's purchases stay as they were, for the books, the
// admin's revenue and refunds (Stripe keeps the sale, and an open refund
// request is still decided against it), marked `accountDeletedAt`.
export async function forgetPurchases(app: FastifyInstance, userId: ObjectId, now = new Date()) {
  const marked = await app.collections.purchases.updateMany({ userId }, { $set: { accountDeletedAt: now } })

  return marked.modifiedCount
}
