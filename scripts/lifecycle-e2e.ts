// End-to-end check of the onboarding emails against the development
// database: a throwaway account walks through every stage, and the
// unsubscribe link and the account switch are exercised over HTTP. Nothing
// is sent (development only sends to EMAIL_DEV_ALLOWLIST), and everything
// the script created or touched is removed at the end.
//
//   corepack pnpm exec tsx scripts/lifecycle-e2e.ts
import assert from 'node:assert/strict'

import { ObjectId } from 'mongodb'

import { buildApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { sendDueLifecycleEmails, unsubscribeToken } from '../src/modules/lifecycle/service.js'

if (env.MONGODB_DB === 'avarobe') {
  throw new Error('Refusing to run against the production database.')
}

const HOUR = 60 * 60 * 1000
const app = await buildApp({ ensureMongoIndexes: false })
const users = app.collections.users
const userId = new ObjectId()
const email = `lifecycle-e2e+${Date.now()}@example.com`
const touched: { id: ObjectId; at: Date }[] = []

async function pass(now: Date) {
  const result = await sendDueLifecycleEmails(app, now)
  // Every account this pass wrote to, so the cleanup can undo it.
  const reached = await users.find({ lifecycleEmailLastAt: now }, { projection: { _id: 1 } }).toArray()
  touched.push(...reached.map((user) => ({ id: user._id, at: now })))
  const me = await users.findOne({ _id: userId })
  return { result, sent: me?.lifecycleEmails ?? {} }
}

try {
  const signup = new Date(Date.now() - HOUR)
  await users.insertOne({
    _id: userId,
    email,
    firstName: 'Nora',
    createdAt: signup,
    updatedAt: signup,
    lastLoginAt: null,
    emailVerifiedAt: null,
  })

  // 1. An hour after signing up: the welcome.
  let now = new Date()
  let step = await pass(now)
  assert.ok(step.sent.welcome, 'welcome should be claimed')
  console.log('1. welcome ✓', step.result)

  // 2. Same run again: nothing new (spacing and once-only).
  step = await pass(new Date(now.getTime() + 60 * 1000))
  assert.deepEqual(Object.keys(step.sent), ['welcome'])
  console.log('2. no repeat ✓')

  // 3. A day and a half later, still no avatar: the avatar reminder.
  now = new Date(signup.getTime() + 40 * HOUR)
  step = await pass(now)
  assert.ok(step.sent.avatar_nudge, 'avatar reminder should be claimed')
  console.log('3. avatar reminder ✓')

  // 4. Avatar ready, no looks, a day later: the looks reminder.
  const avatarId = new ObjectId()
  await app.collections.avatars.insertOne({
    _id: avatarId,
    userId,
    status: 'ready',
    error: null,
    selfieKey: 'e2e/selfie.jpg',
    avatarKey: 'e2e/avatar.png',
    body: { presentation: 'womenswear' } as never,
    colorAnalysis: {
      season: 'Warm Autumn',
      undertone: 'warm',
      contrast: 'medium',
      summary: '',
      bestColors: [
        { name: 'Olive', hex: '#5B5A2C' },
        { name: 'Rust', hex: '#A0482A' },
        { name: 'Deep teal', hex: '#1F5C5B' },
        { name: 'Locked color', hex: '#C9A227' },
      ],
      neutrals: [],
      avoidColors: [],
      metals: 'gold',
      confidence: 'high',
      photoNote: null,
    },
    consentVersion: 'e2e',
    consentAt: now,
    generations: 1,
    createdAt: now,
    updatedAt: now,
    readyAt: new Date(now.getTime() + HOUR),
  })
  now = new Date(now.getTime() + 24 * HOUR)
  step = await pass(now)
  assert.ok(step.sent.looks_nudge, 'looks reminder should be claimed')
  console.log('4. looks reminder ✓')

  // 5. Out of free looks: the Kit offer only with a postal address.
  await users.updateOne({ _id: userId }, { $set: { credits: 0 } })
  await app.collections.looks.insertOne({
    _id: new ObjectId(),
    userId,
    avatarId,
    batchId: new ObjectId(),
    occasion: { text: 'e2e', dressCode: 'Cocktail attire', summary: 'e2e' },
    plan: {} as never,
    status: 'ready',
    error: null,
    imageKey: null,
    collectionIds: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    readyAt: now,
  })
  now = new Date(now.getTime() + 20 * HOUR)
  step = await pass(now)
  assert.equal(Boolean(step.sent.kit_offer), Boolean(env.EMAIL_POSTAL_ADDRESS))
  console.log(`5. Kit offer ${env.EMAIL_POSTAL_ADDRESS ? 'sent' : 'held back (no EMAIL_POSTAL_ADDRESS)'} ✓`)

  // 6. Unsubscribe link, signed out; then resubscribe.
  const token = unsubscribeToken(userId)
  let response = await app.inject({ method: 'POST', url: '/api/v1/email/unsubscribe', payload: { token } })
  assert.equal(response.statusCode, 200)
  assert.ok((await users.findOne({ _id: userId }))?.emailTipsOptOutAt)
  response = await app.inject({ method: 'POST', url: '/api/v1/email/unsubscribe', payload: { token: `${token}x` } })
  assert.equal(response.statusCode, 400)
  response = await app.inject({ method: 'POST', url: '/api/v1/email/unsubscribe', payload: { token, unsubscribe: false } })
  assert.equal(response.json<{ subscribed: boolean }>().subscribed, true)
  console.log('6. unsubscribe link ✓ (tampered token rejected, resubscribe works)')

  // 7. The account switch.
  const jwt = app.jwt.sign({ sub: userId.toString(), email })
  response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/email',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { tips: false },
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json<{ user: { emailTips: boolean } }>().user.emailTips, false)
  // Opted out: nothing more goes out.
  await users.updateOne({ _id: userId }, { $unset: { 'lifecycleEmails.kit_offer': '' }, $set: { lifecycleEmailLastAt: null } })
  step = await pass(new Date(now.getTime() + HOUR))
  assert.equal(step.result.sent, 0)
  console.log('7. account switch ✓ (opted-out accounts get nothing)')

  console.log('\nAll lifecycle checks passed.')
} finally {
  await app.collections.looks.deleteMany({ userId })
  await app.collections.avatars.deleteMany({ userId })
  await users.deleteOne({ _id: userId })
  // Other development accounts a pass reached: undo exactly what it set.
  const others = new Map<string, number[]>()
  for (const entry of touched.filter((item) => !item.id.equals(userId))) {
    others.set(entry.id.toString(), [...(others.get(entry.id.toString()) ?? []), entry.at.getTime()])
  }
  for (const [id, times] of others) {
    const user = await users.findOne({ _id: new ObjectId(id) })
    const kinds = Object.entries(user?.lifecycleEmails ?? {})
      .filter(([, at]) => at instanceof Date && times.includes(at.getTime()))
      .map(([kind]) => `lifecycleEmails.${kind}`)
    await users.updateOne(
      { _id: new ObjectId(id) },
      { $unset: Object.fromEntries([...kinds, 'lifecycleEmailLastAt'].map((field) => [field, ''])) },
    )
  }
  console.log(`Cleaned up the test account${others.size > 0 ? ` and ${others.size} other dev account(s)` : ''}.`)
  await app.close()
}
