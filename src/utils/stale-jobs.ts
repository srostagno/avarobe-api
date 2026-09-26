import type { FastifyInstance } from 'fastify'

// Generation runs in-process. If the API restarts mid-render the document
// would stay "processing" forever, so on boot anything older than this is
// marked failed and the person can retry.
const STALE_AFTER_MS = 10 * 60 * 1000

export async function failStaleJobs(app: FastifyInstance) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS)
  const now = new Date()
  const [refinements, avatars, looks, pieces] = await Promise.all([
    // An interrupted refinement leaves the previous avatar usable.
    app.collections.avatars.updateMany(
      { status: 'processing', 'job.kind': 'refine', updatedAt: { $lt: cutoff } },
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
      { status: 'processing', 'job.kind': { $ne: 'refine' }, updatedAt: { $lt: cutoff } },
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
    // Piece photos can be retried one by one from the look page.
    app.collections.looks.updateMany(
      { 'pieces.status': 'processing', updatedAt: { $lt: cutoff } },
      { $set: { 'pieces.$[piece].status': 'failed', updatedAt: now } },
      { arrayFilters: [{ 'piece.status': 'processing' }] },
    ),
  ])

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
