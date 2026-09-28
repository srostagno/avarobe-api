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
  looksNudgeEmail,
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
  'looks-nudge': looksNudgeEmail({ ...recipient, season: 'Warm Autumn', colors }),
  'upgrade-offer': upgradeOfferEmail(recipient),
  'upgrade-reminder': upgradeReminderEmail({ ...recipient, season: 'Warm Autumn', colors }),
  'upgrade-last-call': upgradeLastCallEmail(recipient),
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
