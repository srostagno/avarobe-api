import type { FastifyInstance } from 'fastify'

import { refundCredits } from '../modules/billing/entitlements.js'
import { markHairstyleFailed } from '../modules/hair/service.js'
import { BOARD_KINDS } from '../modules/report/boards.js'

// Generation runs in-process. If the API restarts mid-render the document
// would stay "processing" forever, so on boot anything older than this is
// marked failed and the person can retry.
const STALE_AFTER_MS = 10 * 60 * 1000

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
      { status: 'processing', 'job.kind': { $nin: ['refine', 'hair'] }, updatedAt: { $lt: cutoff } },
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

  if (hairProfiles.modifiedCount || stuckHairstyles.length) {
    app.log.warn(
      { hairProfiles: hairProfiles.modifiedCount, hairstyles: stuckHairstyles.length },
      'Marked interrupted hair generations as failed',
    )
  }

  if (refinements.modifiedCount || avatars.modifiedCount || looks.modifiedCount || pieces.modifiedCount) {
    app.log.warn(
      {
        refinements: refinements.modifiedCount,
        avatars: avatars.modifiedCount,
        looks: looks.modifiedCount,
        pieces: pieces.modifiedCount,
      },
      'Marked interrupted generations as failed',
    )
  }
}
