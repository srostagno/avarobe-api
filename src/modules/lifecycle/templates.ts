import { env } from '../../config/env.js'
import { emailCopy, formatMoney, inPersonPrice, longDate, weekdayName, type EmailCopy } from '../../i18n/emails.js'
import type { ColorSwatch, LifecycleEmailKind, PurchaseProduct } from '../../types/mongo.js'
import { appUrl, type Locale } from '../../utils/locale.js'
import { seasonName } from '../../utils/seasons.js'
import { REGION_CURRENCY, regionalAmount, type PricingRegion } from '../billing/pricing.js'
import type { CrossSellKind } from './cross-sell.js'

// The onboarding emails. Email clients only reliably render tables and
// inline styles, so the layout is built that way; every block also has a
// plain-text version for the text part of the message. The words are in
// the reader's language (i18n/emails.*.ts), and so are the links, prices
// and dates.

export type EmailContent = { subject: string; html: string; text: string }

type Block = { html: string; text: string }

const COLOR = {
  ivory: '#f7f4ef',
  surface: '#ffffff',
  ink: '#171412',
  inkSoft: '#3a3530',
  muted: '#6b645c',
  line: '#e5ded3',
  accent: '#4b2e4a',
  accentSoft: '#f1e8ee',
  success: '#2f6b4a',
}
const SERIF = "Georgia,'Times New Roman',Times,serif"
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

// Images live on the public site so they load in any inbox, even for test
// sends from development.
const ASSETS = 'https://www.avarobe.com/email'
// The product videos' posters (avarobe-web public/videos).
const VIDEOS = 'https://www.avarobe.com/videos'

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// For text between tags, where an apostrophe needs no escaping.
function escText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Links back to the app, in the reader's language and tagged so analytics
// can tell which email brought the visit.
export function appLink(path: string, campaign: LifecycleEmailKind, params: Record<string, string> = {}, locale: Locale = 'en') {
  const url = new URL(appUrl(locale, path))

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  url.searchParams.set('utm_source', 'email')
  url.searchParams.set('utm_medium', 'lifecycle')
  url.searchParams.set('utm_campaign', campaign)

  return url.toString()
}

// The home page in their language: 'https://www.avarobe.com', '…/pt-br'.
const home = (locale: Locale) => appUrl(locale, '/').replace(/\/$/, '')

// ---------------------------------------------------------------- reader

type Recipient = {
  firstName: string
  email: string
  unsubscribeUrl: string
  // Their language (users.locale), English when missing.
  locale?: Locale
  // Where they pay from (billing/pricing.ts): the prices and currency the
  // emails show. The US list when missing.
  region?: PricingRegion
}

// What every email needs about its reader: the words, and their prices,
// links and season names.
function reader(recipient: Pick<Recipient, 'locale' | 'region'>) {
  const locale = recipient.locale ?? 'en'
  const region = recipient.region ?? 'us'
  const currency = REGION_CURRENCY[region]
  const money = (cents: number, inCurrency: string = currency) => formatMoney(cents, inCurrency, locale)

  return {
    locale,
    c: emailCopy(locale),
    money,
    amount: (product: PurchaseProduct) => regionalAmount(product, region),
    price: (product: PurchaseProduct) => money(regionalAmount(product, region)),
    season: (season: string) => seasonName(season, locale),
    link: (path: string, campaign: LifecycleEmailKind, params: Record<string, string> = {}) => appLink(path, campaign, params, locale),
  }
}

type Reader = ReturnType<typeof reader>

// ---------------------------------------------------------------- blocks

function eyebrow(text: string): Block {
  return {
    html: `<p style="margin:0 0 10px 0;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:${COLOR.muted};">${esc(text)}</p>`,
    text: text.toUpperCase(),
  }
}

function heading(text: string): Block {
  return {
    html: `<h1 class="h1" style="margin:0 0 18px 0;font-family:${SERIF};font-size:34px;line-height:40px;font-weight:normal;color:${COLOR.ink};">${esc(text)}</h1>`,
    text,
  }
}

function paragraph(text: string): Block {
  return {
    html: `<p style="margin:0 0 18px 0;font-family:${SANS};font-size:16px;line-height:26px;color:${COLOR.inkSoft};">${esc(text)}</p>`,
    text,
  }
}

function small(text: string): Block {
  return {
    html: `<p style="margin:0 0 14px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${COLOR.muted};">${esc(text)}</p>`,
    text,
  }
}

function button(label: string, url: string): Block {
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 26px 0;"><tr><td align="center" bgcolor="${COLOR.ink}" style="border-radius:999px;"><a href="${esc(url)}" style="display:inline-block;padding:16px 30px;font-family:${SANS};font-size:15px;line-height:18px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}&nbsp;&rarr;</a></td></tr></table>`,
    text: `${label}: ${url}`,
  }
}

// A second, quieter link under the main button's story.
function textLink(label: string, url: string): Block {
  return {
    html: `<p style="margin:0 0 22px 0;font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;"><a href="${esc(url)}" style="color:${COLOR.accent};text-decoration:underline;">${esc(label)}&nbsp;&rarr;</a></p>`,
    text: `${label}: ${url}`,
  }
}

// Big choices, one per line, full width: tap the one that fits.
function choices(items: { label: string; url: string }[]): Block {
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:0 0 10px 0;"><a href="${esc(item.url)}" style="display:block;padding:17px 22px;border:2px solid ${COLOR.ink};border-radius:16px;background:#ffffff;font-family:${SANS};font-size:17px;line-height:22px;font-weight:600;color:${COLOR.ink};text-decoration:none;">${esc(item.label)}&nbsp;&rarr;</a></td></tr>`,
    )
    .join('')

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px 0;">${rows}</table>`,
    text: items.map((item) => `${item.label}: ${item.url}`).join('\n'),
  }
}

// A video's poster, linked to the page that plays it (mail can't play video):
// a play badge on the picture and a line under it.
function videoLink(c: EmailCopy, poster: string, label: string, url: string): Block {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td><a href="${esc(url)}" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding:0 14px 0 0;"><img src="${esc(poster)}" width="96" height="120" alt="" style="display:block;width:96px;height:120px;border-radius:12px;object-fit:cover;"></td><td valign="middle" style="font-family:${SANS};font-size:15px;line-height:21px;font-weight:600;color:${COLOR.ink};">&#9654;&nbsp; ${esc(label)}<br><span style="font-weight:400;font-size:14px;color:${COLOR.muted};">${esc(c.common.videoCaption)}</span></td></tr></table></a></td></tr></table>`,
    text: `${label}: ${url}`,
  }
}

function steps(c: EmailCopy, items: { title: string; body: string; done?: boolean }[]): Block {
  const rows = items
    .map((item, index) => {
      const mark = item.done
        ? `<td width="30" height="30" align="center" valign="middle" bgcolor="${COLOR.success}" style="width:30px;height:30px;border-radius:15px;font-family:${SANS};font-size:15px;line-height:30px;font-weight:700;color:#ffffff;">&#10003;</td>`
        : `<td width="30" height="30" align="center" valign="middle" bgcolor="${COLOR.ink}" style="width:30px;height:30px;border-radius:15px;font-family:${SANS};font-size:14px;line-height:30px;font-weight:700;color:#ffffff;">${index + 1}</td>`
      return `<tr><td valign="top" style="padding:0 0 18px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${mark}</tr></table></td><td valign="top" style="padding:3px 0 18px 14px;"><p style="margin:0 0 2px 0;font-family:${SANS};font-size:16px;line-height:22px;font-weight:600;color:${COLOR.ink};">${esc(item.title)}</p><p style="margin:0;font-family:${SANS};font-size:14px;line-height:21px;color:${COLOR.muted};">${esc(item.body)}</p></td></tr>`
    })
    .join('')

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 10px 0;">${rows}</table>`,
    text: items.map((item, index) => `${item.done ? c.common.doneMark : `${index + 1}.`} ${item.title}: ${item.body}`).join('\n'),
  }
}

function checklist(items: string[]): Block {
  const rows = items
    .map(
      (item) =>
        `<tr><td valign="top" width="26" style="padding:0 0 12px 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:700;color:${COLOR.success};">&#10003;</td><td valign="top" style="padding:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${COLOR.inkSoft};">${esc(item)}</td></tr>`,
    )
    .join('')

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;">${rows}</table>`,
    text: items.map((item) => `- ${item}`).join('\n'),
  }
}

// The season card: name and a strip of swatches, built from table cells so
// it shows even with images off. `season` comes in the reader's language.
function palette(c: EmailCopy, season: string, colors: ColorSwatch[], caption: string): Block {
  const shown = colors.slice(0, 4)
  // Equal columns whatever the color names; the gaps take the rest.
  const width = Math.floor(94 / Math.max(1, shown.length))
  const cells = shown
    .map(
      (color, index) =>
        `${index > 0 ? '<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>' : ''}<td valign="top" width="${width}%" style="width:${width}%;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="52" bgcolor="${esc(color.hex)}" style="height:52px;border-radius:12px;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:8px 0 0 0;font-family:${SANS};font-size:12px;line-height:16px;color:${COLOR.muted};">${esc(color.name)}</td></tr></table></td>`,
    )
    .join('')

  // No swatches before they pay: the season and the caption only.
  const strip = shown.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`
    : ''

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td bgcolor="${COLOR.ivory}" style="border-radius:16px;padding:20px 20px 16px 20px;"><p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${COLOR.muted};">${esc(c.common.yourSeason)}</p><p style="margin:0 0 14px 0;font-family:${SERIF};font-size:26px;line-height:32px;font-style:italic;color:${COLOR.accent};">${esc(season)}</p>${strip}<p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:19px;color:${COLOR.muted};">${esc(caption)}</p></td></tr></table>`,
    text: `${c.common.yourSeason}: ${season}${shown.length ? ` (${shown.map((color) => color.name).join(', ')})` : ''}. ${caption}`,
  }
}

// Under the season card: what they've seen, or (no colors before they pay)
// what's waiting.
function paletteCaption(c: EmailCopy, colors: ColorSwatch[]) {
  return colors.length ? c.common.seenColors(colors.length) : c.common.colorsWaiting
}

function chips(items: { label: string; url: string }[]): Block {
  const links = items
    .map(
      (item) =>
        `<a href="${esc(item.url)}" style="display:inline-block;margin:0 8px 10px 0;padding:10px 16px;border:1px solid ${COLOR.line};border-radius:999px;background:#ffffff;font-family:${SANS};font-size:14px;line-height:18px;font-weight:500;color:${COLOR.ink};text-decoration:none;">${esc(item.label)}</a>`,
    )
    .join('')

  return {
    html: `<p style="margin:0 0 16px 0;">${links}</p>`,
    text: items.map((item) => `- ${item.label}: ${item.url}`).join('\n'),
  }
}

function note(c: EmailCopy, text: string): Block {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td bgcolor="${COLOR.accentSoft}" style="border-radius:14px;padding:16px 18px;font-family:${SANS};font-size:14px;line-height:21px;color:${COLOR.accent};">${esc(text)}</td></tr></table>`,
    text: `${c.common.tip}: ${text}`,
  }
}

function priceBox(price: string, detail: string, guarantee: string): Block {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px 0;"><tr><td style="border:1px solid ${COLOR.line};border-radius:16px;padding:18px 20px;"><p style="margin:0;font-family:${SERIF};font-size:30px;line-height:36px;color:${COLOR.ink};">${esc(price)}</p><p style="margin:2px 0 10px 0;font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${COLOR.ink};">${esc(detail)}</p><p style="margin:0;font-family:${SANS};font-size:13px;line-height:19px;color:${COLOR.muted};">${esc(guarantee)}</p></td></tr></table>`,
    text: `${price}. ${detail} ${guarantee}`,
  }
}

// Plan options side by side, stacked for phones: name and price on one
// line, what it includes under it; the featured one gets a border and badge.
function plans(rows: { name: string; price: string; detail: string; badge?: string }[]): Block {
  const html = rows
    .map((row) => {
      const featured = Boolean(row.badge)
      const badge = row.badge
        ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:${COLOR.accentSoft};font-family:${SANS};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${COLOR.accent};vertical-align:1px;">${esc(row.badge)}</span>`
        : ''
      return `<tr><td style="padding:0 0 10px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border:${featured ? 2 : 1}px solid ${featured ? COLOR.accent : COLOR.line};border-radius:16px;padding:${featured ? 15 : 16}px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="font-family:${SANS};font-size:16px;line-height:22px;font-weight:600;color:${COLOR.ink};">${esc(row.name)}${badge}</td><td valign="top" align="right" style="font-family:${SERIF};font-size:19px;line-height:22px;color:${COLOR.ink};white-space:nowrap;">${esc(row.price)}</td></tr><tr><td colspan="2" style="padding:4px 0 0 0;font-family:${SANS};font-size:14px;line-height:20px;color:${COLOR.muted};">${esc(row.detail)}</td></tr></table></td></tr></table></td></tr>`
    })
    .join('')

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px 0;">${html}</table>`,
    text: rows.map((row) => `- ${row.name}${row.badge ? ` (${row.badge})` : ''}: ${row.price}. ${row.detail}`).join('\n'),
  }
}

// The rest of what Avarobe sells, each with its page: name and price on
// one line, what it is under it, a link to read more.
function products(c: EmailCopy, rows: { name: string; price: string; detail: string; url: string }[]): Block {
  const html = rows
    .map(
      (row) =>
        `<tr><td style="padding:0 0 12px 0;border-bottom:1px solid ${COLOR.line};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="padding:12px 0 0 0;font-family:${SANS};font-size:15px;line-height:21px;font-weight:600;color:${COLOR.ink};">${esc(row.name)}</td><td valign="top" align="right" style="padding:12px 0 0 0;font-family:${SERIF};font-size:17px;line-height:21px;color:${COLOR.ink};white-space:nowrap;">${esc(row.price)}</td></tr><tr><td colspan="2" style="padding:3px 0 0 0;font-family:${SANS};font-size:14px;line-height:20px;color:${COLOR.muted};">${esc(row.detail)} <a href="${esc(row.url)}" style="color:${COLOR.accent};font-weight:600;text-decoration:underline;">${esc(c.common.whatsInside)}</a></td></tr></table></td></tr>`,
    )
    .join('')

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">${html}</table>`,
    text: rows.map((row) => `- ${row.name}, ${row.price}: ${row.detail} ${row.url}`).join('\n'),
  }
}

function signature(c: EmailCopy): Block {
  return {
    html: `<p style="margin:8px 0 0 0;font-family:${SANS};font-size:15px;line-height:24px;color:${COLOR.inkSoft};">${esc(c.common.signoff)}<br><span style="font-family:${SERIF};font-size:17px;font-style:italic;color:${COLOR.ink};">${esc(c.common.team)}</span></p>`,
    text: `${c.common.signoff}\n${c.common.team}`,
  }
}

// ---------------------------------------------------------------- layout

function greeting(c: EmailCopy, firstName: string): Block {
  return paragraph(firstName.trim() ? c.common.hi(firstName.trim()) : c.common.hiThere)
}

function footer(recipient: Recipient, promotional: boolean, receipt?: string): Block {
  const { c, locale } = reader(recipient)
  const site = home(locale)
  const link = (label: string, url: string) =>
    `<a href="${esc(url)}" style="color:${COLOR.muted};text-decoration:underline;">${esc(label)}</a>`
  const line = (html: string) => `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${COLOR.muted};">${html}</p>`
  const tagline = `Avarobe &middot; ${esc(c.footer.tagline)} &middot; ${link('avarobe.com', site)}`

  // A purchase delivery, maybe to someone without an account.
  if (receipt) {
    const why = c.footer.bought(receipt, recipient.email)
    const [before = '', after = ''] = c.footer.help.split('{email}')
    const help = `${before}hello@avarobe.com${after}`
    const address = env.EMAIL_POSTAL_ADDRESS
    return {
      html: [esc(why), `${esc(before)}${link('hello@avarobe.com', 'mailto:hello@avarobe.com')}${esc(after)}`, tagline, ...(address ? [esc(address)] : [])]
        .map(line)
        .join(''),
      text: [why, help, site, ...(address ? [address] : [])].join('\n'),
    }
  }

  const preferences = appUrl(locale, '/studio/account')
  const address = env.EMAIL_POSTAL_ADDRESS
  const [before = '', after = ''] = c.footer.account('\u0000').split('\u0000')
  const lines = [
    `${escText(before)}${esc(recipient.email)}${escText(after)}`,
    `${link(c.footer.preferences, preferences)} &nbsp;&middot;&nbsp; ${link(c.footer.unsubscribe, recipient.unsubscribeUrl)}`,
    tagline,
    ...(promotional && address ? [esc(address)] : []),
  ]

  return {
    html: lines.map(line).join(''),
    text: [
      c.footer.account(recipient.email),
      `${c.footer.preferences}: ${preferences}`,
      `${c.footer.unsubscribe}: ${recipient.unsubscribeUrl}`,
      ...(promotional && address ? [address] : []),
    ].join('\n'),
  }
}

function layout(input: {
  subject: string
  preheader: string
  hero: { src: string; alt: string }
  blocks: Block[]
  recipient: Recipient
  promotional?: boolean
  // A purchase delivery: the footer says what they bought, not the account.
  receipt?: string
}): EmailContent {
  const { c, locale } = reader(input.recipient)
  const foot = footer(input.recipient, input.promotional ?? false, input.receipt)
  // Invisible filler after the preheader, so inbox previews don't run into
  // the body text.
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60)
  const html = `<!doctype html>
<html lang="${c.lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(input.subject)}</title>
<style>
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 29px !important; line-height: 35px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLOR.ivory};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${COLOR.ivory};">${esc(input.preheader)}${filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.ivory}" style="background:${COLOR.ivory};">
<tr><td align="center" style="padding:28px 12px 36px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td class="px" style="padding:0 8px 18px 8px;"><a href="${esc(home(locale))}" style="font-family:${SERIF};font-size:30px;line-height:34px;font-style:italic;color:${COLOR.ink};text-decoration:none;">avarobe</a></td></tr>
<tr><td bgcolor="${COLOR.surface}" style="background:${COLOR.surface};border:1px solid ${COLOR.line};border-radius:22px;">
<img src="${esc(input.hero.src)}" alt="${esc(input.hero.alt)}" width="598" style="display:block;width:100%;max-width:598px;height:auto;border:0;border-radius:21px 21px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:34px 40px 30px 40px;">
${input.blocks.map((block) => block.html).join('\n')}
</td></tr></table>
</td></tr>
<tr><td class="px" align="center" style="padding:24px 24px 0 24px;text-align:center;">${foot.html}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
  const text = [...input.blocks.map((block) => block.text), '—', foot.text].join('\n\n')

  return { subject: input.subject, html, text }
}

// The pictures most emails lead with.
const HERO = {
  wedding: (c: EmailCopy) => ({ src: `${ASSETS}/welcome-hero.jpg`, alt: c.hero.wedding }),
  drape: (c: EmailCopy) => ({ src: `${ASSETS}/color-report.jpg`, alt: c.hero.drape }),
  occasions: (c: EmailCopy) => ({ src: `${ASSETS}/occasions.jpg`, alt: c.hero.occasions }),
}

// ---------------------------------------------------------------- emails

export type WelcomeStage = 'new' | 'avatar' | 'looks'

// `focus: 'colors'`: they came for their colors (a color guide or a Colors
// ad), so the welcome leads with the colors and the avatar comes after.
export function welcomeEmail(
  input: Recipient & { stage: WelcomeStage; season: string | null; focus?: 'colors' | null },
): EmailContent {
  if (input.focus === 'colors' && input.stage === 'new') {
    return colorsWelcomeEmail({ ...input, season: input.season })
  }

  const x = reader(input)
  const { c } = x
  const { stage } = input
  const season = input.season ? x.season(input.season) : null
  const name = input.firstName.trim()
  const cta =
    stage === 'new'
      ? button(c.common.createMyAvatar, x.link('/studio/avatar', 'welcome'))
      : stage === 'avatar'
        ? button(c.common.styleFirstOccasion, x.link('/studio/new', 'welcome'))
        : button(c.welcome.openLooks, x.link('/studio', 'welcome'))

  return layout({
    subject: c.common.welcomeSubject(name),
    preheader: c.welcome.preheader,
    hero: HERO.wedding(c),
    recipient: input,
    blocks: [
      eyebrow(c.common.welcomeEyebrow),
      heading(c.welcome.heading),
      greeting(c, input.firstName),
      paragraph(c.welcome.intro),
      steps(c, [
        {
          title: c.common.createAvatar,
          body: stage === 'new' ? c.welcome.avatarTodo : c.welcome.avatarDone,
          done: stage !== 'new',
        },
        {
          title: c.common.getSeason,
          body: season ? c.common.seasonDone(season) : c.welcome.seasonTodo,
          done: Boolean(season),
        },
        {
          title: c.welcome.occasionTitle,
          body: stage === 'looks' ? c.welcome.occasionDone : c.welcome.occasionTodo(env.FREE_CREDITS),
          done: stage === 'looks',
        },
      ]),
      cta,
      ...(stage === 'new' ? [note(c, c.common.selfieTip)] : []),
      ...(stage === 'looks' ? [paragraph(c.welcome.next)] : []),
      signature(c),
    ],
  })
}

function colorsWelcomeEmail(input: Recipient & { season: string | null }): EmailContent {
  const x = reader(input)
  const { c } = x
  const season = input.season ? x.season(input.season) : null
  const name = input.firstName.trim()

  return layout({
    subject: c.common.welcomeSubject(name),
    preheader: c.colorsWelcome.preheader,
    hero: HERO.drape(c),
    recipient: input,
    blocks: [
      eyebrow(c.common.welcomeEyebrow),
      heading(c.colorsWelcome.heading),
      greeting(c, input.firstName),
      paragraph(c.colorsWelcome.intro),
      steps(c, [
        {
          title: c.common.getSeason,
          body: season ? c.common.seasonDone(season) : c.colorsWelcome.seasonTodo,
          done: Boolean(season),
        },
        {
          title: c.colorsWelcome.drainTitle,
          body: season ? c.colorsWelcome.drainDone : c.colorsWelcome.drainTodo,
          done: Boolean(season),
        },
        {
          title: c.common.createAvatar,
          body: c.colorsWelcome.avatarBody,
          done: false,
        },
      ]),
      season
        ? button(c.colorsWelcome.seeMyColors, x.link('/studio', 'welcome'))
        : button(c.common.findMyColors, x.link('/studio/avatar', 'welcome', { mode: 'colors' })),
      ...(season ? [] : [note(c, c.common.selfieTip)]),
      signature(c),
    ],
  })
}

// `focus: 'colors'`: no selfie yet from someone who came for their colors,
// so it asks for the selfie their colors come from, not the measurements.
export function avatarNudgeEmail(input: Recipient & { focus?: 'colors' | null }): EmailContent {
  const x = reader(input)
  const { c } = x

  if (input.focus === 'colors') {
    const copy = c.avatarNudge.colors
    return layout({
      subject: copy.subject,
      preheader: copy.preheader,
      hero: HERO.drape(c),
      recipient: input,
      blocks: [
        eyebrow(c.common.oneStepLeft),
        heading(copy.heading),
        greeting(c, input.firstName),
        paragraph(copy.intro),
        checklist(copy.checklist),
        button(c.common.findMyColors, x.link('/studio/avatar', 'avatar_nudge', { mode: 'colors' })),
        small(copy.privacy),
        signature(c),
      ],
    })
  }

  const copy = c.avatarNudge.avatar
  return layout({
    subject: copy.subject,
    preheader: copy.preheader,
    hero: { src: `${ASSETS}/avatar-flow.jpg`, alt: c.hero.avatarFlow },
    recipient: input,
    blocks: [
      eyebrow(c.common.oneStepLeft),
      heading(copy.heading),
      greeting(c, input.firstName),
      paragraph(copy.intro),
      checklist(copy.checklist),
      button(c.common.createMyAvatar, x.link('/studio/avatar', 'avatar_nudge')),
      small(copy.privacy),
      signature(c),
    ],
  })
}

export function looksNudgeEmail(input: Recipient & { season: string | null; colors: ColorSwatch[] }): EmailContent {
  const x = reader(input)
  const { c } = x
  const { colors } = input
  const season = input.season ? x.season(input.season) : null

  return layout({
    subject: c.looksNudge.subject(season),
    preheader: c.looksNudge.preheader(env.FREE_CREDITS),
    hero: HERO.occasions(c),
    recipient: input,
    blocks: [
      eyebrow(c.looksNudge.eyebrow(env.FREE_CREDITS)),
      heading(c.looksNudge.heading),
      greeting(c, input.firstName),
      ...(season && colors.length > 0 ? [palette(c, season, colors, c.looksNudge.paletteCaption)] : []),
      paragraph(c.looksNudge.intro),
      small(c.looksNudge.startFrom),
      chips(c.looksNudge.occasions.map((label) => ({ label, url: x.link('/studio/new', 'looks_nudge', { occasion: label }) }))),
      button(c.common.styleFirstOccasion, x.link('/studio/new', 'looks_nudge')),
      signature(c),
    ],
  })
}

// ---------------------------------------------------------------- offers
// Out of free looks and nothing bought: the offer, then two reminders. They
// are promotional, so they carry the postal address, and each one says how
// Pro renews.

// The first-time offer: Pro for a few days at a small price, then monthly.
const trialFeatures = (c: EmailCopy) => c.offer.trialFeatures(env.PRO_TRIAL_CREDITS, env.PRO_MONTHLY_CREDITS)

// The one-time alternatives to the trial.
const PLAN = {
  colorReport: (x: Reader) => ({ name: x.c.names.colorAdvisor, price: x.price('color_report'), detail: x.c.offer.colorReportDetail }),
  pack: (x: Reader) => ({ name: x.c.names.lookPack, price: x.price('look_pack'), detail: x.c.offer.packDetail(env.LOOK_PACK_CREDITS) }),
  proMonthly: (x: Reader) => ({
    name: x.c.names.pro,
    price: x.c.common.perMonthShort(x.price('pro_monthly')),
    detail: x.c.offer.proMonthlyDetail(env.PRO_MONTHLY_CREDITS),
  }),
}

// Two offers. People who spent their free look get the looks one; people
// who came for their colors, and have seen them but made no look, get one
// that leads with their palette (`palette`).
export function upgradeOfferEmail(
  input: Recipient & { palette?: { season: string; colors: ColorSwatch[]; heroUrl?: string | null; url?: string } | null },
): EmailContent {
  if (input.palette) {
    return paletteOfferEmail({ ...input, palette: input.palette })
  }

  const x = reader(input)
  const { c } = x
  const monthly = x.price('pro_monthly')
  const trial = x.price('pro_trial')
  const days = env.PRO_TRIAL_DAYS

  if (!env.PRO_TRIAL) {
    return layout({
      subject: c.offer.proSubject,
      preheader: c.offer.proPreheader(env.PRO_MONTHLY_CREDITS, monthly),
      hero: HERO.occasions(c),
      recipient: input,
      promotional: true,
      blocks: [
        eyebrow(c.common.freeLookDone),
        heading(c.common.styleEveryOccasion),
        greeting(c, input.firstName),
        paragraph(c.offer.proIntro),
        checklist(c.offer.proFeatures(env.PRO_MONTHLY_CREDITS)),
        priceBox(c.common.perMonth(monthly), c.offer.proLooks(env.PRO_MONTHLY_CREDITS), c.offer.cancelAnytime),
        button(c.offer.getPro, x.link('/studio', 'upgrade_offer', { upgrade: 'plan' })),
        small(c.common.orPayOnce),
        plans([PLAN.colorReport(x), PLAN.pack(x)]),
        signature(c),
      ],
    })
  }

  return layout({
    subject: c.offer.trialSubject(days, trial),
    preheader: c.offer.trialPreheader(trial, days),
    hero: HERO.occasions(c),
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow(c.common.freeLookDone),
      heading(c.common.styleEveryOccasion),
      greeting(c, input.firstName),
      paragraph(c.offer.trialIntro(days)),
      checklist(trialFeatures(c)),
      priceBox(c.common.trialFor(trial, days), c.common.thenPerMonth(monthly), c.offer.trialCancel),
      button(c.common.startTrial(days, trial), x.link('/studio', 'upgrade_offer', { upgrade: 'plan' })),
      small(c.common.orPayOnce),
      plans([PLAN.colorReport(x), PLAN.pack(x)]),
      signature(c),
    ],
  })
}

// What else Avarobe sells, for the end of the colors offer.
const OTHER_PRODUCTS = (x: Reader, campaign: LifecycleEmailKind) => {
  const { c } = x
  return [
    { name: c.names.styleAdvisor, price: c.common.once(x.price('style_report')), detail: c.offer.products.style, url: x.link('/advisors/style', campaign) },
    { name: c.names.hairAdvisor, price: c.common.once(x.price('hair_advisor')), detail: c.offer.products.hair, url: x.link('/advisors/hair', campaign) },
    { name: c.names.eventStylist, price: c.common.perEvent(x.price('event_pass')), detail: c.offer.products.event, url: x.link('/advisors/event', campaign) },
    { name: c.names.allAdvisors, price: c.common.once(x.price('advisors_bundle')), detail: c.offer.products.bundle, url: x.link('/advisors', campaign) },
    {
      name: c.names.pro,
      price: c.common.perMonthShort(x.price('pro_monthly')),
      detail: c.offer.products.pro(env.PRO_MONTHLY_CREDITS),
      url: x.link('/advisors/pro', campaign),
    },
    { name: c.names.book, price: x.price('outfit_guide'), detail: c.offer.products.book, url: x.link('/guide', campaign) },
  ]
}

// The colors offer, an hour after their colors came in (colors first, no
// look): their own photo with their best colors blurred (`heroUrl`), what
// the Color Advisor holds, a button that opens checkout signed in (`url`,
// a one-tap sign-in link), and the rest of what Avarobe sells.
function paletteOfferEmail(
  input: Recipient & { palette: { season: string; colors: ColorSwatch[]; heroUrl?: string | null; url?: string } },
): EmailContent {
  const x = reader(input)
  const { c } = x
  const { colors } = input.palette
  const season = x.season(input.palette.season)

  if (!env.PRO_TRIAL) {
    const price = x.price('color_report')
    const personal = Boolean(input.palette.heroUrl)
    const name = input.firstName.trim()
    const buyUrl = input.palette.url ?? x.link('/studio', 'upgrade_offer', { buy: 'color_report', from: 'email_colors' })

    // The full report, not "three colors": a price for three colors read as
    // too little for too much (Silvio, Oct 4).
    return layout({
      subject: c.paletteOffer.subject(name),
      preheader: c.paletteOffer.preheader(price),
      hero: personal ? { src: input.palette.heroUrl as string, alt: c.hero.paletteOffer } : HERO.drape(c),
      recipient: input,
      promotional: true,
      blocks: [
        eyebrow(c.paletteOffer.eyebrow),
        heading(c.paletteOffer.heading(season)),
        greeting(c, input.firstName),
        paragraph(personal ? c.paletteOffer.introPhoto : c.paletteOffer.intro),
        ...(colors.length > 0 ? [palette(c, season, colors, paletteCaption(c, colors))] : []),
        eyebrow(c.common.whatsInside),
        videoLink(c, `${VIDEOS}/color.jpg`, c.common.seeWhatsInside(24), x.link('/advisors/color', 'upgrade_offer')),
        checklist(c.offer.colorAdvisorFeatures),
        priceBox(c.common.priceOnce(price), c.common.inPerson(inPersonPrice(x.locale)), c.common.onceNote),
        button(c.paletteOffer.button(price), buyUrl),
        small(c.common.buyNote),
        eyebrow(c.paletteOffer.more),
        products(c, OTHER_PRODUCTS(x, 'upgrade_offer')),
        small(c.common.renewalNote),
        signature(c),
      ],
    })
  }

  const trial = x.price('pro_trial')
  const days = env.PRO_TRIAL_DAYS

  return layout({
    subject: c.paletteOffer.trialSubject(season),
    preheader: c.paletteOffer.trialPreheader(days, trial),
    hero: HERO.drape(c),
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow(c.paletteOffer.trialEyebrow),
      heading(c.paletteOffer.trialHeading),
      greeting(c, input.firstName),
      palette(c, season, colors, paletteCaption(c, colors)),
      paragraph(c.paletteOffer.trialIntro(days)),
      checklist(trialFeatures(c)),
      priceBox(c.common.trialFor(trial, days), c.common.thenPerMonth(x.price('pro_monthly')), c.offer.trialCancel),
      button(c.common.startTrial(days, trial), x.link('/studio', 'upgrade_offer', { upgrade: 'palette' })),
      small(c.common.orPayOnce),
      plans([{ ...PLAN.colorReport(x), detail: c.offer.colorReportDetail }]),
      signature(c),
    ],
  })
}

// Once, after the price cut, to people who opened an offer at the old price.
// It leads with their own drape photo, their #1 color still blurred
// (`heroUrl`, null when there is none), and the new price. "We lowered the
// price" is all it claims: no struck-through old price.
export function priceDropEmail(
  input: Recipient & { season: string | null; colors: ColorSwatch[]; heroUrl: string | null; url: string },
): EmailContent {
  const x = reader(input)
  const { c } = x
  const price = x.price('color_report')
  const personal = Boolean(input.heroUrl)

  return layout({
    subject: c.priceDrop.subject(price),
    preheader: c.priceDrop.preheader(price),
    hero: personal ? { src: input.heroUrl as string, alt: c.hero.priceDrop } : HERO.drape(c),
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow(c.priceDrop.eyebrow),
      heading(c.priceDrop.heading(price)),
      greeting(c, input.firstName),
      paragraph(personal ? c.priceDrop.introPhoto : c.priceDrop.intro),
      ...(input.season && input.colors.length > 0
        ? [palette(c, x.season(input.season), input.colors, c.common.seenColors(input.colors.length))]
        : []),
      checklist(c.offer.reportFeatures),
      priceBox(c.common.priceOnce(price), c.common.oneTime, c.common.yoursToKeep),
      button(c.priceDrop.button(price), input.url),
      signature(c),
    ],
  })
}

// Colors first (no look yet), the reminder and the last call show their
// own photo like the offer (`heroUrl`: the locked drape test, null until
// it's drawn) and pay from a one-tap sign-in link (`url`). Oct 9: 833 offer
// emails since Oct 1 sold one report; the stock photo and a button to a page
// that asks them to sign in first didn't help.
type OfferPhoto = { heroUrl?: string | null; url?: string } | null

export function upgradeReminderEmail(input: Recipient & { season: string | null; colors: ColorSwatch[]; photo?: OfferPhoto }): EmailContent {
  const x = reader(input)
  const { c } = x
  const { colors } = input
  const season = input.season ? x.season(input.season) : null
  const photo = env.PRO_TRIAL ? null : (input.photo ?? null)
  const personal = Boolean(photo?.heroUrl)

  return layout({
    subject: c.reminder.subject(season),
    preheader: c.reminder.preheader,
    hero: personal ? { src: photo!.heroUrl as string, alt: c.hero.paletteOffer } : HERO.drape(c),
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow(c.reminder.eyebrow),
      heading(c.reminder.heading),
      greeting(c, input.firstName),
      ...(season && colors.length > 0 ? [palette(c, season, colors, c.reminder.caption(colors.length))] : []),
      paragraph(personal ? c.reminder.introPhoto : c.reminder.intro),
      checklist(c.reminder.checklist),
      ...(env.PRO_TRIAL
        ? [
            plans([
              {
                name: c.reminder.trialName(env.PRO_TRIAL_DAYS),
                price: x.price('pro_trial'),
                detail: c.reminder.trialDetail(x.price('pro_monthly')),
                badge: c.reminder.tryIt,
              },
              { ...PLAN.colorReport(x), detail: c.reminder.oneTimeDetail },
            ]),
            small(c.offer.trialNote(x.price('pro_trial'), env.PRO_TRIAL_DAYS, x.price('pro_monthly'))),
          ]
        : [
            plans([{ ...PLAN.colorReport(x), detail: c.reminder.oneTimeDetail, badge: c.reminder.startHere }, PLAN.proMonthly(x)]),
            small(c.common.renewalNote),
          ]),
      photo
        ? button(
            c.paletteOffer.button(x.price('color_report')),
            photo.url ?? x.link('/studio', 'upgrade_reminder', { buy: 'color_report', from: 'email_reminder' }),
          )
        : button(c.common.seeMyPalette, x.link('/studio/report', 'upgrade_reminder', { upgrade: 'palette' })),
      signature(c),
    ],
  })
}

export function upgradeLastCallEmail(input: Recipient & { photo?: OfferPhoto }): EmailContent {
  const x = reader(input)
  const { c } = x
  const reports = x.price('reports_bundle')

  if (!env.PRO_TRIAL) {
    const once = c.common.priceOnce(x.price('color_report'))
    const photo = input.photo ?? null
    const personal = Boolean(photo?.heroUrl)

    return layout({
      subject: c.lastCall.subject,
      preheader: c.lastCall.preheader(once),
      hero: personal ? { src: photo!.heroUrl as string, alt: c.hero.paletteOffer } : HERO.drape(c),
      recipient: input,
      promotional: true,
      blocks: [
        eyebrow(c.common.lastReminder),
        heading(c.lastCall.heading),
        greeting(c, input.firstName),
        paragraph(personal ? c.lastCall.introPhoto : c.lastCall.intro),
        priceBox(once, c.common.noSubscription, c.common.yoursToKeep),
        photo
          ? button(
              c.paletteOffer.button(x.price('color_report')),
              photo.url ?? x.link('/studio', 'upgrade_last_call', { buy: 'color_report', from: 'email_last_call' }),
            )
          : button(c.common.seeMyPalette, x.link('/studio', 'upgrade_last_call', { upgrade: 'palette' })),
        small(c.lastCall.orPro),
        plans([PLAN.proMonthly(x), PLAN.pack(x)]),
        small(c.common.renewalNote),
        small(c.common.notReady),
        signature(c),
      ],
    })
  }

  const trial = x.price('pro_trial')
  const days = env.PRO_TRIAL_DAYS

  return layout({
    subject: c.lastCall.trialSubject,
    preheader: c.lastCall.trialPreheader(days, trial),
    hero: HERO.wedding(c),
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow(c.common.lastReminder),
      heading(c.lastCall.trialHeading(days, trial)),
      greeting(c, input.firstName),
      paragraph(c.lastCall.trialIntro(reports)),
      priceBox(c.common.trialFor(trial, days), c.common.thenPerMonth(x.price('pro_monthly')), c.offer.trialCancel),
      button(c.common.startTrial(days, trial), x.link('/studio', 'upgrade_last_call', { upgrade: 'plan' })),
      small(c.common.orPayOnce),
      plans([PLAN.colorReport(x), PLAN.pack(x)]),
      small(c.common.notReady),
      signature(c),
    ],
  })
}

// ---------------------------------------------------------------- rescue
// A checkout left unpaid (most often inside Instagram's or Facebook's own
// browser, where nobody has finished one): a sign-in link that opens their
// own browser where they left off. Promotional, so it carries the address.

export function checkoutRescueEmail(input: Recipient & { product: string; url: string }): EmailContent {
  const { c } = reader(input)
  // "Your Color Advisor is", "Your looks are" (names and grammar per language).
  const what = c.rescue.what(input.product)
  // The color hero for the color and style advisors; hair and events show
  // outfits for occasions.
  const report = /report|addon|reports_bundle|advisors_bundle|mirror/.test(input.product)

  return layout({
    subject: c.rescue.subject(what),
    preheader: c.rescue.preheader,
    hero: report ? HERO.drape(c) : HERO.occasions(c),
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow(c.rescue.eyebrow),
      heading(c.rescue.heading(what)),
      greeting(c, input.firstName),
      paragraph(c.rescue.intro),
      button(c.rescue.button, input.url),
      small(c.rescue.expiry),
      signature(c),
    ],
  })
}

// Bought the Color Advisor and never opened the report: a link that signs
// them in on it. About what they paid for, so it goes out even to people who
// turned off tips.
export function reportUnopenedEmail(input: Recipient & { season: string | null; url: string }): EmailContent {
  const { c, locale } = reader(input)
  const season = input.season ? seasonName(input.season, locale) : null

  return layout({
    subject: c.reportUnopened.subject,
    preheader: c.reportUnopened.preheader,
    hero: HERO.drape(c),
    recipient: input,
    blocks: [
      eyebrow(c.reportUnopened.eyebrow),
      heading(c.reportUnopened.heading(season)),
      greeting(c, input.firstName),
      paragraph(c.reportUnopened.intro),
      button(c.reportUnopened.button, input.url),
      small(c.reportUnopened.expiry),
      signature(c),
    ],
  })
}

// ---------------------------------------------------------------- trial
// Pro trial notices. Transactional (billing terms), so they go out even to
// people who turned off tips, and carry no postal address.

export function trialStartedEmail(input: Recipient & { trialEnd: Date }): EmailContent {
  const x = reader(input)
  const { c } = x
  const end = longDate(input.trialEnd, x.locale)
  const monthly = x.price('pro_monthly')

  return layout({
    subject: c.trialStarted.subject(env.PRO_TRIAL_DAYS),
    preheader: c.trialStarted.preheader(end, monthly),
    hero: HERO.drape(c),
    recipient: input,
    blocks: [
      eyebrow(c.trialStarted.eyebrow),
      heading(c.trialStarted.heading(end)),
      greeting(c, input.firstName),
      paragraph(c.trialStarted.intro),
      checklist(trialFeatures(c)),
      button(c.trialStarted.button, x.link('/studio', 'trial_started')),
      priceBox(c.trialStarted.then(monthly), c.trialStarted.renews(end), c.trialStarted.paid(x.price('pro_trial'), end)),
      small(c.common.manage(appUrl(x.locale, '/studio/account#plan'))),
      signature(c),
    ],
  })
}

export function trialEndingEmail(input: Recipient & { trialEnd: Date; looksLeft: number }): EmailContent {
  const x = reader(input)
  const { c } = x
  const end = longDate(input.trialEnd, x.locale)
  const monthly = x.price('pro_monthly')
  const annual = x.amount('pro_annual')

  return layout({
    subject: c.trialEnding.subject(end),
    preheader: c.trialEnding.preheader(monthly, env.PRO_MONTHLY_CREDITS),
    hero: HERO.occasions(c),
    recipient: input,
    blocks: [
      eyebrow(c.trialEnding.eyebrow),
      heading(c.trialEnding.heading(end)),
      greeting(c, input.firstName),
      paragraph(c.trialEnding.body(end, monthly, env.PRO_MONTHLY_CREDITS, input.looksLeft)),
      button(c.trialEnding.button, x.link('/studio/new', 'trial_ending')),
      paragraph(c.trialEnding.cancel(end, x.money(annual), x.money(Math.floor(annual / 12)))),
      small(c.common.manage(appUrl(x.locale, '/studio/account#plan'))),
      signature(c),
    ],
  })
}

// ---------------------------------------------------------------- products

// The Outfit Formula Book's delivery: the download link, for good.
export function outfitGuideEmail(input: { email: string; firstName: string; downloadUrl: string; locale?: Locale }): EmailContent {
  const recipient: Recipient = { firstName: input.firstName, email: input.email, unsubscribeUrl: '', locale: input.locale }
  const { c, locale } = reader(recipient)

  return layout({
    subject: c.guide.subject,
    preheader: c.guide.preheader,
    hero: { src: `${env.APP_URL}/guide/cover-email.jpg`, alt: c.hero.book },
    recipient,
    receipt: c.guide.receipt,
    blocks: [
      eyebrow(c.names.book),
      heading(c.guide.heading),
      greeting(c, input.firstName),
      paragraph(c.guide.intro),
      button(c.guide.button, input.downloadUrl),
      small(c.guide.keep),
      paragraph(c.guide.colors),
      button(c.common.findMyColors, `${appUrl(locale, '/color-analysis')}?utm_source=guide&utm_medium=email&utm_campaign=outfit_formula_book`),
      signature(c),
    ],
  })
}

// When their personal magazine is ready (modules/magazine): a link to read it.
export function magazineReadyEmail(input: { email: string; firstName: string; url: string; locale?: Locale }): EmailContent {
  const recipient: Recipient = { firstName: input.firstName, email: input.email, unsubscribeUrl: '', locale: input.locale }
  const { c } = reader(recipient)

  return layout({
    subject: c.magazine.subject(input.firstName),
    preheader: c.magazine.preheader,
    hero: { src: `${env.APP_URL}/demo/magazine/email-hero.jpg`, alt: c.hero.magazine },
    recipient,
    receipt: c.magazine.receipt,
    blocks: [
      eyebrow(c.names.magazine),
      heading(c.magazine.heading),
      greeting(c, input.firstName),
      paragraph(c.magazine.intro),
      button(c.magazine.button, input.url),
      small(c.magazine.keep),
      signature(c),
    ],
  })
}

// ---------------------------------------------------------------- cross-sell
// Buyers: the next product they don't have (lifecycle/cross-sell.ts), one
// per email. They've paid, so their best colors can show (Color Advisor
// owners only). Promotional: postal address and unsubscribe in the footer.

export type CrossSellContent = {
  kind: CrossSellKind
  // The price on the button, and the regular one when it's the pair price,
  // in `currency` (their region's; US dollars when missing).
  price: number
  regular: number | null
  currency?: string
  // When the pair price ends (null at the regular price).
  until: Date | null
  // The pair-price reminder's report.
  side: 'style' | 'color' | null
  // What they have, for the wording.
  owns: { color: boolean; style: boolean }
  // Opens checkout signed in (the book: its page).
  url: string
  season: string | null
  // Their best colors; empty unless they own the Color Advisor.
  colors: ColorSwatch[]
  now: Date
  // Their own picture for this email (lifecycle/assets.ts) once it's ready:
  // a gift look, their drape photo, their ideal cut, an Edit look on them,
  // their latest look, a magazine cover. The stock picture without it, with
  // words to match.
  heroUrl?: string | null
  // xsell_style: the gift look (a link that signs them in) and the color
  // it's built around.
  gift?: { url: string; color: string } | null
  // xsell_hair: their ideal cut, on them in the picture.
  cut?: string | null
  // xsell_pro, xsell_edit: the Edit, in their language.
  edit?: { id: string; name: string; tagline: string } | null
  // xsell_event: a link per occasion (crossSell.event.occasions), signing
  // them in to the Event Stylist with it filled in.
  occasionUrls?: string[]
}

// The pair price ends during this day in the US (Pacific: the earliest
// date there), so the email never promises a day too many.
const PACIFIC = 'America/Los_Angeles'

// What's coming up, for the Event Stylist (by the month in New York).
function upcomingEvents(c: EmailCopy, now: Date) {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric' }).format(now))

  switch (month) {
    case 10:
      return c.crossSell.upcoming.october
    case 11:
      return c.crossSell.upcoming.november
    case 12:
      return c.crossSell.upcoming.december
    default:
      return c.crossSell.upcoming.other
  }
}

export function crossSellEmail(input: Recipient & CrossSellContent): EmailContent {
  const x = reader(input)
  const { c } = x
  const xs = c.crossSell
  const money = (cents: number) => x.money(cents, input.currency)
  const price = money(input.price)
  const pair = input.regular !== null && input.until !== null
  const endDay = (date: Date) => longDate(date, x.locale, PACIFIC)
  const endWeekday = (date: Date) => weekdayName(date, x.locale, PACIFIC)
  const season = input.season ? x.season(input.season) : null
  const tail = pair ? xs.pairTail(price, money(input.regular!), endDay(input.until!)) : xs.onceTail(price)
  const video = (id: string, seconds: number, path: string) =>
    videoLink(c, `${VIDEOS}/${id}.jpg`, c.common.seeWhatsInside(seconds), x.link(path, input.kind))
  const yourColors = (caption: string) => (season && input.colors.length > 0 ? [palette(c, season, input.colors, caption)] : [])
  // The other report at the pair price, or at its own.
  const reportPrice = (owned: string) =>
    pair
      ? priceBox(c.common.priceOnce(price), xs.pairPrice(money(input.regular!), owned, endDay(input.until!)), c.common.onceNote)
      : priceBox(c.common.priceOnce(price), xs.forYou, c.common.onceNote)
  const base = { recipient: input, promotional: true }
  // Their own picture, when the send has it.
  const photo = input.heroUrl ?? null
  const hero = (alt: string) => ({ src: photo!, alt })
  // Pro, for the Pro and new-Edit emails: what it gives, monthly, then its
  // checkout over the Edits.
  const proBlocks = () => [
    checklist(xs.proFeatures(env.PRO_MONTHLY_CREDITS)),
    priceBox(c.common.perMonth(price), xs.proDetail, c.common.renewalNote),
    button(xs.pro.button(price), input.url),
    small(c.common.buyNote),
  ]

  switch (input.kind) {
    case 'xsell_style': {
      const gift = photo && input.gift ? input.gift : null

      return layout({
        ...base,
        subject: gift ? xs.style.giftSubject(gift.color) : xs.style.subject,
        preheader: gift ? xs.style.giftPreheader(tail) : xs.style.preheader(tail),
        hero: gift ? hero(xs.style.giftAlt(gift.color)) : { src: `${ASSETS}/style.jpg`, alt: c.hero.style },
        blocks: [
          eyebrow(gift ? xs.style.giftEyebrow : xs.style.eyebrow),
          heading(gift ? xs.style.giftSubject(gift.color) : xs.style.subject),
          greeting(c, input.firstName),
          paragraph(gift ? xs.style.giftIntro : xs.style.intro),
          ...(gift ? [textLink(xs.style.giftLink, gift.url)] : []),
          ...yourColors(xs.style.colorsCaption),
          video('style', 21, '/advisors/style'),
          checklist(xs.styleFeatures),
          reportPrice(c.names.colorAdvisor),
          button(xs.getMy(c.names.styleAdvisor, price), input.url),
          small(c.common.buyNote),
          eyebrow(xs.style.more),
          chips([
            { label: xs.style.palette, url: x.link('/studio/report', input.kind) },
            { label: xs.style.mirror, url: x.link('/studio/mirror', input.kind) },
            { label: xs.style.check, url: x.link('/studio/check', input.kind) },
          ]),
          signature(c),
        ],
      })
    }

    case 'xsell_color':
      return layout({
        ...base,
        subject: photo ? xs.color.photoSubject : input.owns.style ? xs.color.subjectAfterStyle : xs.color.subject,
        preheader: photo ? xs.color.photoPreheader(tail) : xs.color.preheader(tail),
        hero: photo ? hero(xs.color.photoAlt) : HERO.drape(c),
        blocks: [
          eyebrow(c.names.colorAdvisor),
          heading(photo ? xs.color.photoHeading : input.owns.style ? xs.color.subjectAfterStyle : xs.color.heading),
          greeting(c, input.firstName),
          paragraph(photo ? xs.color.photoIntro : input.owns.style ? xs.color.introAfterStyle : xs.color.intro),
          video('color', 24, '/advisors/color'),
          checklist(c.offer.colorAdvisorFeatures),
          pair
            ? reportPrice(c.names.styleAdvisor)
            : priceBox(c.common.priceOnce(price), c.common.inPerson(inPersonPrice(x.locale)), c.common.onceNote),
          button(xs.getMy(c.names.colorAdvisor, price), input.url),
          small(c.common.buyNote),
          signature(c),
        ],
      })

    case 'xsell_addon_last_call': {
      const style = input.side !== 'color'
      const name = style ? c.names.styleAdvisor : c.names.colorAdvisor
      const owned = style ? c.names.colorAdvisor : c.names.styleAdvisor
      const regular = money(input.regular ?? x.amount(style ? 'style_report' : 'color_report'))
      const until = input.until ?? input.now

      return layout({
        ...base,
        subject: xs.lastCall.subject(name, price, endWeekday(until)),
        preheader: xs.lastCall.preheader(owned, price, regular, endDay(until)),
        hero: style ? { src: `${ASSETS}/style.jpg`, alt: c.hero.style } : HERO.drape(c),
        blocks: [
          eyebrow(xs.lastCall.eyebrow),
          heading(xs.lastCall.heading(endWeekday(until))),
          greeting(c, input.firstName),
          paragraph(xs.lastCall.body(owned, name, price, regular, endDay(until))),
          checklist(style ? xs.styleFeatures : c.offer.colorAdvisorFeatures.slice(0, 4)),
          button(xs.getMy(name, price), input.url),
          small(c.common.buyNote),
          signature(c),
        ],
      })
    }

    case 'xsell_hair': {
      const cut = photo && input.cut ? input.cut : null

      return layout({
        ...base,
        subject: cut ? xs.hair.cutSubject : xs.hair.subject,
        preheader: cut ? xs.hair.cutPreheader(price) : xs.hair.preheader(price),
        hero: cut ? hero(xs.hair.cutAlt(cut)) : { src: `${ASSETS}/hair.jpg`, alt: c.hero.hair },
        blocks: [
          eyebrow(c.names.hairAdvisor),
          heading(cut ? xs.hair.cutHeading(cut) : xs.hair.heading),
          greeting(c, input.firstName),
          ...(cut
            ? [paragraph(xs.hair.cutIntro), paragraph(xs.hair.cutMore)]
            : [paragraph(season ? xs.hair.introSeason(season) : xs.hair.intro)]),
          video('hair', 21, '/advisors/hair'),
          checklist(xs.hairFeatures),
          priceBox(c.common.priceOnce(price), xs.hair.detail, c.common.onceNote),
          button(xs.getMy(c.names.hairAdvisor, price), input.url),
          small(c.common.buyNote),
          signature(c),
        ],
      })
    }

    case 'xsell_pro': {
      const edit = input.edit?.name ?? null
      const tried = photo && edit ? edit : null

      return layout({
        ...base,
        subject: tried ? xs.pro.subjectPhoto(tried) : xs.pro.subject,
        preheader: xs.pro.preheader(price, env.PRO_MONTHLY_CREDITS),
        hero: tried ? hero(xs.pro.alt(tried)) : HERO.occasions(c),
        blocks: [
          eyebrow(xs.pro.eyebrow),
          heading(tried ? xs.pro.headingPhoto(tried) : xs.pro.heading),
          greeting(c, input.firstName),
          paragraph(tried ? xs.pro.introPhoto(tried) : xs.pro.intro(edit)),
          ...proBlocks(),
          signature(c),
        ],
      })
    }

    case 'xsell_edit': {
      const edit = input.edit

      // No Edit to name: Pro's own email.
      if (!edit) {
        return crossSellEmail({ ...input, kind: 'xsell_pro' })
      }

      return layout({
        ...base,
        subject: photo ? xs.edit.subjectPhoto(edit.name) : xs.edit.subject(edit.name),
        preheader: xs.pro.preheader(price, env.PRO_MONTHLY_CREDITS),
        hero: photo ? hero(xs.pro.alt(edit.name)) : HERO.occasions(c),
        blocks: [
          eyebrow(xs.edit.eyebrow),
          heading(photo ? xs.edit.subjectPhoto(edit.name) : xs.edit.subject(edit.name)),
          greeting(c, input.firstName),
          paragraph(edit.tagline),
          paragraph(photo ? xs.edit.introPhoto : xs.edit.intro),
          ...proBlocks(),
          signature(c),
        ],
      })
    }

    case 'xsell_magazine':
      return layout({
        ...base,
        subject: photo ? xs.magazine.coverSubject(input.firstName.trim()) : xs.magazine.subject(input.firstName.trim()),
        preheader: photo ? xs.magazine.coverPreheader(price) : xs.magazine.preheader(price),
        hero: photo ? hero(xs.magazine.coverAlt) : { src: 'https://www.avarobe.com/demo/magazine/email-hero.jpg', alt: c.hero.magazine },
        blocks: [
          eyebrow(c.names.magazine),
          heading(photo ? xs.magazine.coverHeading : xs.magazine.heading),
          greeting(c, input.firstName),
          paragraph(photo ? xs.magazine.coverIntro : xs.magazine.intro),
          ...yourColors(xs.magazine.colorsCaption),
          video('magazine', 19, '/advisors/magazine'),
          checklist(xs.magazineFeatures),
          priceBox(c.common.priceOnce(price), xs.magazine.detail, c.common.onceNote),
          button(xs.magazine.button(price), input.url),
          small(c.common.buyNote),
          signature(c),
        ],
      })

    case 'xsell_event': {
      // Each occasion opens the Event Stylist with it filled in, signed in
      // when the send made the links.
      const occasions = xs.event.occasions.map((item, index) => ({
        label: item.label,
        url: input.occasionUrls?.[index] ?? x.link('/studio/events', input.kind, { occasion: item.occasion }),
      }))

      return layout({
        ...base,
        subject: xs.event.subject,
        preheader: xs.event.preheader(price),
        hero: photo ? hero(xs.event.lookAlt) : HERO.occasions(c),
        blocks: [
          eyebrow(c.names.eventStylist),
          heading(xs.event.heading),
          greeting(c, input.firstName),
          paragraph(photo ? xs.event.introPhoto(upcomingEvents(c, input.now)) : xs.event.intro(upcomingEvents(c, input.now))),
          choices(occasions),
          small(xs.event.pick),
          priceBox(c.common.perEvent(price), xs.event.detail, c.common.oneTime),
          video('event', 17, '/advisors/event'),
          checklist(xs.eventFeatures),
          signature(c),
        ],
      })
    }

    case 'xsell_guide': {
      // Color Advisor owners: their palette, to use with the formulas.
      const swatches = season && input.colors.length > 0 ? palette(c, season, input.colors, xs.guide.paletteCaption) : null

      return layout({
        ...base,
        subject: xs.guide.subject,
        preheader: xs.guide.preheader(price),
        hero: { src: 'https://www.avarobe.com/guide/cover-email.jpg', alt: c.hero.book },
        blocks: [
          eyebrow(c.names.book),
          heading(swatches ? xs.guide.paletteHeading : xs.guide.heading),
          greeting(c, input.firstName),
          paragraph(season ? xs.guide.introSeason(season) : xs.guide.intro),
          ...(swatches ? [swatches] : []),
          video('guide', 15, '/guide'),
          priceBox(price, xs.guide.detail, xs.guide.delivery),
          button(xs.guide.button(price), input.url),
          ...(xs.guide.language ? [small(xs.guide.language)] : []),
          signature(c),
        ],
      })
    }
  }
}
