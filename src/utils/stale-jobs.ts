import type { FastifyInstance } from 'fastify'

import { settleFailure } from '../modules/avatar/service.js'
import { refundCredits, releaseAvatarRun } from '../modules/billing/entitlements.js'
import { markMakeupFailed } from '../modules/makeup/service.js'
import { markHairstyleFailed } from '../modules/hair/service.js'
import { BOARD_KINDS } from '../modules/report/boards.js'
import { releaseGenerations } from './usage.js'

// Generation runs in-process. If the API restarts mid-render the document
// would stay "processing" forever, so on boot anything older than this is
// marked failed and the person can retry.
const STALE_AFTER_MS = 10 * 60 * 1000

// An interrupted color read (colors first, before the avatar). Also at the
// start of each pass of the color read retries (modules/avatar/retry.ts): a
// restart minutes after a read started leaves it here past the boot's
// check, and the studio would show its progress forever (and a "tell me
// when ready" would never be read again). Like any failed read: colors
// someone had stay (ready, the failure kept) and the photo it held goes;
// without colors it's failed. The generation it reserved comes back.
export async function failStaleColorReads(app: FastifyInstance, now = new Date()) {
  const stuck = await app.collections.avatars
    .find(
      { status: 'processing', 'job.kind': 'colors', updatedAt: { $lt: new Date(now.getTime() - STALE_AFTER_MS) } },
      { projection: { _id: 1, userId: 1, job: 1, updatedAt: 1 } },
    )
    .toArray()
  let count = 0

  for (const avatar of stuck) {
    const readId = avatar.job?.readId
    // A read started before reads had ids: as it was listed.
    const where = readId
      ? { _id: avatar._id, 'job.readId': readId }
      : { _id: avatar._id, status: 'processing', 'job.kind': 'colors', updatedAt: avatar.updatedAt }
    const settled = await settleFailure(app, where, { code: 'internal', at: now, attempts: 1, detail: 'interrupted' }, { via: 'colors' })

    if (settled !== null) {
      count += 1
      await releaseGenerations(app, avatar.userId, 'avatar', 1, { image: false })
    }
  }

  return count
}

export async function failStaleJobs(app: FastifyInstance) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS)
  const now = new Date()

  // Interrupted looks give their credit back, like any failed render.
  const paidLooks = await app.collections.looks
    .find({ status: 'processing', updatedAt: { $lt: cutoff }, creditSpent: true }, { projection: { userId: 1 } })
    .toArray()

  for (const look of paidLooks) {
    const claimed = await app.collections.looks.updateOne(
      { _id: look._id, creditSpent: true },
      { $set: { creditSpent: false } },
    )

    if (claimed.modifiedCount) {
      await refundCredits(app, look.userId, 1)
    }
  }
  const colorReads = await failStaleColorReads(app, now)
  // Interrupted avatar renders (a deploy mid-render) give back what they
  // took: the day's avatar render and picture, and the Pro month's render.
  const stuckRenders = await app.collections.avatars
    .find({ status: 'processing', 'job.kind': { $ne: 'colors' }, updatedAt: { $lt: cutoff } }, { projection: { userId: 1, job: 1 } })
    .toArray()
  const [refinements, avatars, looks, , pieces] = await Promise.all([
    // An interrupted refinement or haircut leaves the previous avatar usable.
    app.collections.avatars.updateMany(
      { status: 'processing', 'job.kind': { $in: ['refine', 'hair'] }, updatedAt: { $lt: cutoff } },
      {
        $set: {
          status: 'ready',
          error: 'We could not apply those changes. Your avatar is unchanged; try again.',
          job: null,
          updatedAt: now,
        },
      },
    ),
    app.collections.avatars.updateMany(
      { status: 'processing', 'job.kind': { $nin: ['refine', 'hair', 'colors'] }, updatedAt: { $lt: cutoff } },
      {
        $set: {
          status: 'failed',
          error: 'We could not finish your avatar. Please try again.',
          job: null,
          updatedAt: now,
        },
      },
    ),
    app.collections.looks.updateMany(
      { status: 'processing', updatedAt: { $lt: cutoff } },
      {
        $set: {
          status: 'failed',
          error: 'We could not render this look. Try again.',
          updatedAt: now,
        },
      },
    ),
    // A stuck drape test can be retried from the report.
    app.collections.avatars.updateMany(
      { 'drape.status': 'processing', 'drape.updatedAt': { $lt: cutoff } },
      { $set: { 'drape.status': 'failed' } },
    ),
    // Piece photos can be retried one by one from the look page.
    app.collections.looks.updateMany(
      { 'pieces.status': 'processing', updatedAt: { $lt: cutoff } },
      { $set: { 'pieces.$[piece].status': 'failed', updatedAt: now } },
      { arrayFilters: [{ 'piece.status': 'processing' }] },
    ),
    // So can the report boards, from the report.
    ...BOARD_KINDS.map((kind) =>
      app.collections.avatars.updateMany(
        { [`reportBoards.${kind}.status`]: 'processing', [`reportBoards.${kind}.updatedAt`]: { $lt: cutoff } },
        { $set: { [`reportBoards.${kind}.status`]: 'failed' } },
      ),
    ),
  ])

  for (const avatar of stuckRenders) {
    await releaseGenerations(app, avatar.userId, 'avatar', 1)
    await releaseAvatarRun(app, avatar.userId, avatar.job?.avatarRun)
  }

  // Hair studio: an interrupted read can be started again; an interrupted
  // haircut gives back what it took (a credit or the free hairstyle).
  const [hairProfiles, stuckHairstyles] = await Promise.all([
    app.collections.avatars.updateMany(
      { 'hairProfile.status': 'processing', 'hairProfile.updatedAt': { $lt: cutoff } },
      {
        $set: {
          'hairProfile.status': 'failed',
          'hairProfile.error': 'We could not finish reading your hair. Try again.',
          'hairProfile.updatedAt': now,
        },
      },
    ),
    app.collections.hairstyles
      .find({ status: 'processing', updatedAt: { $lt: cutoff } }, { projection: { _id: 1 } })
      .toArray(),
  ])

  for (const hairstyle of stuckHairstyles) {
    await markHairstyleFailed(app, hairstyle._id)
  }

  // Makeup try-ons: an interrupted one gives back what it took.
  const stuckMakeup = await app.collections.makeupTryOns
    .find({ status: 'processing', updatedAt: { $lt: cutoff } }, { projection: { _id: 1 } })
    .toArray()

  for (const tryOn of stuckMakeup) {
    await markMakeupFailed(app, tryOn._id)
  }

  if (stuckMakeup.length) {
    app.log.warn({ makeup: stuckMakeup.length }, 'Marked interrupted makeup try-ons as failed')
  }

  if (hairProfiles.modifiedCount || stuckHairstyles.length) {
    app.log.warn(
      { hairProfiles: hairProfiles.modifiedCount, hairstyles: stuckHairstyles.length },
      'Marked interrupted hair generations as failed',
    )
  }

  if (colorReads || refinements.modifiedCount || avatars.modifiedCount || looks.modifiedCount || pieces.modifiedCount) {
    app.log.warn(
      {
        colorReads,
        refinements: refinements.modifiedCount,
        avatars: avatars.modifiedCount,
        looks: looks.modifiedCount,
        pieces: pieces.modifiedCount,
      },
      'Marked interrupted generations as failed',
    )
  }
}
