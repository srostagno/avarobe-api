// Renders every onboarding email with sample data, to check the design.
//
//   corepack pnpm email:preview                                -> .email-previews/*.html (+ .txt)
//   corepack pnpm email:preview you@example.com                -> also sends them to that address
//   corepack pnpm email:preview you@example.com upgrade-offer  -> sends only the ones named
//
// Sending goes through the normal path, so in development the address has
// to be in EMAIL_DEV_ALLOWLIST.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  avatarNudgeEmail,
  crossSellEmail,
  looksNudgeEmail,
  priceDropEmail,
  trialEndingEmail,
  checkoutRescueEmail,
  trialStartedEmail,
  upgradeLastCallEmail,
  upgradeOfferEmail,
  upgradeReminderEmail,
  welcomeEmail,
} from '../src/modules/lifecycle/templates.js'
import { deliverEmail } from '../src/utils/email.js'

const OUT = path.join(process.cwd(), '.email-previews')
const recipient = {
  firstName: 'Nora',
  email: 'nora@example.com',
  unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=preview',
}
const colors = [
  { name: 'Olive', hex: '#5B5A2C' },
  { name: 'Rust', hex: '#A0482A' },
  { name: 'Deep teal', hex: '#1F5C5B' },
]

const emails = {
  'welcome-new': welcomeEmail({ ...recipient, stage: 'new', season: null }),
  'welcome-avatar': welcomeEmail({ ...recipient, stage: 'avatar', season: 'Warm Autumn' }),
  'welcome-looks': welcomeEmail({ ...recipient, stage: 'looks', season: 'Warm Autumn' }),
  'avatar-nudge': avatarNudgeEmail(recipient),
  'welcome-colors': welcomeEmail({ ...recipient, stage: 'new', season: null, focus: 'colors' }),
  'welcome-colors-read': welcomeEmail({ ...recipient, stage: 'new', season: 'Warm Autumn', focus: 'colors' }),
  'avatar-nudge-colors': avatarNudgeEmail({ ...recipient, focus: 'colors' }),
  'looks-nudge': looksNudgeEmail({ ...recipient, season: 'Warm Autumn', colors }),
  'upgrade-offer': upgradeOfferEmail(recipient),
  'upgrade-offer-colors': upgradeOfferEmail({ ...recipient, palette: { season: 'Warm Autumn', colors } }),
  // Colors first, an hour after the read: their own photo and a one-tap checkout link.
  'upgrade-offer-colors-first': upgradeOfferEmail({
    ...recipient,
    palette: {
      season: 'Warm Autumn',
      colors: [],
      heroUrl: 'https://www.avarobe.com/demo/colors/lucia.webp',
      url: 'https://www.avarobe.com/continue?token=preview',
    },
  }),
  'upgrade-reminder': upgradeReminderEmail({ ...recipient, season: 'Warm Autumn', colors }),
  'upgrade-last-call': upgradeLastCallEmail(recipient),
  'trial-started': trialStartedEmail({ ...recipient, trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }),
  'trial-ending': trialEndingEmail({ ...recipient, trialEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), looksLeft: 4 }),
  'checkout-rescue': checkoutRescueEmail({ ...recipient, product: 'color_report', url: 'https://www.avarobe.com/continue?token=preview' }),
  // PREVIEW_PHOTO_URL: a public image standing in for their locked drape photo
  // (a fictional face); without it, the email's fallback picture.
  'price-drop': priceDropEmail({
    ...recipient,
    season: 'Warm Autumn',
    colors,
    heroUrl: process.env.PREVIEW_PHOTO_URL ?? null,
    url: 'https://www.avarobe.com/continue?token=preview&utm_source=email&utm_medium=lifecycle&utm_campaign=price_drop',
  }),
  // Buyers: the next product they don't have (lifecycle/cross-sell.ts).
  ...crossSellPreviews(),
}

function crossSellPreviews() {
  const now = new Date()
  const until = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000)
  const url = 'https://www.avarobe.com/continue?token=preview'
  const owner = { ...recipient, season: 'Warm Autumn', colors, now, url, side: null, owns: { color: true, style: false } }

  return {
    'xsell-style-pair-price': crossSellEmail({ ...owner, kind: 'xsell_style', price: 691, regular: 790, until }),
    'xsell-style': crossSellEmail({ ...owner, kind: 'xsell_style', price: 790, regular: null, until: null }),
    'xsell-color': crossSellEmail({ ...owner, kind: 'xsell_color', price: 499, regular: null, until: null, colors: [], owns: { color: false, style: true } }),
    'xsell-last-call': crossSellEmail({ ...owner, kind: 'xsell_addon_last_call', price: 691, regular: 790, until: new Date(now.getTime() + 30 * 60 * 60 * 1000), side: 'style' }),
    'xsell-hair': crossSellEmail({ ...owner, kind: 'xsell_hair', price: 790, regular: null, until: null }),
    'xsell-magazine': crossSellEmail({ ...owner, kind: 'xsell_magazine', price: 990, regular: null, until: null }),
    'xsell-event': crossSellEmail({ ...owner, kind: 'xsell_event', price: 490, regular: null, until: null }),
    'xsell-guide': crossSellEmail({ ...owner, kind: 'xsell_guide', price: 1490, regular: null, until: null, url: 'https://www.avarobe.com/guide' }),
  }
}

const log = {
  info: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
} as unknown as Parameters<typeof deliverEmail>[0]['log']

await mkdir(OUT, { recursive: true })

for (const [name, email] of Object.entries(emails)) {
  await writeFile(path.join(OUT, `${name}.html`), email.html)
  await writeFile(path.join(OUT, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}\n`)
  console.log(`${name}: ${email.subject}`)
}

const sendTo = process.argv[2]
const only = process.argv.slice(3)

if (sendTo) {
  for (const [name, email] of Object.entries(emails)) {
    if (only.length > 0 && !only.includes(name)) {
      continue
    }

    const sent = await deliverEmail({ log, to: { email: sendTo, name: 'Preview' }, content: { ...email, subject: `[Preview] ${email.subject}` } })
    console.log(`${name}: ${sent ? 'sent' : 'not sent (address not in EMAIL_DEV_ALLOWLIST)'}`)
  }
}

console.log(`\nPreviews in ${OUT}`)
