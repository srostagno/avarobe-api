// Puts back a buyer's colors and her Color Advisor report, as they were
// written, from a saved copy of the database's log of changes to her avatar
// (the oplog), after a re-read wiped them (11-Oct-2026, before reads kept
// what people had). Colors and report go back in one update, so no "you
// haven't opened your report" email goes out for colors alone; the drape
// test, the free preview and the boards are drawn again from her current
// selfie when she opens the report. A dry run by default: it only reads, and
// prints no email address and no report text.
//
//   corepack pnpm exec tsx scripts/restore-colors.ts --avatar <id> --from <oplog.json>
//   corepack pnpm exec tsx scripts/restore-colors.ts --avatar <id> --from <oplog.json> --before 2026-10-11T11:51:15Z
//   corepack pnpm exec tsx scripts/restore-colors.ts --avatar <id> --from <oplog.json> --apply              -> development database
//   corepack pnpm exec tsx scripts/restore-colors.ts --avatar <id> --from <oplog.json> --apply --confirm-production
//
// --before: restore what she had before this moment (default: the first
// entry that set her colors back to null). Writing to the production
// database (MONGODB_DB=avarobe) needs --confirm-production, and the founder's
// OK for that one restore; it's refused before connecting otherwise.
import fs from 'node:fs'

import { BSON, MongoClient, ObjectId } from 'mongodb'

import { env } from '../src/config/env.js'
import { restoreBlockers, restorePlan, restoreUpdate, type OplogEntry } from '../src/modules/avatar/restore.js'
import type { AvatarDocument, PurchaseDocument, UserDocument } from '../src/types/mongo.js'

const args = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? (args[index + 1] ?? null) : null
}
const avatarArg = option('--avatar')
const fromArg = option('--from')
const beforeArg = option('--before')
const apply = args.includes('--apply')

if (!avatarArg || !ObjectId.isValid(avatarArg) || !fromArg) {
  throw new Error('Usage: --avatar <id> --from <oplog.json> [--before <ISO>] [--apply] [--confirm-production]')
}

if (apply && env.MONGODB_DB === 'avarobe' && !args.includes('--confirm-production')) {
  throw new Error('Refusing to write to the production database without --confirm-production.')
}

const before = beforeArg ? new Date(beforeArg) : undefined

if (before && Number.isNaN(before.getTime())) {
  throw new Error('--before must be an ISO date.')
}

const entries = BSON.EJSON.parse(fs.readFileSync(fromArg, 'utf8'), { relaxed: false }) as OplogEntry[]
const plan = restorePlan(entries, avatarArg, before)

if ('error' in plan) {
  console.error(plan.error)
  process.exit(1)
}

const file = (key: string | null | undefined) => (key ? key.split('/').pop() : 'none')
const client = await MongoClient.connect(env.MONGODB_URI)

try {
  const db = client.db(env.MONGODB_DB)
  const avatar = await db.collection<AvatarDocument>('avatars').findOne({ _id: new ObjectId(avatarArg) })

  if (!avatar) {
    console.error(`${env.MONGODB_DB}: no avatar ${avatarArg}.`)
    process.exit(1)
  }

  const [user, purchases] = await Promise.all([
    db.collection<UserDocument>('users').findOne({ _id: avatar.userId }, { projection: { locale: 1, colorReportAt: 1, colorMirrorAt: 1 } }),
    db
      .collection<PurchaseDocument>('purchases')
      .find({ userId: avatar.userId }, { projection: { product: 1, createdAt: 1, refundedAt: 1 } })
      .sort({ createdAt: 1 })
      .toArray(),
  ])
  const notify = avatar.colorsNotify

  console.log(`${env.MONGODB_DB}: avatar ${avatar._id.toString()}, user ${avatar.userId.toString()}, locale ${user?.locale ?? 'en'}`)

  for (const purchase of purchases) {
    console.log(`  purchase ${purchase.product} ${purchase.createdAt.toISOString()}${purchase.refundedAt ? ` REFUNDED ${purchase.refundedAt.toISOString()}` : ', not refunded'}`)
  }

  console.log(
    `now: status ${avatar.status}, selfie ${file(avatar.selfieKey)}, updatedAt ${avatar.updatedAt.toISOString()}, ` +
      `colors ${avatar.colorAnalysis ? avatar.colorAnalysis.season : 'null'}, report ${avatar.colorReport ? 'present' : 'null'}, ` +
      `notify ${notify && !notify.sentAt && !notify.gaveUpAt ? 'pending' : 'none'}`,
  )
  console.log(
    `restores: ${plan.colorAnalysis.season} (colors written ${plan.colorsWrittenAt.toISOString()}, colorsAt ${plan.colorsAt.toISOString()}); ` +
      `report "${plan.colorReport.data.seasonLean}" created ${plan.colorReport.createdAt.toISOString()}; ` +
      `read from ${file(plan.firstSelfieKey)}; wiped at ${plan.before.toISOString()}`,
  )

  const blockers = restoreBlockers(avatar, user, purchases)

  if (blockers.length > 0) {
    console.error(`Stopped: ${blockers.join('; ')}.`)
    process.exit(1)
  }

  if (!apply) {
    console.log('Dry run: nothing written. Add --apply to restore (production also needs --confirm-production).')
  } else {
    const update = restoreUpdate(avatar, plan, new Date())
    const result = await db.collection<AvatarDocument>('avatars').updateOne(update.filter, { $set: update.set })

    console.log(`matched ${result.matchedCount}, modified ${result.modifiedCount}`)

    if (result.matchedCount === 0) {
      console.error('Nothing matched: the avatar changed since it was read. Run the dry run again.')
      process.exitCode = 1
    }
  }
} finally {
  await client.close()
}
