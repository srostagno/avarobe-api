import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../config/env.js'
import type { LookReminder, UserDocument } from '../../types/mongo.js'
import { emailLink } from '../../utils/auth-links.js'
import { deliverEmail } from '../../utils/email.js'
import { storage } from '../../utils/storage.js'
import { localHour } from '../../utils/timezones.js'
import { storedAdIds } from '../billing/conversions.js'
import { regionForCountry } from '../billing/pricing.js'
import { lookReminderEmail } from '../lifecycle/templates.js'
import { trackContent, unsubscribeUrl } from '../lifecycle/service.js'

import { ageOn, currentAge, shownAge } from './age.js'
import { deleteLookData } from './service.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// How long after her last photo (or reminder) the next reminder goes. A
// little under the period, so a daily one doesn't drift later each day.
const EVERY: Record<Exclude<LookReminder, 'off'>, number> = { daily: 20 * HOUR, few: 2 * DAY, weekly: 7 * DAY - 4 * HOUR }
// In her morning, when the window light is good for the photo.
const FIRST_HOUR = 8
const LAST_HOUR = 11
// Three years without a photo or a visit: everything goes (the retention we
// promise in the release; BIPA's limit).
const KEEP_FOR = 3 * 365 * DAY
// A read interrupted by a restart.
const STALE_READ = 10 * 60 * 1000
const RUN_EVERY_MS = 15 * 60 * 1000

export function reminderDue(input: {
  reminder: LookReminder
  lastPhotoAt: Date | null
  reminderLastAt: Date | null
  startedAt: Date
  hour: number
  now: Date
}) {
  if (input.reminder === 'off' || input.hour < FIRST_HOUR || input.hour > LAST_HOUR) {
    return false
  }

  const last = Math.max(input.lastPhotoAt?.getTime() ?? 0, input.reminderLastAt?.getTime() ?? 0, input.startedAt.getTime())

  return input.now.getTime() - last >= EVERY[input.reminder]
}

export async function sendLookReminders(app: FastifyInstance, now = new Date()) {
  const users = await app.collections.users
    .find({
      'lookGreat.reminder': { $in: ['daily', 'few', 'weekly'] },
      guest: { $ne: true },
      deletedAt: null,
      emailTipsOptOutAt: null,
    })
    .toArray()
  let sent = 0

  for (const user of users) {
    const profile = user.lookGreat!
    const checks = await app.collections.faceChecks
      .find({ userId: user._id, status: 'ready' }, { projection: { takenAt: 1, createdAt: 1, reading: 1 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()
    const due = reminderDue({
      reminder: profile.reminder,
      lastPhotoAt: checks[0]?.createdAt ?? null,
      reminderLastAt: profile.reminderLastAt ?? null,
      startedAt: profile.createdAt,
      hour: localHour(user.location, now),
      now,
    })

    if (!due) {
      continue
    }

    // Claimed before sending, so two runs never send it twice.
    const claimed = await app.collections.users.updateOne(
      { _id: user._id, 'lookGreat.reminderLastAt': profile.reminderLastAt ?? null },
      { $set: { 'lookGreat.reminderLastAt': now, 'lifecycleEmails.look_reminder': now } },
    )

    if (claimed.modifiedCount === 0) {
      continue
    }

    const points = checks
      .filter((check) => check.reading?.usable)
      .map((check) => ({ takenAt: check.takenAt, age: shownAge(check.reading!.apparentAge, ageOn(profile.birthDate, check.takenAt)) }))
    const latestTip = checks.find((check) => check.reading?.usable)?.reading?.tips[0]?.text ?? null

    if (await sendReminder(app, user, { age: currentAge(points), photos: points.length, tip: latestTip }, now)) {
      sent += 1
    }
  }

  return { checked: users.length, sent }
}

async function sendReminder(app: FastifyInstance, user: UserDocument, numbers: { age: number | null; photos: number; tip: string | null }, now: Date) {
  const profile = user.lookGreat!
  const sendId = new ObjectId()
  const locale = user.locale ?? 'en'
  const ads = storedAdIds(user)

  try {
    const url = new URL(await emailLink(app, user, '/studio/look-great?from=email', { ads }))
    url.searchParams.set('utm_source', 'email')
    url.searchParams.set('utm_medium', 'lifecycle')
    url.searchParams.set('utm_campaign', 'look_reminder')
    const content = lookReminderEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      reminder: profile.reminder as 'daily' | 'few' | 'weekly',
      age: numbers.age,
      realAge: ageOn(profile.birthDate, now),
      photos: numbers.photos,
      tip: numbers.tip,
      url: url.toString(),
      settingsUrl: await emailLink(app, user, '/studio/look-great#settings', { ads }),
    })

    await app.collections.emailSends.insertOne({ _id: sendId, userId: user._id, kind: 'look_reminder', subject: content.subject, sentAt: now, opens: 0, clicks: 0 })

    return await deliverEmail({ log: app.log, to: { email: user.email, name: user.firstName }, content: trackContent(content, sendId) })
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString() }, 'Look Great reminder failed')
    await app.collections.emailSends.deleteOne({ _id: sendId })
    return false
  }
}

// Everything of hers after three years without a photo (or starting again).
export async function forgetStaleLookData(app: FastifyInstance, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_FOR)
  const stale = await app.collections.users
    .find({ 'lookGreat.createdAt': { $lt: cutoff }, 'lookGreat.consentAt': { $lt: cutoff } }, { projection: { _id: 1 } })
    .toArray()
  let forgotten = 0

  for (const user of stale) {
    const recent = await app.collections.faceChecks.countDocuments({ userId: user._id, createdAt: { $gte: cutoff } })

    if (recent === 0) {
      await deleteLookData(app, user._id, { profile: true })
      forgotten += 1
    }
  }

  return forgotten
}

// Reads a restart cut short: failed, their photos deleted (she adds it again).
export async function failStaleFaceReads(app: FastifyInstance, now = new Date()) {
  const stuck = await app.collections.faceChecks
    .find({ status: 'processing', updatedAt: { $lt: new Date(now.getTime() - STALE_READ) } }, { projection: { photoKey: 1 } })
    .toArray()

  for (const check of stuck) {
    await storage.remove(check.photoKey).catch(() => undefined)
    await app.collections.faceChecks.updateOne(
      { _id: check._id },
      { $set: { status: 'failed', error: 'We could not read that photo. Try again in a moment.', photoKey: '', updatedAt: now } },
    )
  }

  return stuck.length
}

export function startLookGreat(app: FastifyInstance) {
  const run = () => {
    void failStaleFaceReads(app).catch((error: unknown) => app.log.error({ err: error }, 'Look Great stale reads crashed'))
    void forgetStaleLookData(app).catch((error: unknown) => app.log.error({ err: error }, 'Look Great retention crashed'))
    // Emails only where the lifecycle emails go out (production).
    if (env.LIFECYCLE_EMAILS) {
      void sendLookReminders(app).catch((error: unknown) => app.log.error({ err: error }, 'Look Great reminders crashed'))
    }
  }

  setTimeout(run, 90 * 1000).unref()
  setInterval(run, RUN_EVERY_MS).unref()
}
