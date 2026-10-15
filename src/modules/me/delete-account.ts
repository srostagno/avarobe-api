import type { FastifyInstance } from 'fastify'
import type { ObjectId } from 'mongodb'

import { deletedEmail, emailHash, isPlaceholderEmail } from '../../utils/deleted-accounts.js'
import { isValidStorageKey, storage } from '../../utils/storage.js'
import { forgetRefundRequests } from '../billing/refund-requests.js'
import { deleteLookData } from '../look/service.js'

import { forgetPurchases } from './content.js'

// Deleting an account (Oct 2026, Silvio's rule): everything stays for our
// records except the person's photos and name. The row stays with
// `deletedAt`, an email alias that can't receive mail (so the real address
// can sign up again) and the real one only as a hash; no name, password,
// passkeys, sessions or sign-in links. Her colors, reports, looks, haircuts,
// magazines, checks, answers, usage, purchases and statistics stay, without
// a single picture of her: every photo and render is deleted, its file and
// its key. Refund requests lose their screenshot, email and name
// (forgetRefundRequests). Face Age goes entirely: photos, readings, birth
// date and release. Used by DELETE /me and for guests who never saved
// (auth/guests.ts).

// Keys typed as a plain string are left as '' when their file goes; the
// rest become null.
const STRING_KEYS = new Set(['selfieKey', 'refKey', 'garmentKey'])

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

// The value with every storage key of this person's folder blanked, and
// those keys collected (to delete their files). Only plain objects and
// arrays are walked: ids, dates and binaries are left as they are.
function blankKeys(value: unknown, folder: string, keys: string[], field: string, inVersions: boolean): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith(folder) || !isValidStorageKey(value)) {
      return value
    }

    keys.push(value)
    return STRING_KEYS.has(field) || (inVersions && field === 'key') ? '' : null
  }

  if (Array.isArray(value)) {
    return value.map((item) => blankKeys(item, folder, keys, field, inVersions))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, blankKeys(item, folder, keys, name, inVersions || name === 'versions')]))
  }

  return value
}

// The top-level fields of a document that held a picture, without it.
export function withoutPhotos(doc: Record<string, unknown>, userId: ObjectId) {
  const folder = `users/${userId.toString()}/`
  const keys: string[] = []
  const set: Record<string, unknown> = {}

  for (const [field, value] of Object.entries(doc)) {
    if (field === '_id' || field === 'userId') {
      continue
    }

    const before = keys.length
    const blanked = blankKeys(value, folder, keys, field, field === 'versions')

    if (keys.length > before) {
      set[field] = blanked
    }
  }

  return { keys, set }
}

// A render still running for her would write its picture after this: it's
// stopped (failed, its job gone) so its update finds nothing to write to.
const stopped = (doc: { status?: unknown }, withError: boolean) =>
  doc.status === 'processing' ? { status: 'failed', ...(withError ? { error: 'Account deleted.' } : {}) } : {}

// Every photo and render of this person, files and keys: the selfie and
// body photo, the avatar and its versions, drapes and report boards,
// looks (their pieces, try-on photos and teasers), haircuts, magazines,
// color checks and the pictures made for her emails. Each document stays,
// marked `photosDeletedAt`; then her storage folder is swept for anything
// no document pointed to. Returns how many files went.
export async function deletePhotos(app: FastifyInstance, userId: ObjectId, now = new Date()) {
  const [user, avatars, looks, hairstyles, magazines, checks] = await Promise.all([
    app.collections.users.findOne({ _id: userId }, { projection: { xsellAssets: 1 } }),
    app.collections.avatars.find({ userId }).toArray(),
    app.collections.looks.find({ userId }).toArray(),
    app.collections.hairstyles.find({ userId }).toArray(),
    app.collections.magazines.find({ userId }).toArray(),
    app.collections.colorChecks.find({ userId }).toArray(),
  ])
  const keys: string[] = []
  const blank = (doc: object) => {
    const out = withoutPhotos(doc as Record<string, unknown>, userId)
    keys.push(...out.keys)
    return out.set
  }

  await Promise.all([
    ...avatars.map((avatar) => {
      const notify = avatar.colorsNotify && !avatar.colorsNotify.sentAt && !avatar.colorsNotify.gaveUpAt ? { colorsNotify: { ...avatar.colorsNotify, gaveUpAt: now } } : {}

      return app.collections.avatars.updateOne(
        { _id: avatar._id },
        { $set: { ...blank(avatar), ...stopped(avatar, true), ...notify, job: null, photosDeletedAt: now, updatedAt: now } },
      )
    }),
    ...looks.map((look) =>
      app.collections.looks.updateOne({ _id: look._id }, { $set: { ...blank(look), ...stopped(look, true), photosDeletedAt: now, updatedAt: now } }),
    ),
    ...hairstyles.map((hairstyle) =>
      app.collections.hairstyles.updateOne({ _id: hairstyle._id }, { $set: { ...blank(hairstyle), ...stopped(hairstyle, false), photosDeletedAt: now, updatedAt: now } }),
    ),
    ...magazines.map((magazine) =>
      app.collections.magazines.updateOne({ _id: magazine._id }, { $set: { ...blank(magazine), ...stopped(magazine, false), photosDeletedAt: now, updatedAt: now } }),
    ),
    ...checks.map((check) =>
      app.collections.colorChecks.updateOne({ _id: check._id }, { $set: { ...blank(check), ...stopped(check, true), photosDeletedAt: now, updatedAt: now } }),
    ),
  ])

  // The pictures made for her emails.
  const assets = user ? blank({ xsellAssets: user.xsellAssets }) : {}

  if (Object.keys(assets).length > 0) {
    await app.collections.users.updateOne({ _id: userId }, { $set: assets })
  }

  const files = [...new Set(keys)]
  await Promise.all(files.map((key) => storage.remove(key).catch(() => undefined)))

  return files.length
}

// Her name out of the subjects of the emails she got ("Ana, your magazine
// is ready"), which Admin → Emails keeps.
async function namelessSends(app: FastifyInstance, userId: ObjectId, firstName: string) {
  const name = firstName.trim()

  if (!name) {
    return
  }

  const sends = await app.collections.emailSends.find({ userId }, { projection: { subject: 1 } }).toArray()

  await Promise.all(
    sends
      .filter((send) => send.subject.includes(name))
      .map((send) => app.collections.emailSends.updateOne({ _id: send._id }, { $set: { subject: send.subject.split(name).join('…') } })),
  )
}

// The whole deletion. The row is changed last, so a deletion that stopped
// halfway can be asked again. Null when there's no such account.
export async function deleteAccount(app: FastifyInstance, userId: ObjectId, now = new Date()) {
  const user = await app.collections.users.findOne({ _id: userId }, { projection: { email: 1, firstName: 1, emailTipsOptOutAt: 1 } })

  if (!user) {
    return null
  }

  const alias = deletedEmail(userId)
  const files = await deletePhotos(app, userId, now)
  // Face Age is the exception to keeping records: her face photos, their
  // readings, her birth date and release all go (what the release promises).
  const look = await deleteLookData(app, userId, { profile: true })
  // Refund requests stay for the books: screenshots go, decided ones are
  // scrubbed, open ones can still be decided (money back only).
  await forgetRefundRequests(app, userId)
  // Anything left in her folder that no document pointed to (an older
  // selfie, a render that finished after its document moved on).
  const swept = await storage.removeFolder(userId.toString()).catch((error: unknown) => {
    app.log.warn({ err: error, userId: userId.toString() }, 'Deleted account: storage folder not swept')
    return 0
  })

  await Promise.all([
    app.collections.refreshTokens.deleteMany({ userId }),
    app.collections.passkeys.deleteMany({ userId }),
    app.collections.authChallenges.deleteMany({ userId }),
    forgetPurchases(app, userId, now),
    // The book bought signed in keeps its download link, not her address.
    app.collections.guideOrders.updateMany({ userId, email: { $ne: null } }, { $set: { email: alias } }),
    namelessSends(app, userId, user.firstName ?? ''),
  ])

  const real = user.email && !isPlaceholderEmail(user.email) ? user.email : null

  await app.collections.users.updateOne(
    { _id: userId },
    {
      $set: {
        email: alias,
        emailHash: real ? emailHash(real) : null,
        firstName: '',
        deletedAt: now,
        emailTipsOptOutAt: user.emailTipsOptOutAt ?? now,
        updatedAt: now,
      },
      $unset: {
        passwordHash: '',
        passwordUpdatedAt: '',
        failedLoginCount: '',
        lockedUntil: '',
        emailVerificationNonceHash: '',
        passwordResetNonceHash: '',
        handoffNonceHash: '',
        signInNonceHash: '',
        checkoutLinkNonceHash: '',
        colorsLinkNonceHash: '',
      },
    },
  )

  return { files: files + look.photos, swept }
}
