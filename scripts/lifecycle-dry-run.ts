// Which onboarding email each recent account would get right now, without
// sending anything. Read-only; run it before changing the schedule.
//
//   corepack pnpm exec tsx scripts/lifecycle-dry-run.ts
//
// Set EMAIL_POSTAL_ADDRESS as in production, or the offers never show.
import { MongoClient, type ObjectId } from 'mongodb'

import { env } from '../src/config/env.js'
import { LIFECYCLE_RULES, pickLifecycleEmail } from '../src/modules/lifecycle/schedule.js'
import { stateFor } from '../src/modules/lifecycle/service.js'
import type { AvatarDocument, UserDocument } from '../src/types/mongo.js'

const now = new Date()
const client = await MongoClient.connect(env.MONGODB_URI)

try {
  const db = client.db(env.MONGODB_DB)
  const users = await db
    .collection<UserDocument>('users')
    .find({ createdAt: { $gte: new Date(now.getTime() - LIFECYCLE_RULES.horizon) }, emailTipsOptOutAt: null })
    .toArray()
  const ids = users.map((user) => user._id)
  const avatars = await db.collection<AvatarDocument>('avatars').find({ userId: { $in: ids } }).toArray()
  const looks = await db
    .collection('looks')
    .aggregate<{ _id: ObjectId; count: number; lastAt: Date | null }>([
      { $match: { userId: { $in: ids }, status: { $ne: 'locked' } } },
      { $group: { _id: '$userId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
    ])
    .toArray()
  const avatarBy = new Map(avatars.map((avatar) => [avatar.userId.toString(), avatar]))
  const looksBy = new Map(looks.map((stat) => [stat._id.toString(), { count: stat.count, lastAt: stat.lastAt }]))
  const due: Record<string, number> = {}

  for (const user of users) {
    const id = user._id.toString()
    const kind = pickLifecycleEmail(stateFor(user, avatarBy.get(id), looksBy.get(id) ?? { count: 0, lastAt: null }), now)
    due[kind ?? 'nothing'] = (due[kind ?? 'nothing'] ?? 0) + 1
  }

  console.log(`${users.length} accounts in the last ${LIFECYCLE_RULES.horizon / 86_400_000} days; due now:`, due)
} finally {
  await client.close()
}
