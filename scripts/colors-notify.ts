// The people with an account whose color read failed in an outage (OpenAI
// out of credits on 11-Oct-2026, 8:40 to 10:45 Chile), and, with --apply,
// a "tell me when my colors are ready" for each: the scheduler
// (modules/avatar/retry.ts) reads their selfie again within minutes and
// emails them a sign-in link to their colors (colors_ready), in their
// language. Guests (no real email) are left out. A dry run by default:
// it only reads.
//
//   corepack pnpm exec tsx scripts/colors-notify.ts                     -> who it would be (the 11-Oct window)
//   corepack pnpm exec tsx scripts/colors-notify.ts --from 2026-10-11T11:40:00Z --to 2026-10-11T13:45:00Z
//   corepack pnpm exec tsx scripts/colors-notify.ts --apply             -> asks for them (development database)
//   corepack pnpm exec tsx scripts/colors-notify.ts --apply --confirm-production
//
// Writing to the production database (MONGODB_DB=avarobe) needs
// --confirm-production; it's refused before connecting otherwise.
import { MongoClient } from 'mongodb'

import { env } from '../src/config/env.js'
import type { AnalyticsEventDocument, AvatarDocument, ColorsNotify, UserDocument } from '../src/types/mongo.js'
import { isGuestEmail } from '../src/utils/guests.js'
import { storage } from '../src/utils/storage.js'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback
}
const apply = args.includes('--apply')
const from = new Date(option('--from', '2026-10-11T11:40:00Z'))
const to = new Date(option('--to', '2026-10-11T13:45:00Z'))

if (apply && env.MONGODB_DB === 'avarobe' && !args.includes('--confirm-production')) {
  throw new Error('Refusing to write to the production database without --confirm-production.')
}

if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
  throw new Error('--from and --to must be ISO dates, --from first.')
}

const masked = (email: string) => {
  const [name = '', domain = ''] = email.split('@')
  return `${name.slice(0, 1)}***@${domain}`
}

const client = await MongoClient.connect(env.MONGODB_URI)

try {
  const db = client.db(env.MONGODB_DB)
  const failedIds = (
    await db
      .collection<AnalyticsEventDocument>('analytics_events')
      .distinct('userId', { name: 'colors_failed', origin: 'server', at: { $gte: from, $lte: to } })
  ).filter((id): id is NonNullable<typeof id> => Boolean(id))
  const users = (
    await db
      .collection<UserDocument>('users')
      .find({ _id: { $in: failedIds }, guest: { $ne: true } }, { projection: { email: 1, locale: 1 } })
      .toArray()
  ).filter((user) => !isGuestEmail(user.email))
  const avatars = await db
    .collection<AvatarDocument>('avatars')
    .find(
      {
        userId: { $in: users.map((user) => user._id) },
        status: 'failed',
        colorAnalysis: null,
        avatarKey: null,
        selfieKey: { $exists: true, $ne: '' },
      },
      { projection: { userId: 1, selfieKey: 1, updatedAt: 1, colorsNotify: 1 } },
    )
    .toArray()
  const userBy = new Map(users.map((user) => [user._id.toString(), user]))

  console.log(
    `${env.MONGODB_DB}: ${failedIds.length} people failed a color read between ${from.toISOString()} and ${to.toISOString()}; ` +
      `${users.length} have an account; ${avatars.length} still without colors.`,
  )

  for (const avatar of avatars) {
    const user = userBy.get(avatar.userId.toString())!
    // The scheduler reads the selfie again: is it still there? (Only
    // answerable where the files are: S3 on the server.)
    const stored = await storage.read(avatar.selfieKey).then(
      () => true,
      () => false,
    )
    const pending = avatar.colorsNotify && !avatar.colorsNotify.sentAt && !avatar.colorsNotify.gaveUpAt
    console.log(
      [
        avatar.userId.toString(),
        user.locale ?? 'en',
        masked(user.email),
        `failed ${avatar.updatedAt.toISOString()}`,
        stored ? 'selfie stored' : `selfie not found (${env.STORAGE_DRIVER} storage)`,
        pending ? 'already waiting' : '',
      ]
        .filter(Boolean)
        .join('  '),
    )
  }

  if (!apply) {
    console.log('Dry run: nothing written. Add --apply to have their colors read and emailed.')
  } else {
    const notify: ColorsNotify = { requestedAt: new Date(), attempts: 0, lastTriedAt: null, sentAt: null, gaveUpAt: null, via: 'script' }
    const result = await db
      .collection<AvatarDocument>('avatars')
      .updateMany(
        { _id: { $in: avatars.map((avatar) => avatar._id) }, status: 'failed', colorAnalysis: null, avatarKey: null },
        { $set: { colorsNotify: notify } },
      )
    console.log(`Asked for ${result.modifiedCount}: the scheduler reads them and sends colors_ready within about 5 minutes.`)
  }
} finally {
  await client.close()
}
