import type { FastifyInstance } from 'fastify'

import { env } from '../../config/env.js'
import type { AvatarDocument, ColorsNotify } from '../../types/mongo.js'
import { isGuestEmail } from '../../utils/guests.js'
import type { AiFailure } from '../../utils/openai.js'
import { withLocale } from '../../utils/request-locale.js'
import { releaseGenerations, reserveGenerations } from '../../utils/usage.js'
import { trackServerEvent } from '../analytics/service.js'
import { sendColorsReady } from '../lifecycle/service.js'
import { colorsReadReset, runColorsJobSafely } from './service.js'

// "Tell me when my colors are ready": people whose read failed because the
// AI was busy or out of credits, and who left their email. Every few
// minutes their reads are tried again, one at a time, in their language;
// the first one is the probe, so a pass stops at the first failure (no
// credits yet, OpenAI still down) instead of spending on the rest. Each
// done read emails a sign-in link to their colors (lifecycle sendColorsReady).

const HOUR = 60 * 60 * 1000

export const NOTIFY_RULES = {
  // Reads that cost something (a failure with no credits or a refused key
  // costs nothing, so it doesn't count).
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

// Whether a failed read counts toward the cap: OpenAI out of credits or
// refusing the key charges nothing.
export function countsAsAttempt(code: AiFailure | null | undefined) {
  return code !== 'no_credits' && code !== 'account'
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
    const projection = { userId: 1, colorAnalysis: 1, colorsNotify: 1 } as const
    let gaveUp = 0
    let sent = 0

    // 1. Too old or tried enough: given up, without an email.
    const stale = await app.collections.avatars
      .find(
        {
          'colorsNotify.requestedAt': { $exists: true },
          'colorsNotify.sentAt': null,
          'colorsNotify.gaveUpAt': null,
          $or: [{ 'colorsNotify.requestedAt': { $lt: since } }, { 'colorsNotify.attempts': { $gte: NOTIFY_RULES.attempts } }],
        },
        { projection, limit: 200 },
      )
      .toArray()

    for (const avatar of stale) {
      gaveUp += Number(await giveUp(app, avatar, now))
    }

    // 2. Colors in and the email still owed, whichever read brought them
    // (this job's, or one they started themselves).
    const owed = await app.collections.avatars
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

    for (const avatar of owed) {
      const user = await recipientOf(app, avatar)

      if (!user) {
        gaveUp += Number(await giveUp(app, avatar, now))
      } else if (await sendColorsReady(app, user, avatar, now)) {
        sent += 1
      }
    }

    // 3. The reads, least recently tried first, so one person who keeps
    // failing doesn't block the rest.
    const due = await app.collections.avatars
      .find(
        {
          status: 'failed',
          avatarKey: null,
          colorAnalysis: null,
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

      if (!(await reserveGenerations(app, user._id, 'avatar', 1))) {
        return 'skipped'
      }

      const startedAt = new Date()
      const claimed = await app.collections.avatars.updateOne(
        { _id: avatar._id, status: 'failed', avatarKey: null },
        { $set: { ...colorsReadReset(startedAt), 'colorsNotify.lastTriedAt': startedAt } },
      )

      // They tried again themselves meanwhile.
      if (claimed.modifiedCount === 0) {
        await releaseGenerations(app, user._id, 'avatar', 1)
        return 'skipped'
      }

      await withLocale(user.locale ?? 'en', () => runColorsJobSafely(app, avatar._id, 'notify'))

      const after = await app.collections.avatars.findOne({ _id: avatar._id }, { projection: { ...projection, failure: 1 } })

      if (after?.colorAnalysis) {
        if (await sendColorsReady(app, user, after, new Date())) {
          sent += 1
        }

        return 'ready'
      }

      if (countsAsAttempt(after?.failure?.code)) {
        await app.collections.avatars.updateOne({ _id: avatar._id }, { $inc: { 'colorsNotify.attempts': 1 } })
      }

      return 'failed'
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
