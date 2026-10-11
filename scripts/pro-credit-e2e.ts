// End-to-end check of the Pro credit in the cross-sell emails against the
// development database: throwaway buyers in Brazil walk through their first
// cross-sells. A Color Advisor buyer gets the credit block in the Style
// Advisor email (day 1) and the Hair & Grooming one (day 3), then the Pro
// email sells annual at R$ 85,00 (day 10), and the next one carries no
// block (the pair price's last call, a third email, with less than a day of
// credit left). Someone on Pro
// never gets it, and the three advisors' buyers are left out
// (PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE). Under the day-1 and day-3 blocks,
// the link to the web's Pro tour goes to her (womenswear, colors read), not
// to a menswear buyer nor to a Style Advisor buyer without the Color
// Advisor (PRO_TOUR_EMAIL_LINK). Nothing is sent (no address is
// allowed in development here), no picture is made, only these buyers are
// looked at, and everything the script created is removed at the end.
//
//   corepack pnpm exec tsx scripts/pro-credit-e2e.ts
import assert from 'node:assert/strict'

import { ObjectId } from 'mongodb'

import { buildApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { sendCrossSells } from '../src/modules/lifecycle/service.js'
import type { AvatarDocument, Presentation, PurchaseProduct, UserDocument } from '../src/types/mongo.js'

if (env.MONGODB_DB === 'avarobe') {
  throw new Error('Refusing to run against the production database.')
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

env.EMAIL_POSTAL_ADDRESS ??= '123 Sample Street, Springfield, USA'
env.EMAIL_DEV_ALLOWLIST = []
env.XSELL_PERSONAL_IMAGES = false
env.PRO_CREDIT_EMAIL_SKIP_ADVISORS_BUNDLE = true
env.PRO_TOUR_EMAIL_LINK = true

const app = await buildApp({ ensureMongoIndexes: false })
const users: ObjectId[] = []
// What each send logged: its kind, product and whether it carried the block.
const sends: { userId: string; kind: string; product: string; proCredit: boolean }[] = []
// Whether it linked the Pro tour, by `${userId}:${kind}`.
const tours = new Map<string, boolean>()
const info = app.log.info.bind(app.log)

app.log.info = ((obj: unknown, msg?: string) => {
  if (msg === 'Cross-sell email' && obj && typeof obj === 'object') {
    const line = obj as { userId: string; kind: string; product: string; proCredit: boolean; proTour?: boolean }
    sends.push({ userId: line.userId, kind: line.kind, product: line.product, proCredit: line.proCredit })
    tours.set(`${line.userId}:${line.kind}`, line.proTour === true)
  }

  return info(obj as object, msg)
}) as typeof app.log.info

// Day 1 at 14:00 in São Paulo (17:00 UTC), and the purchase 21 hours before.
const day1 = new Date(Date.UTC(2026, 9, 20, 17, 0, 0))
const boughtAt = new Date(day1.getTime() - 21 * HOUR)

async function buyer(name: string, products: PurchaseProduct[], fields: Partial<UserDocument> = {}) {
  const userId = new ObjectId()
  users.push(userId)
  await app.collections.users.insertOne({
    _id: userId,
    email: `pro-credit-e2e+${name}-${Date.now()}@example.com`,
    firstName: 'Nora',
    createdAt: new Date(boughtAt.getTime() - DAY),
    updatedAt: boughtAt,
    lastLoginAt: null,
    emailVerifiedAt: boughtAt,
    locale: 'pt-BR',
    location: { country: 'BR', region: null, source: 'edge', at: boughtAt },
    credits: 0,
    paidAt: boughtAt,
    ...fields,
  })

  for (const product of products) {
    await app.collections.purchases.insertOne({
      _id: new ObjectId(),
      userId,
      product,
      stripeSessionId: `cs_e2e_${new ObjectId().toString()}`,
      stripePaymentIntentId: null,
      amountTotal: product === 'advisors_bundle' ? 4990 : 1490,
      currency: 'brl',
      credits: 0,
      createdAt: boughtAt,
    })
  }

  return userId
}

// Her colors read, and how she shops.
async function colorsRead(userId: ObjectId, presentation: Presentation) {
  await app.collections.avatars.insertOne({
    _id: new ObjectId(),
    userId,
    status: 'ready',
    avatarKey: null,
    body: null,
    presentation,
    colorAnalysis: {
      season: 'Light Spring',
      undertone: 'warm',
      contrast: 'medium',
      summary: 'Warm and light.',
      bestColors: [{ name: 'Warm Coral', hex: '#F08066' }],
      neutrals: [],
      avoidColors: [{ name: 'Black', hex: '#000000' }],
      metals: 'gold',
      confidence: 'high',
      photoNote: null,
    },
    createdAt: boughtAt,
    updatedAt: boughtAt,
  } as unknown as AvatarDocument)
}

const run = async (at: Date) => {
  sends.length = 0
  await sendCrossSells(app, at, users)
  return [...sends]
}

try {
  const nora = await buyer('color', ['color_report'], { colorReportAt: boughtAt })
  const onPro = await buyer('pro', ['color_report'], {
    colorReportAt: boughtAt,
    pro: { subscriptionId: 'sub_e2e', customerId: null, status: 'active', interval: 'month', periodEnd: new Date(day1.getTime() + 20 * DAY), cancelAtPeriodEnd: false },
  })
  const bundle = await buyer('bundle', ['advisors_bundle'], { colorReportAt: boughtAt, styleReportAt: boughtAt, hairAdvisorAt: boughtAt, colorMirrorAt: boughtAt })
  const him = await buyer('menswear', ['color_report'], { colorReportAt: boughtAt })
  const styleOnly = await buyer('style', ['style_report'], { styleReportAt: boughtAt })
  await colorsRead(nora, 'womenswear')
  await colorsRead(him, 'menswear')
  await colorsRead(styleOnly, 'womenswear')
  const of = (list: typeof sends, userId: ObjectId) => list.find((send) => send.userId === userId.toString())
  const tour = (userId: ObjectId, kind: string) => tours.get(`${userId.toString()}:${kind}`)

  // Day 1: the Style Advisor email, with the block and the tour under it.
  let sent = await run(day1)
  assert.deepEqual(of(sent, nora), { userId: nora.toString(), kind: 'xsell_style', product: 'style_addon', proCredit: true })
  assert.equal(tour(nora, 'xsell_style'), true, 'the tour under her block')
  assert.equal(of(sent, onPro), undefined, 'Pro: nothing to sell on day 1')
  assert.equal(of(sent, him)?.proCredit, true)
  assert.equal(tour(him, 'xsell_style'), false, 'menswear: the block, no tour')
  assert.deepEqual(of(sent, styleOnly), { userId: styleOnly.toString(), kind: 'xsell_color', product: 'color_addon', proCredit: true })
  assert.equal(tour(styleOnly, 'xsell_color'), false, 'no Color Advisor: no tour')
  console.log('1. day 1: xsell_style with the Pro credit block and the tour link (not for menswear nor without the Color Advisor) ✓')

  // Day 3: Hair & Grooming, with the block (the second cross-sell).
  const day3 = new Date(day1.getTime() + 2 * DAY)
  sent = await run(day3)
  assert.deepEqual(of(sent, nora), { userId: nora.toString(), kind: 'xsell_hair', product: 'hair_advisor', proCredit: true })
  assert.equal(tour(nora, 'xsell_hair'), true)
  console.log('2. day 3: xsell_hair with the Pro credit block and the tour link ✓')

  // Day 10: the Pro email sells annual with the credit, and the bundle's
  // buyer gets Pro monthly (no credit for them).
  const day10 = new Date(day3.getTime() + 7 * DAY)
  sent = await run(day10)
  assert.deepEqual(of(sent, nora), { userId: nora.toString(), kind: 'xsell_pro', product: 'pro_annual', proCredit: false })
  assert.equal(tour(nora, 'xsell_pro'), false, 'the Pro email: no tour link')
  assert.deepEqual(of(sent, bundle), { userId: bundle.toString(), kind: 'xsell_pro', product: 'pro_monthly', proCredit: false })
  assert.equal(of(sent, onPro)?.proCredit, false, 'Pro: never the block')
  console.log('3. day 10: xsell_pro offers annual with the credit; the bundle buyer, monthly ✓')

  // Day 14 (4 days on, the credit and the pair price end in 3 hours): the
  // pair price's last call, with no block.
  const day14 = new Date(day10.getTime() + 4 * DAY)
  sent = await run(day14)
  assert.deepEqual(of(sent, nora), { userId: nora.toString(), kind: 'xsell_addon_last_call', product: 'style_addon', proCredit: false })
  console.log('4. day 14: the pair price’s last call, no block ✓')

  // One email per step, no extra ones.
  const claimed = await app.collections.users.findOne({ _id: nora }, { projection: { lifecycleEmails: 1 } })
  assert.deepEqual(Object.keys(claimed?.lifecycleEmails ?? {}).sort(), ['xsell_addon_last_call', 'xsell_hair', 'xsell_pro', 'xsell_style'])
  console.log('5. spacing kept: one email per step ✓')
} finally {
  await Promise.all([
    app.collections.users.deleteMany({ _id: { $in: users } }),
    app.collections.avatars.deleteMany({ userId: { $in: users } }),
    app.collections.purchases.deleteMany({ userId: { $in: users } }),
    app.collections.emailSends.deleteMany({ userId: { $in: users } }),
    app.collections.analyticsEvents.deleteMany({ userId: { $in: users } }),
  ])
  await app.close()
  console.log('cleaned up')
}
