import type { FastifyInstance } from 'fastify'

import { env } from '../../config/env.js'
import type { AvatarDocument, ColorsNotify } from '../../types/mongo.js'
import { isGuestEmail } from '../../utils/guests.js'
import type { AiFailure } from '../../utils/openai.js'
import { withLocale } from '../../utils/request-locale.js'
import { failStaleColorReads } from '../../utils/stale-jobs.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { sendColorsReady } from '../lifecycle/service.js'
import { PROVIDER_CODES } from './failures.js'
import { colorsReadStart, newReadId } from './reads.js'
import { runColorsJobSafely } from './service.js'

// "Tell me when my colors are ready": people whose read failed because the
// AI was busy or out of credits, and who left their email. Every few
// minutes their reads are tried again, one at a time, in their language;
// the first one is the probe, so a pass stops at the first failure of the
// AI (no credits yet, OpenAI still down) instead of spending on the rest.
// A photo it refuses is given up (reading it again would cost the same and
// end the same). Each done read emails a sign-in link to their colors
// (lifecycle sendColorsReady).

const HOUR = 60 * 60 * 1000

export const NOTIFY_RULES = {
  // Reads that cost something (no credits, a refused key or a rate limit
  // cost nothing, so they don't count: only the day does).
  attempts: 6,
  window: 24 * HOUR,
  perPass: 5,
} as const

// ---------------------------------------------------------------- pure

export function pendingNotice(notify: ColorsNotify | null | undefined, now: Date) {
  return Boolean(notify && !notify.sentAt && !notify.gaveUpAt && now.getTime() - notify.requestedAt.getTime() <= NOTIFY_RULES.window)
}

// Too old, or tried enough: nothing more is read or emailed.
export function shouldGiveUp(notify: ColorsNotify, now: Date) {
  return (
    !notify.sentAt &&
    !notify.gaveUpAt &&
    (now.getTime() - notify.requestedAt.getTime() > NOTIFY_RULES.window || notify.attempts >= NOTIFY_RULES.attempts)
  )
}

// Whether a failed read counts toward the cap: OpenAI out of credits,
// refusing the key or over its rate limit charges nothing (a daily token
// limit can last hours; the day's window still ends it).
export function countsAsAttempt(code: AiFailure | null | undefined) {
  return code !== 'no_credits' && code !== 'account' && code !== 'rate_limited'
}

// What a scheduled read that didn't bring colors means for the pass: the
// AI failing ends it ('failed', the probe), a photo it refuses is given up,
// anything else (ours, or replaced by a read they started) moves on.
export function afterFailedRead(avatar: Pick<AvatarDocument, 'status' | 'failure'> | null): 'stop' | 'give_up' | 'next' {
  if (avatar?.status !== 'failed') {
    return 'next'
  }

  const code = avatar.failure?.code

  if (code === 'rejected') {
    return 'give_up'
  }

  return code && PROVIDER_CODES.includes(code) ? 'stop' : 'next'
}

// Colors read after they asked to be told (colorsAt), so old colors are
// never emailed as ready.
export function readSinceRequest(avatar: Pick<AvatarDocument, 'colorsAt' | 'colorsNotify'>) {
  const requestedAt = avatar.colorsNotify?.requestedAt

  return Boolean(avatar.colorsAt && requestedAt && avatar.colorsAt.getTime() >= requestedAt.getTime())
}

export type ReadOutcome = 'ready' | 'failed' | 'skipped'

// Reads people one after the other and stops at the first failure: while
// the AI is down, a pass costs one read at most.
export async function readInTurn<T>(items: T[], read: (item: T) => Promise<ReadOutcome>) {
  const outcomes: ReadOutcome[] = []

  for (const item of items) {
    const outcome = await read(item)
    outcomes.push(outcome)

    if (outcome === 'failed') {
      break
    }
  }

  return outcomes
}

// ---------------------------------------------------------------- pass

async function giveUp(app: FastifyInstance, avatar: Pick<AvatarDocument, '_id' | 'userId' | 'colorsNotify'>, now: Date) {
  const result = await app.collections.avatars.updateOne(
    { _id: avatar._id, 'colorsNotify.sentAt': null, 'colorsNotify.gaveUpAt': null },
    { $set: { 'colorsNotify.gaveUpAt': now } },
  )

  if (result.modifiedCount === 0) {
    return false
  }

  void trackServerEvent(app, {
    name: 'colors_notify_gave_up',
    userId: avatar.userId,
    props: { attempts: avatar.colorsNotify?.attempts ?? 0 },
  })
  return true
}

// Who the email can go to: a saved account with a real address. A guest's
// placeholder is never emailed.
async function recipientOf(app: FastifyInstance, avatar: Pick<AvatarDocument, 'userId'>) {
  const user = await app.collections.users.findOne({ _id: avatar.userId })

  return user && !user.guest && !isGuestEmail(user.email) ? user : null
}

let running = false

export async function retryColorReads(app: FastifyInstance, now = new Date()) {
  if (running) {
    return { gaveUp: 0, sent: 0, outcomes: [] as ReadOutcome[] }
  }

  running = true

  try {
    const since = new Date(now.getTime() - NOTIFY_RULES.window)
    const projection = { userId: 1, selfieKey: 1, colorAnalysis: 1, colorsAt: 1, colorsNotify: 1 } as const
    let gaveUp = 0
    let sent = 0

    // 0. A read cut off by a restart: failed, so step 3 can read it again.
    const interrupted = await failStaleColorReads(app, now)

    if (interrupted > 0) {
      app.log.warn({ colorReads: interrupted }, 'Marked interrupted color reads as failed')
    }

    // 1. Too old, tried enough, or a photo the AI refuses (their own new
    // selfie, since): given up, without an email.
    const stale = await app.collections.avatars
      .find(
        {
          'colorsNotify.requestedAt': { $exists: true },
          'colorsNotify.sentAt': null,
          'colorsNotify.gaveUpAt': null,
          $or: [
            { 'colorsNotify.requestedAt': { $lt: since } },
            { 'colorsNotify.attempts': { $gte: NOTIFY_RULES.attempts } },
            { status: 'failed', 'failure.code': 'rejected' },
          ],
        },
        { projection, limit: 200 },
      )
      .toArray()

    for (const avatar of stale) {
      gaveUp += Number(await giveUp(app, avatar, now))
    }

    // 2. Colors in and the email still owed, whichever read brought them
    // (this job's, or one they started themselves). Only colors read since
    // they asked: colors from before (kept through a failure, restored by
    // hand) are never emailed as ready.
    const owed = (
      await app.collections.avatars
        .find(
          {
            'colorsNotify.requestedAt': { $gte: since },
            'colorsNotify.sentAt': null,
            'colorsNotify.gaveUpAt': null,
            colorAnalysis: { $ne: null },
          },
          { projection, limit: 50 },
        )
        .toArray()
    ).filter((avatar) => readSinceRequest(avatar))

    for (const avatar of owed) {
      const user = await recipientOf(app, avatar)

      if (!user) {
        gaveUp += Number(await giveUp(app, avatar, now))
      } else if (await sendColorsReady(app, user, avatar, now)) {
        sent += 1
      }
    }

    // 3. The reads, least recently tried first, so one person who keeps
    // failing doesn't block the rest. Never a photo the AI refused (a
    // missing failure is a read failed before failures were recorded:
    // scripts/colors-notify.ts).
    const due = await app.collections.avatars
      .find(
        {
          status: 'failed',
          avatarKey: null,
          colorAnalysis: null,
          'failure.code': { $nin: ['rejected'] },
          'colorsNotify.requestedAt': { $gte: since },
          'colorsNotify.sentAt': null,
          'colorsNotify.gaveUpAt': null,
          'colorsNotify.attempts': { $lt: NOTIFY_RULES.attempts },
        },
        { projection, sort: { 'colorsNotify.lastTriedAt': 1, 'colorsNotify.requestedAt': 1 }, limit: NOTIFY_RULES.perPass },
      )
      .toArray()

    const outcomes = await readInTurn(due, async (avatar): Promise<ReadOutcome> => {
      const user = await recipientOf(app, avatar)

      if (!user) {
        gaveUp += Number(await giveUp(app, avatar, now))
        return 'skipped'
      }

      // A read is text, not one of the day's new pictures.
      if (!(await reserveGenerations(app, user._id, 'avatar', 1, { image: false }))) {
        return 'skipped'
      }

      const startedAt = new Date()
      const read = { readId: newReadId(), photoKey: avatar.selfieKey }
      const claimed = await app.collections.avatars.updateOne(
        // As listed: not if they (or another instance's pass) tried since,
        // nor once a new selfie of theirs replaced the one listed.
        {
          _id: avatar._id,
          status: 'failed',
          avatarKey: null,
          colorAnalysis: null,
          selfieKey: avatar.selfieKey,
          'colorsNotify.lastTriedAt': avatar.colorsNotify?.lastTriedAt ?? null,
        },
        { $set: { ...colorsReadStart(startedAt, { readId: read.readId, selfieKey: read.photoKey }), 'colorsNotify.lastTriedAt': startedAt } },
      )

      // They tried again themselves meanwhile.
      if (claimed.modifiedCount === 0) {
        await releaseGenerations(app, user._id, 'avatar', 1, { image: false })
        return 'skipped'
      }

      await withLocale(user.locale ?? 'en', () => runColorsJobSafely(app, avatar._id, read, 'notify'))

      const after = await app.collections.avatars.findOne({ _id: avatar._id }, { projection: { ...projection, status: 1, failure: 1 } })

      if (after?.colorAnalysis && readSinceRequest(after)) {
        if (await sendColorsReady(app, user, after, new Date())) {
          sent += 1
        }

        return 'ready'
      }

      const next = afterFailedRead(after)

      if (next === 'give_up') {
        gaveUp += Number(await giveUp(app, after ?? avatar, now))
        return 'skipped'
      }

      if (after?.status === 'failed' && countsAsAttempt(after.failure?.code)) {
        await app.collections.avatars.updateOne({ _id: avatar._id }, { $inc: { 'colorsNotify.attempts': 1 } })
      }

      return next === 'stop' ? 'failed' : 'skipped'
    })

    if (gaveUp || sent || outcomes.length) {
      app.log.info({ gaveUp, sent, outcomes }, 'Color read retries')
    }

    return { gaveUp, sent, outcomes }
  } finally {
    running = false
  }
}

export function startColorRetries(app: FastifyInstance) {
  const run = () => {
    void retryColorReads(app).catch((error: unknown) => {
      app.log.error({ err: error }, 'Color read retries crashed')
    })
  }

  setTimeout(run, Math.min(90_000, env.COLOR_RETRY_EVERY_MS)).unref()
  setInterval(run, env.COLOR_RETRY_EVERY_MS).unref()
}
