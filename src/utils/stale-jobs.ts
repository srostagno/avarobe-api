import type { FastifyInstance } from 'fastify'

// Generation runs in-process. If the API restarts mid-render the document
// would stay "processing" forever, so on boot anything older than this is
// marked failed and the person can retry.
const STALE_AFTER_MS = 10 * 60 * 1000

export async function failStaleJobs(app: FastifyInstance) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS)
  const now = new Date()
  const [avatars, looks] = await Promise.all([
    app.collections.avatars.updateMany(
      { status: 'processing', updatedAt: { $lt: cutoff } },
      {
        $set: {
          status: 'failed',
          error: 'We could not finish your avatar. Please try again.',
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
  ])

  if (avatars.modifiedCount || looks.modifiedCount) {
    app.log.warn(
      { avatars: avatars.modifiedCount, looks: looks.modifiedCount },
      'Marked interrupted generations as failed',
    )
  }
}
