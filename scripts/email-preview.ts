// Renders every email with sample data, to check the design and the words,
// in English and in the other languages (with that market's prices).
//
//   corepack pnpm email:preview                                -> .email-previews/*.html (+ .txt), pt-BR/ and es/ beside
//   corepack pnpm email:preview you@example.com                -> also sends them to that address
//   corepack pnpm email:preview you@example.com upgrade-offer pt-BR/upgrade-offer  -> sends only the ones named
//
// Sending goes through the normal path, so in development the address has
// to be in EMAIL_DEV_ALLOWLIST.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ObjectId } from 'mongodb'

import { REGION_CURRENCY, regionalAmount, toUsdCents, type PricingRegion } from '../src/modules/billing/pricing.js'
import { decisionEmailFor, founderEmail, receivedEmailFor, reminderDigest } from '../src/modules/billing/refund-notify.js'
import type { PurchaseProduct, RefundRejectCode, RefundRequestDocument } from '../src/types/mongo.js'
import { editText } from '../src/modules/lifecycle/assets.js'
import { shortProductName } from '../src/modules/lifecycle/checkout-link.js'
import { EDITS } from '../src/modules/looks/edits.js'
import {
  avatarNudgeEmail,
  colorsReadyEmail,
  crossSellEmail,
  looksNudgeEmail,
  magazineReadyEmail,
  outfitGuideEmail,
  priceDropEmail,
  trialEndingEmail,
  checkoutLinkEmail,
  checkoutRescueEmail,
  trialStartedEmail,
  upgradeLastCallEmail,
  upgradeOfferEmail,
  upgradeReminderEmail,
  welcomeEmail,
  type EmailContent,
} from '../src/modules/lifecycle/templates.js'
import {
  continueInBrowserEmail,
  deliverEmail,
  passkeyAddedEmail,
  passwordChangedEmail,
  passwordResetEmail,
  savedEmail,
  signInLinkEmail,
  verificationEmail,
} from '../src/utils/email.js'
import type { Locale } from '../src/utils/locale.js'
import { withLocale } from '../src/utils/request-locale.js'

const OUT = path.join(process.cwd(), '.email-previews')
const colors = [
  { name: 'Olive', hex: '#5B5A2C' },
  { name: 'Rust', hex: '#A0482A' },
  { name: 'Deep teal', hex: '#1F5C5B' },
]

// Each language with the market it's mostly read in.
const MARKETS: { locale: Locale; region: PricingRegion }[] = [
  { locale: 'en', region: 'us' },
  { locale: 'pt-BR', region: 'br' },
  { locale: 'es', region: 'mx' },
]

function emailsFor(locale: Locale, region: PricingRegion): Record<string, EmailContent> {
  const recipient = {
    firstName: 'Nora',
    email: 'nora@example.com',
    unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=preview',
    locale,
    region,
  }
  const link = 'https://www.avarobe.com/continue?token=preview'

  return {
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
      palette: { season: 'Warm Autumn', colors: [], heroUrl: 'https://www.avarobe.com/demo/colors/lucia.webp', url: link },
    }),
    'upgrade-reminder': upgradeReminderEmail({ ...recipient, season: 'Warm Autumn', colors }),
    'upgrade-last-call': upgradeLastCallEmail(recipient),
    // Colors first: the reminder and the last call on their own photo too.
    'upgrade-reminder-colors-first': upgradeReminderEmail({
      ...recipient,
      season: 'Warm Autumn',
      colors: [],
      photo: { heroUrl: 'https://www.avarobe.com/demo/colors/lucia.webp', url: link },
    }),
    'upgrade-last-call-colors-first': upgradeLastCallEmail({
      ...recipient,
      photo: { heroUrl: 'https://www.avarobe.com/demo/colors/lucia.webp', url: link },
    }),
    'trial-started': trialStartedEmail({ ...recipient, trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }),
    'trial-ending': trialEndingEmail({ ...recipient, trialEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), looksLeft: 4 }),
    'checkout-rescue': checkoutRescueEmail({ ...recipient, product: 'color_report', url: link }),
    // Their read failed because the AI was busy (or out of credits), done
    // later: a sign-in link to their colors (avatar/retry.ts). Also the
    // email for the people the 11-Oct-2026 outage left without theirs.
    'colors-ready': colorsReadyEmail({ ...recipient, season: 'Warm Autumn', url: link }),
    // Tapped Buy inside Instagram on an iPhone (lifecycle/checkout-link.ts).
    'checkout-link': checkoutLinkEmail({
      ...recipient,
      product: 'color_report',
      name: shortProductName('color_report', locale),
      url: link,
      wallet: 'Apple Pay',
      app: 'Instagram',
    }),
    // PREVIEW_PHOTO_URL: a public image standing in for their locked drape photo
    // (a fictional face); without it, the email's fallback picture.
    'price-drop': priceDropEmail({
      ...recipient,
      season: 'Warm Autumn',
      colors,
      heroUrl: process.env.PREVIEW_PHOTO_URL ?? null,
      url: `${link}&utm_source=email&utm_medium=lifecycle&utm_campaign=price_drop`,
    }),
    // Buyers: the next product they don't have (lifecycle/cross-sell.ts),
    // with their own picture (-photo) and with the stock one.
    ...crossSellPreviews(recipient, region),
    // Purchase deliveries.
    guide: outfitGuideEmail({
      email: recipient.email,
      firstName: 'Nora',
      downloadUrl: 'https://api.avarobe.com/api/v1/guide/download/preview',
      refundUrl: 'https://www.avarobe.com/guide/thanks?refund=preview',
      locale,
    }),
    magazine: magazineReadyEmail({ email: recipient.email, firstName: 'Nora', url: 'https://www.avarobe.com/studio/magazine/preview', locale }),
    // Account emails (utils/email.ts).
    'auth-verify': verificationEmail({ firstName: 'Nora', url: link, forPasskey: false, locale }),
    'auth-verify-passkey': verificationEmail({ firstName: 'Nora', url: link, forPasskey: true, locale }),
    'auth-saved': savedEmail({ firstName: 'Nora', url: link, locale }),
    // Saved from their colors: their season and drape test.
    'auth-saved-colors': savedEmail({
      firstName: '',
      url: link,
      locale,
      colors: { season: 'Warm Autumn', drapeUrl: 'https://www.avarobe.com/demo/colors/lucia.webp' },
    }),
    'auth-sign-in': signInLinkEmail({ firstName: 'Nora', url: link, locale }),
    'auth-continue': continueInBrowserEmail({ firstName: 'Nora', url: link, locale }),
    'auth-reset': passwordResetEmail({ firstName: 'Nora', url: link, locale }),
    'auth-changed': passwordChangedEmail({ firstName: 'Nora', resetUrl: link, locale }),
    'auth-passkey': passkeyAddedEmail({ firstName: 'Nora', deviceName: 'iPhone', accountUrl: link, locale }),
    // Refund requests (billing/refund-requests.ts): received, approved, and
    // rejected with each reason.
    ...refundPreviews(locale, region),
  }
}

// A sample refund request, as billing/refund-requests.ts stores it.
function sampleRequest(fields: Partial<RefundRequestDocument> & { region?: PricingRegion } = {}): RefundRequestDocument {
  const { region = 'us', ...rest } = fields
  const currency = REGION_CURRENCY[region]
  const product: PurchaseProduct = rest.product ?? 'color_report'
  const amount = regionalAmount(product, region)
  const paidAt = new Date(Date.now() - 26 * 60 * 60 * 1000)
  const purchaseId = new ObjectId()

  return {
    _id: new ObjectId(),
    ref: 'R-7F3K2Q',
    source: 'account',
    userId: new ObjectId(),
    guideOrderId: null,
    purchaseId,
    product,
    covers: [{ purchaseId, guideOrderId: null, product, amount, currency, paidAt, stripePaymentIntentId: 'pi_preview', stripeInvoiceId: null }],
    amount,
    currency,
    amountUsd: toUsdCents(amount, currency),
    purchasedAt: paidAt,
    email: 'nora@example.com',
    emailHash: 'preview',
    firstName: 'Nora',
    locale: 'en',
    targetKey: 'p:preview',
    market: { currency, region, signupCountry: 'US', requestCountry: 'US', card: { brand: 'visa', last4: '4242', country: 'US', fingerprint: 'fp' }, disputed: false },
    within7d: true,
    statutory: null,
    oldGuarantee: false,
    reasonCategory: 'not_accurate',
    explanation:
      'It says Soft Autumn, but warm colors wash out my face and an in-person analysis gave me Winter.\nI opened the report once and tried the drape test in daylight.',
    attachment: null,
    usage: {
      at: new Date(),
      hoursSincePurchase: 26,
      colorReportOpenedAt: new Date(paidAt.getTime() + 10 * 60 * 1000),
      styleReportOpenedAt: null,
      hairReadAt: null,
      drapeAt: new Date(paidAt.getTime() + 15 * 60 * 1000),
      looksMade: 1,
      looksWithCredit: 0,
      creditsGiven: 0,
      creditsLeft: 1,
      hairstylesMade: 0,
      eventsStyled: 0,
      magazinesMade: 0,
      checksMade: 2,
      avatarRuns: null,
      guideDownloads: null,
      guideLastDownloadAt: null,
      lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
      events: { page_view: 14, report_opened: 1 },
    },
    history: {
      refundsBefore: 0,
      requestsBefore: 0,
      approvedBefore: 0,
      rejectedBefore: 0,
      openRequests: 0,
      purchases: 1,
      paidUsd: 499,
      accountCreatedAt: new Date(paidAt.getTime() - 20 * 60 * 1000),
      channel: 'meta',
      campaign: 'launch_us',
      cardSeenOn: 0,
    },
    flags: ['used'],
    proPause: null,
    status: 'pending',
    decision: null,
    attempts: [],
    refund: null,
    internalNote: null,
    emails: { founderAt: null, receivedAt: null, decisionAt: null, reminderAt: null },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
  }
}

const REJECT_CODES: RefundRejectCode[] = ['resolved', 'works_as_described', 'used', 'outside_policy', 'duplicate', 'withdrawn', 'other']

function refundPreviews(locale: Locale, region: PricingRegion): Record<string, EmailContent> {
  const base = sampleRequest({ locale, region })
  const rejected = (code: RefundRejectCode) =>
    decisionEmailFor(
      {
        ...base,
        status: 'rejected',
        decision: {
          outcome: 'rejected',
          by: 'admin',
          adminId: null,
          adminEmail: null,
          at: new Date(),
          code,
          note: code === 'other' || code === 'resolved' ? 'We fixed the report on your account: it opens now on every phone.' : null,
          cdcOverride: false,
        },
      },
      { proRenewsAt: null },
    )

  return {
    'refund-received': receivedEmailFor(base),
    'refund-received-pro': receivedEmailFor({
      ...sampleRequest({ locale, region, product: 'pro_monthly' }),
      proPause: { subscriptionId: 'sub_preview', wasCancelAtPeriodEnd: false, at: new Date(), restoredAt: null },
    }),
    'refund-received-withdrawal': receivedEmailFor({ ...base, statutory: { law: 'br_cdc_49', until: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000) } }),
    'refund-approved': decisionEmailFor(
      { ...base, status: 'refunded', refund: { stripeRefundIds: ['re_preview'], amount: base.amount, via: 'admin', at: new Date(), partial: false } },
      { proRenewsAt: null },
    ),
    'refund-approved-guide': decisionEmailFor(
      {
        ...sampleRequest({ locale, region, product: 'outfit_guide' }),
        status: 'refunded',
        refund: { stripeRefundIds: ['re_preview'], amount: regionalAmount('outfit_guide', region), via: 'admin', at: new Date(), partial: false },
      },
      { proRenewsAt: null },
    ),
    ...Object.fromEntries(REJECT_CODES.map((code) => [`refund-rejected-${code.replace(/_/g, '-')}`, rejected(code)])),
    'refund-rejected-pro': decisionEmailFor(
      {
        ...sampleRequest({ locale, region, product: 'pro_monthly' }),
        status: 'rejected',
        decision: { outcome: 'rejected', by: 'admin', adminId: null, adminEmail: null, at: new Date(), code: 'used', note: null, cdcOverride: false },
      },
      { proRenewsAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000) },
    ),
  }
}

// The founder's emails (Spanish, Chile's time): a Brazilian withdrawal with
// a screenshot, an ordinary request, and the reminder digest.
function founderPreviews(): Record<string, EmailContent> {
  const plan = (request: RefundRequestDocument) => ({ total: request.amount, currency: request.currency, endsPro: false })
  const withdrawal = sampleRequest({
    region: 'br',
    locale: 'pt-BR',
    explanation: 'Não gostei do resultado, as cores não combinam comigo.',
    statutory: { law: 'br_cdc_49', until: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000) },
    attachment: { key: 'users/000000000000000000000000/refund-preview.jpg', bytes: 182_000 },
    market: { currency: 'brl', region: 'br', signupCountry: 'BR', requestCountry: 'BR', card: { brand: 'mastercard', last4: '0002', country: 'BR', fingerprint: 'fp' }, disputed: false },
    reasonCategory: 'not_accurate',
  })
  const ordinary = sampleRequest({ flags: ['repeat', 'used'], history: { ...sampleRequest().history, refundsBefore: 1, requestsBefore: 1, approvedBefore: 1 } })
  const account = { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), location: null, locale: 'en' as const, acquisition: null }

  return {
    'refund-founder-withdrawal': founderEmail({
      request: withdrawal,
      account: { ...account, locale: 'pt-BR', location: { country: 'BR', region: 'SP', source: 'edge', at: new Date() } },
      plan: plan(withdrawal),
      removesEs: ['el Asesor de Color (reporte y acceso)'],
      test: false,
    }),
    'refund-founder': founderEmail({ request: ordinary, account, plan: plan(ordinary), removesEs: ['el Asesor de Color (reporte y acceso)'], test: false }),
    'refund-reminders': reminderDigest([withdrawal, ordinary], new Date(Date.now() + 26 * 60 * 60 * 1000)),
  }
}

// Public pictures of Avarobe's fictional demo people stand in for a buyer's
// own (lifecycle/assets.ts makes the real ones from their avatar).
const SAMPLE = {
  look: 'https://www.avarobe.com/demo/people/nora-look.webp',
  drape: 'https://www.avarobe.com/demo/colors/lucia.webp',
  cut: 'https://www.avarobe.com/demo/report/hair.webp',
  edit: 'https://www.avarobe.com/icon-looks/wed-velvet-column.webp',
  event: 'https://www.avarobe.com/demo/people/julie-look.webp',
  cover: 'https://www.avarobe.com/demo/magazine/nora-cover.jpg',
}

function crossSellPreviews(
  recipient: { firstName: string; email: string; unsubscribeUrl: string; locale: Locale; region: PricingRegion },
  region: PricingRegion,
) {
  const now = new Date()
  const until = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000)
  const url = 'https://www.avarobe.com/continue?token=preview'
  const price = (product: Parameters<typeof regionalAmount>[0]) => regionalAmount(product, region)
  const owner = {
    ...recipient,
    season: 'Warm Autumn',
    colors,
    now,
    url,
    side: null,
    owns: { color: true, style: false },
    currency: REGION_CURRENCY[region],
  }
  // The newest Edit, named in the reader's language.
  const newest = [...EDITS].sort((a, b) => b.droppedAt.localeCompare(a.droppedAt))[0]!
  const edit = withLocale(recipient.locale, () => editText(newest))
  const gift = { url: `${url}&look=1`, color: colors[1]!.name }
  const occasionUrls = [1, 2, 3].map((index) => `${url}&occasion=${index}`)
  const pro = { ...owner, price: price('pro_monthly'), regular: null, until: null, edit }
  // A Color Advisor bought yesterday counts toward Pro annual (billing
  // reportCreditFor), at the market's prices: the block in the first two
  // cross-sells (with the Pro tour linked under it), and the Pro email's
  // annual offer.
  const proCredit = {
    price: price('pro_annual') - price('color_report'),
    regular: price('pro_annual'),
    credit: price('color_report'),
    from: 'color' as const,
    until: new Date(now.getTime() + 13 * 24 * 60 * 60 * 1000),
    url: `${url}&buy=pro_annual`,
    tourUrl: `${url}&see=pro`,
  }

  return {
    'xsell-style-pair-price': crossSellEmail({ ...owner, kind: 'xsell_style', price: price('style_addon'), regular: price('style_report'), until }),
    'xsell-style-pair-price-photo': crossSellEmail({
      ...owner,
      kind: 'xsell_style',
      price: price('style_addon'),
      regular: price('style_report'),
      until,
      heroUrl: SAMPLE.look,
      gift,
    }),
    'xsell-style': crossSellEmail({ ...owner, kind: 'xsell_style', price: price('style_report'), regular: null, until: null }),
    'xsell-color': crossSellEmail({
      ...owner,
      kind: 'xsell_color',
      price: price('color_report'),
      regular: null,
      until: null,
      colors: [],
      owns: { color: false, style: true },
    }),
    'xsell-color-photo': crossSellEmail({
      ...owner,
      kind: 'xsell_color',
      price: price('color_report'),
      regular: null,
      until: null,
      colors: [],
      owns: { color: false, style: true },
      heroUrl: SAMPLE.drape,
    }),
    'xsell-last-call': crossSellEmail({
      ...owner,
      kind: 'xsell_addon_last_call',
      price: price('style_addon'),
      regular: price('style_report'),
      until: new Date(now.getTime() + 30 * 60 * 60 * 1000),
      side: 'style',
    }),
    'xsell-hair': crossSellEmail({ ...owner, kind: 'xsell_hair', price: price('hair_advisor'), regular: null, until: null }),
    'xsell-hair-photo': crossSellEmail({
      ...owner,
      kind: 'xsell_hair',
      price: price('hair_advisor'),
      regular: null,
      until: null,
      heroUrl: SAMPLE.cut,
      cut: 'Long layers with curtain bangs',
    }),
    'xsell-style-pro-credit': crossSellEmail({
      ...owner,
      kind: 'xsell_style',
      price: price('style_addon'),
      regular: price('style_report'),
      until,
      heroUrl: SAMPLE.look,
      gift,
      proCredit,
    }),
    'xsell-hair-pro-credit': crossSellEmail({ ...owner, kind: 'xsell_hair', price: price('hair_advisor'), regular: null, until: null, proCredit }),
    'xsell-pro-annual-credit': crossSellEmail({
      ...pro,
      kind: 'xsell_pro',
      price: proCredit.price,
      regular: proCredit.regular,
      until: proCredit.until,
      heroUrl: SAMPLE.edit,
      proCredit: { ...proCredit, url },
    }),
    'xsell-pro': crossSellEmail({ ...pro, kind: 'xsell_pro' }),
    'xsell-pro-photo': crossSellEmail({ ...pro, kind: 'xsell_pro', heroUrl: SAMPLE.edit }),
    'xsell-event': crossSellEmail({ ...owner, kind: 'xsell_event', price: price('event_pass'), regular: null, until: null, occasionUrls }),
    'xsell-event-photo': crossSellEmail({
      ...owner,
      kind: 'xsell_event',
      price: price('event_pass'),
      regular: null,
      until: null,
      occasionUrls,
      heroUrl: SAMPLE.event,
    }),
    'xsell-magazine': crossSellEmail({ ...owner, kind: 'xsell_magazine', price: price('magazine'), regular: null, until: null }),
    'xsell-magazine-photo': crossSellEmail({
      ...owner,
      kind: 'xsell_magazine',
      price: price('magazine'),
      regular: null,
      until: null,
      heroUrl: SAMPLE.cover,
    }),
    'xsell-guide': crossSellEmail({
      ...owner,
      kind: 'xsell_guide',
      price: price('outfit_guide'),
      regular: null,
      until: null,
      url: 'https://www.avarobe.com/guide',
    }),
    // Someone without the Color Advisor: no palette.
    'xsell-guide-no-colors': crossSellEmail({
      ...owner,
      kind: 'xsell_guide',
      price: price('outfit_guide'),
      regular: null,
      until: null,
      url: 'https://www.avarobe.com/guide',
      colors: [],
      owns: { color: false, style: true },
    }),
    'xsell-edit': crossSellEmail({ ...pro, kind: 'xsell_edit' }),
    'xsell-edit-photo': crossSellEmail({ ...pro, kind: 'xsell_edit', heroUrl: SAMPLE.edit }),
  }
}

// English at the top of the folder (as before), the others in pt-BR/ and es/.
const emails: Record<string, EmailContent> = {}

for (const { locale, region } of MARKETS) {
  for (const [name, email] of Object.entries(emailsFor(locale, region))) {
    emails[locale === 'en' ? name : `${locale}/${name}`] = email
  }
}

Object.assign(emails, founderPreviews())

const log = {
  info: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
} as unknown as Parameters<typeof deliverEmail>[0]['log']

for (const { locale } of MARKETS) {
  await mkdir(locale === 'en' ? OUT : path.join(OUT, locale), { recursive: true })
}

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
