// Tries one cross-sell picture (lifecycle/assets.ts) end to end against the
// development database: a throwaway buyer made from Avarobe's fictional
// sample (design/ai-samples/her: selfie, avatar, a Soft Autumn read, never
// a real person), the generator run as the email loop runs it, and the email
// it leads written to .email-previews/xsell-try/ with the picture beside it.
// Nothing is sent. The buyer and everything made for her are removed at the
// end, unless --keep.
//
//   corepack pnpm exec tsx scripts/xsell-asset.ts xsell_magazine
//   corepack pnpm exec tsx scripts/xsell-asset.ts xsell_pro --locale pt-BR
//   corepack pnpm exec tsx scripts/xsell-asset.ts xsell_style --keep
//
// Kinds with a picture: xsell_style (a stylist plan and a look render),
// xsell_hair (a hair read and a portrait), xsell_pro and xsell_edit (a
// try-on of the newest Edit), xsell_magazine (a cover). Each one calls
// OpenAI: cents, and up to a couple of minutes.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { buildApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { regionForCountry } from '../src/modules/billing/pricing.js'
import { assetSlot, editOfIcon, editText, generateAsset, hasGenerator } from '../src/modules/lifecycle/assets.js'
import { CROSS_SELL_KINDS, latestEdit, type CrossSellKind } from '../src/modules/lifecycle/cross-sell.js'
import { crossSellContentFor } from '../src/modules/lifecycle/service.js'
import { crossSellEmail } from '../src/modules/lifecycle/templates.js'
import { EDITS } from '../src/modules/looks/edits.js'
import { deleteUserContent } from '../src/modules/me/content.js'
import type { AvatarDocument, UserDocument } from '../src/types/mongo.js'
import { isLocale, type Locale } from '../src/utils/locale.js'
import { withLocale } from '../src/utils/request-locale.js'
import { storage } from '../src/utils/storage.js'

if (env.MONGODB_DB === 'avarobe' || env.NODE_ENV === 'production') {
  throw new Error('Refusing to run against the production database.')
}

const args = process.argv.slice(2)
const kind = args[0] as CrossSellKind
const localeArg = args[args.indexOf('--locale') + 1]
const locale: Locale = args.includes('--locale') && isLocale(localeArg) ? localeArg : 'en'
const keep = args.includes('--keep')

if (!CROSS_SELL_KINDS.includes(kind) || !hasGenerator(kind)) {
  throw new Error(`Pick a kind with a picture: ${CROSS_SELL_KINDS.filter(hasGenerator).join(', ')}`)
}

const SAMPLE = path.resolve(process.cwd(), '../../design/ai-samples/her')
const OUT = path.join(process.cwd(), '.email-previews', 'xsell-try')
const app = await buildApp({ ensureMongoIndexes: false })
const userId = new ObjectId()
const now = new Date()
const selfieKey = `users/${userId.toString()}/selfie-sample.jpg`
const avatarKey = `users/${userId.toString()}/avatar-sample.webp`

try {
  // A Color Advisor buyer from Texas, in the language asked for.
  const user: UserDocument = {
    _id: userId,
    email: `xsell-try+${Date.now()}@example.com`,
    firstName: 'Clara',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    emailVerifiedAt: now,
    colorReportAt: now,
    paidAt: now,
    locale,
    location: { country: 'US', region: 'TX', source: 'edge', at: now },
  }
  const avatar: AvatarDocument = {
    _id: new ObjectId(),
    userId,
    status: 'ready',
    error: null,
    selfieKey,
    avatarKey,
    body: { heightCm: 165, weightKg: 62, build: 'curvy', presentation: 'womenswear' },
    colorAnalysis: {
      season: 'Soft Autumn',
      undertone: 'warm',
      contrast: 'medium',
      summary: 'Warm, soft and muted.',
      bestColors: [
        { name: 'Terracotta', hex: '#C46A4A' },
        { name: 'Olive', hex: '#6B6B3A' },
        { name: 'Teal', hex: '#2F6F6A' },
        { name: 'Camel', hex: '#B98B5E' },
      ],
      neutrals: [{ name: 'Warm taupe', hex: '#8C7A6B' }],
      avoidColors: [{ name: 'Icy pink', hex: '#F4D6E4' }],
      metals: 'gold',
      confidence: 'high',
      photoNote: null,
    },
    consentVersion: 'xsell-try',
    consentAt: now,
    generations: 1,
    createdAt: now,
    updatedAt: now,
    readyAt: now,
  }

  await storage.put(selfieKey, await sharp(await readFile(path.join(SAMPLE, 'selfie.png'))).jpeg({ quality: 90 }).toBuffer(), 'image/jpeg')
  await storage.put(avatarKey, await readFile(path.join(SAMPLE, 'avatar.webp')), 'image/webp')
  await app.collections.users.insertOne(user)
  await app.collections.avatars.insertOne(avatar)

  // The Edit the Pro email would show (the newest out), or the new-Edit
  // email's (the newest out too, here).
  const edits = EDITS.map((edit) => ({ id: edit.id, droppedAt: new Date(`${edit.droppedAt}T00:00:00Z`) }))
  const editId = kind === 'xsell_pro' || kind === 'xsell_edit' ? latestEdit(edits, now.getTime()) : null
  const started = Date.now()
  console.log(`Making the ${kind} picture for a fictional buyer (${locale})…`)

  const picture = await generateAsset(app, user, kind, editId)
  console.log(picture ? `Ready in ${Math.round((Date.now() - started) / 1000)} s: ${picture.key}` : 'Failed: the email would go with its stock picture.')

  await mkdir(OUT, { recursive: true })
  const name = `${kind}-${locale}`
  let heroUrl: string | null = null

  if (picture) {
    // Kept on the account as the loop keeps it, so the clean-up finds it.
    await app.collections.users.updateOne(
      { _id: userId },
      { $set: { [`xsellAssets.${assetSlot(kind, editId)}`]: { status: 'ready', key: picture.key, ref: picture.ref, startedAt: now, readyAt: new Date() } } },
    )
    await writeFile(path.join(OUT, `${name}.jpg`), await sharp(await storage.read(picture.key)).jpeg({ quality: 84 }).toBuffer())
    heroUrl = `${name}.jpg`
  }

  // What the email would say with it, the way sendCrossSell fills it in.
  const ref = picture?.ref && ObjectId.isValid(picture.ref) ? new ObjectId(picture.ref) : null
  const [look, hairstyle] = await Promise.all([
    ref ? app.collections.looks.findOne({ _id: ref }) : null,
    ref ? app.collections.hairstyles.findOne({ _id: ref }) : null,
  ])
  const edit = editOfIcon(look?.iconId) ?? EDITS.find((item) => item.id === editId) ?? null
  const content = crossSellContentFor(
    kind,
    user,
    avatar,
    {
      url: '#checkout',
      side: null,
      heroUrl,
      gift: kind === 'xsell_style' && look ? { url: '#gift-look', color: avatar.colorAnalysis!.bestColors[0]!.name } : null,
      cut: hairstyle?.name ?? null,
      edit: edit ? withLocale(locale, () => editText(edit)) : null,
    },
    now,
  )
  const email = crossSellEmail({
    ...content,
    firstName: user.firstName,
    email: user.email,
    unsubscribeUrl: '#unsubscribe',
    locale,
    region: regionForCountry(user.location?.country),
  })

  await writeFile(path.join(OUT, `${name}.html`), email.html)
  await writeFile(path.join(OUT, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}\n`)
  console.log(`\nSubject: ${email.subject}`)
  console.log(`Email: ${path.join(OUT, `${name}.html`)}`)

  if (look) {
    console.log(`Gift look ${look._id.toString()}: ${look.plan.title} (${look.status})`)
  }

  if (hairstyle) {
    console.log(`Ideal cut: ${hairstyle.name}`)
  }
} finally {
  if (keep) {
    console.log(`\nKept the fictional buyer ${userId.toString()} in ${env.MONGODB_DB}.`)
  } else {
    const { files } = await deleteUserContent(app, userId)
    await app.collections.users.deleteOne({ _id: userId })
    console.log(`\nRemoved the fictional buyer and ${files} file(s).`)
  }

  await app.close()
}
