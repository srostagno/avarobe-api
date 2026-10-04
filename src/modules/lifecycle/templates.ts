import { env } from '../../config/env.js'
import type { ColorSwatch, LifecycleEmailKind } from '../../types/mongo.js'
import type { CrossSellKind } from './cross-sell.js'

// The onboarding emails. Email clients only reliably render tables and
// inline styles, so the layout is built that way; every block also has a
// plain-text version for the text part of the message.

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

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

// Links back to the app, tagged so analytics can tell which email brought
// the visit.
export function appLink(path: string, campaign: LifecycleEmailKind, params: Record<string, string> = {}) {
  const url = new URL(path, `${env.APP_URL}/`)

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  url.searchParams.set('utm_source', 'email')
  url.searchParams.set('utm_medium', 'lifecycle')
  url.searchParams.set('utm_campaign', campaign)

  return url.toString()
}

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

// A video's poster, linked to the page that plays it (mail can't play video):
// a play badge on the picture and a line under it.
function videoLink(poster: string, label: string, url: string): Block {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td><a href="${esc(url)}" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding:0 14px 0 0;"><img src="${esc(poster)}" width="96" height="120" alt="" style="display:block;width:96px;height:120px;border-radius:12px;object-fit:cover;"></td><td valign="middle" style="font-family:${SANS};font-size:15px;line-height:21px;font-weight:600;color:${COLOR.ink};">&#9654;&nbsp; ${esc(label)}<br><span style="font-weight:400;font-size:14px;color:${COLOR.muted};">Everything inside, shown on an example</span></td></tr></table></a></td></tr></table>`,
    text: `${label}: ${url}`,
  }
}

function steps(items: { title: string; body: string; done?: boolean }[]): Block {
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
    text: items.map((item, index) => `${item.done ? '[done]' : `${index + 1}.`} ${item.title}: ${item.body}`).join('\n'),
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
// it shows even with images off.
function palette(season: string, colors: ColorSwatch[], caption: string): Block {
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
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td bgcolor="${COLOR.ivory}" style="border-radius:16px;padding:20px 20px 16px 20px;"><p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${COLOR.muted};">Your season</p><p style="margin:0 0 14px 0;font-family:${SERIF};font-size:26px;line-height:32px;font-style:italic;color:${COLOR.accent};">${esc(season)}</p>${strip}<p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:19px;color:${COLOR.muted};">${esc(caption)}</p></td></tr></table>`,
    text: `Your season: ${season}${shown.length ? ` (${shown.map((color) => color.name).join(', ')})` : ''}. ${caption}`,
  }
}

// Under the season card: what they've seen, or (no colors before they pay)
// what's waiting.
function paletteCaption(colors: ColorSwatch[]) {
  return colors.length
    ? `You’ve seen ${colors.length} of your colors. Your full palette has 30+, with your neutrals and the ones to keep away from your face.`
    : 'Your best colors, your #1 and 30+ more, with your neutrals and the ones to keep away from your face, are in your Color Advisor.'
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

function note(text: string): Block {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td bgcolor="${COLOR.accentSoft}" style="border-radius:14px;padding:16px 18px;font-family:${SANS};font-size:14px;line-height:21px;color:${COLOR.accent};">${esc(text)}</td></tr></table>`,
    text: `Tip: ${text}`,
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
function products(rows: { name: string; price: string; detail: string; url: string }[]): Block {
  const html = rows
    .map(
      (row) =>
        `<tr><td style="padding:0 0 12px 0;border-bottom:1px solid ${COLOR.line};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="padding:12px 0 0 0;font-family:${SANS};font-size:15px;line-height:21px;font-weight:600;color:${COLOR.ink};">${esc(row.name)}</td><td valign="top" align="right" style="padding:12px 0 0 0;font-family:${SERIF};font-size:17px;line-height:21px;color:${COLOR.ink};white-space:nowrap;">${esc(row.price)}</td></tr><tr><td colspan="2" style="padding:3px 0 0 0;font-family:${SANS};font-size:14px;line-height:20px;color:${COLOR.muted};">${esc(row.detail)} <a href="${esc(row.url)}" style="color:${COLOR.accent};font-weight:600;text-decoration:underline;">What’s inside</a></td></tr></table></td></tr>`,
    )
    .join('')

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">${html}</table>`,
    text: rows.map((row) => `- ${row.name}, ${row.price}: ${row.detail} ${row.url}`).join('\n'),
  }
}

function signature(): Block {
  return {
    html: `<p style="margin:8px 0 0 0;font-family:${SANS};font-size:15px;line-height:24px;color:${COLOR.inkSoft};">See you inside,<br><span style="font-family:${SERIF};font-size:17px;font-style:italic;color:${COLOR.ink};">The Avarobe team</span></p>`,
    text: 'See you inside,\nThe Avarobe team',
  }
}

// ---------------------------------------------------------------- layout

type Recipient = { firstName: string; email: string; unsubscribeUrl: string }

function greeting(firstName: string): Block {
  return paragraph(firstName.trim() ? `Hi ${firstName.trim()},` : 'Hi there,')
}

function footer(recipient: Recipient, promotional: boolean, receipt?: string): Block {
  const link = (label: string, url: string) =>
    `<a href="${esc(url)}" style="color:${COLOR.muted};text-decoration:underline;">${esc(label)}</a>`

  // A purchase delivery, maybe to someone without an account.
  if (receipt) {
    const why = `You're receiving this because you bought ${receipt} on avarobe.com with ${recipient.email}.`
    const help = 'Questions or trouble downloading? Write to hello@avarobe.com.'
    const address = env.EMAIL_POSTAL_ADDRESS
    return {
      html: [
        esc(why),
        `Questions or trouble downloading? Write to ${link('hello@avarobe.com', 'mailto:hello@avarobe.com')}.`,
        `Avarobe &middot; Your AI stylist &middot; ${link('avarobe.com', env.APP_URL)}`,
        ...(address ? [esc(address)] : []),
      ]
        .map((line) => `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${COLOR.muted};">${line}</p>`)
        .join(''),
      text: [why, help, env.APP_URL, ...(address ? [address] : [])].join('\n'),
    }
  }

  const preferences = `${env.APP_URL}/studio/account`
  const address = env.EMAIL_POSTAL_ADDRESS
  const lines = [
    `You're receiving this because you created an Avarobe account with ${esc(recipient.email)}.`,
    `${link('Email preferences', preferences)} &nbsp;&middot;&nbsp; ${link('Unsubscribe from tips and reminders', recipient.unsubscribeUrl)}`,
    `Avarobe &middot; Your AI stylist &middot; ${link('avarobe.com', env.APP_URL)}`,
    ...(promotional && address ? [esc(address)] : []),
  ]

  return {
    html: lines
      .map(
        (line) =>
          `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${COLOR.muted};">${line}</p>`,
      )
      .join(''),
    text: [
      `You're receiving this because you created an Avarobe account with ${recipient.email}.`,
      `Email preferences: ${preferences}`,
      `Unsubscribe from tips and reminders: ${recipient.unsubscribeUrl}`,
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
  const foot = footer(input.recipient, input.promotional ?? false, input.receipt)
  // Invisible filler after the preheader, so inbox previews don't run into
  // the body text.
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60)
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
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
<tr><td class="px" style="padding:0 8px 18px 8px;"><a href="${esc(env.APP_URL)}" style="font-family:${SERIF};font-size:30px;line-height:34px;font-style:italic;color:${COLOR.ink};text-decoration:none;">avarobe</a></td></tr>
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

  const { stage, season } = input
  const name = input.firstName.trim()
  const cta =
    stage === 'new'
      ? button('Create my avatar', appLink('/studio/avatar', 'welcome'))
      : stage === 'avatar'
        ? button('Style my first occasion', appLink('/studio/new', 'welcome'))
        : button('Open my looks', appLink('/studio', 'welcome'))

  return layout({
    subject: name ? `Welcome to Avarobe, ${name}` : 'Welcome to Avarobe',
    preheader: 'Your personal stylist is ready: outfits for your next occasion, in your colors, on you.',
    hero: { src: `${ASSETS}/welcome-hero.jpg`, alt: 'Before and after: the outfit Avarobe planned for her daughter’s wedding' },
    recipient: input,
    blocks: [
      eyebrow('Welcome to Avarobe'),
      heading('See what to wear. On\u00a0you.'),
      greeting(input.firstName),
      paragraph(
        'Thanks for joining. Tell Avarobe where you’re going, and it plans a complete outfit for the dress code, in the colors that suit you, and shows it on a full-body avatar that looks like you.',
      ),
      steps([
        {
          title: 'Create your avatar',
          body: stage === 'new' ? 'One selfie, plus your height and build. It takes about a minute.' : 'Done. Your avatar is ready.',
          done: stage !== 'new',
        },
        {
          title: 'Get your color season',
          body: season
            ? `Done. You’re a ${season}.`
            : 'Avarobe reads your undertone, depth and contrast from your selfie and names your season, free.',
          done: Boolean(season),
        },
        {
          title: 'Style your first occasion',
          body:
            stage === 'looks'
              ? 'Done. Your first looks are in your collections.'
              : `A wedding, an interview, a first date. Your first ${env.FREE_CREDITS} looks are free.`,
          done: stage === 'looks',
        },
      ]),
      cta,
      ...(stage === 'new'
        ? [note('For the most accurate colors, take your selfie facing a window in daylight, with no filter and little makeup.')]
        : []),
      ...(stage === 'looks'
        ? [
            paragraph(
              'Two things worth trying next: rate a look with “Love it” or “Not for me” so your stylist learns your taste, and remix a look you like in new colors or for another season.',
            ),
          ]
        : []),
      signature(),
    ],
  })
}

function colorsWelcomeEmail(input: Recipient & { season: string | null }): EmailContent {
  const { season } = input
  const name = input.firstName.trim()

  return layout({
    subject: name ? `Welcome to Avarobe, ${name}` : 'Welcome to Avarobe',
    preheader: 'Your colors from one selfie: your season, and the color that drains you, on your own face.',
    hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
    recipient: input,
    blocks: [
      eyebrow('Welcome to Avarobe'),
      heading('See your colors. On\u00a0you.'),
      greeting(input.firstName),
      paragraph(
        'Thanks for joining. One selfie is all Avarobe needs to read your undertone, contrast and season, and to show the color that drains you on your own face. Your Color Advisor adds your best colors, on you. Then Avarobe styles outfits in your colors, on an avatar that looks like you.',
      ),
      steps([
        {
          title: 'Get your color season',
          body: season ? `Done. You’re a ${season}.` : 'One selfie, about 15 seconds. Free.',
          done: Boolean(season),
        },
        {
          title: 'See the color to keep away from your face',
          body: season ? 'Done. It’s waiting in your studio.' : 'Your face in the color that drains you, from the same selfie.',
          done: Boolean(season),
        },
        {
          title: 'Create your avatar',
          body: 'A few quick answers, and every outfit shows up on you.',
          done: false,
        },
      ]),
      season
        ? button('See my colors', appLink('/studio', 'welcome'))
        : button('Find my colors', appLink('/studio/avatar', 'welcome', { mode: 'colors' })),
      ...(season
        ? []
        : [note('For the most accurate colors, take your selfie facing a window in daylight, with no filter and little makeup.')]),
      signature(),
    ],
  })
}

// `focus: 'colors'`: no selfie yet from someone who came for their colors,
// so it asks for the selfie their colors come from, not the measurements.
export function avatarNudgeEmail(input: Recipient & { focus?: 'colors' | null }): EmailContent {
  if (input.focus === 'colors') {
    return layout({
      subject: 'Your colors are one selfie away',
      preheader: 'About 15 seconds: your season, and your best and worst color on your own face.',
      hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
      recipient: input,
      blocks: [
        eyebrow('One step left'),
        heading('One selfie, and you’ll see your colors.'),
        greeting(input.firstName),
        paragraph('Avarobe reads your undertone, contrast and season from your face, then shows your best and worst color on you. For the best result:'),
        checklist([
          'Face a window in daylight, with no filter.',
          'Keep makeup light, so your natural coloring shows.',
          'Head and shoulders in the frame, no sunglasses or hat.',
        ]),
        button('Find my colors', appLink('/studio/avatar', 'avatar_nudge', { mode: 'colors' })),
        small('Your photo stays private. You can delete it, or your whole account, at any time from your account settings.'),
        signature(),
      ],
    })
  }

  return layout({
    subject: 'Your stylist is waiting for one selfie',
    preheader: 'It takes about a minute, and it’s what makes every look yours.',
    hero: { src: `${ASSETS}/avatar-flow.jpg`, alt: 'A selfie becomes a full-body avatar, then a styled look' },
    recipient: input,
    blocks: [
      eyebrow('One step left'),
      heading('One selfie, and your stylist can start.'),
      greeting(input.firstName),
      paragraph(
        'Your avatar is what lets Avarobe show outfits on you instead of on a model, and your selfie is how it reads your colors. For the best result:',
      ),
      checklist([
        'Face a window in daylight, with no filter.',
        'Keep makeup light, so your natural coloring shows.',
        'Add your height and build. A full-body photo, if you have one, gets the proportions even closer.',
      ]),
      button('Create my avatar', appLink('/studio/avatar', 'avatar_nudge')),
      small('Your photos stay private. You can delete them, or your whole account, at any time from your account settings.'),
      signature(),
    ],
  })
}

const OCCASIONS = ['Wedding guest', 'Job interview', 'Date night', 'Weekend brunch']

export function looksNudgeEmail(input: Recipient & { season: string | null; colors: ColorSwatch[] }): EmailContent {
  const { season, colors } = input

  return layout({
    subject: season ? `Your ${season} colors, ready to wear` : 'What’s your next occasion?',
    preheader: `Your first ${env.FREE_CREDITS} looks are free. Tell Avarobe where you’re going.`,
    hero: {
      src: `${ASSETS}/occasions.jpg`,
      alt: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends',
    },
    recipient: input,
    blocks: [
      eyebrow(`Your first ${env.FREE_CREDITS} looks are free`),
      heading('Where are you going next?'),
      greeting(input.firstName),
      ...(season && colors.length > 0 ? [palette(season, colors, 'Your looks are built around colors like these.')] : []),
      paragraph(
        'Type the occasion and anything that matters, like the venue, the weather or a color you love. Avarobe plans complete outfits for the dress code and shows each one on your avatar.',
      ),
      small('Start from one of these:'),
      chips(OCCASIONS.map((label) => ({ label, url: appLink('/studio/new', 'looks_nudge', { occasion: label }) }))),
      button('Style my first occasion', appLink('/studio/new', 'looks_nudge')),
      signature(),
    ],
  })
}

// ---------------------------------------------------------------- offers
// Out of free looks and nothing bought: the offer, then two reminders. They
// are promotional, so they carry the postal address, and each one says how
// Pro renews.

const perMonth = (yearCents: number) => money(Math.floor(yearCents / 12))

// The first-time offer: Pro for a few days at a small price, then monthly.
const trialPrice = () => money(env.PRICE_PRO_TRIAL_CENTS)
const TRIAL_CANCEL = () =>
  "Cancel anytime before your trial ends, in your account settings, and you won't be charged again."
const TRIAL_NOTE = () =>
  `${trialPrice()} today for ${env.PRO_TRIAL_DAYS} days, then ${money(env.PRICE_PRO_MONTHLY_CENTS)} a month until you cancel. ${TRIAL_CANCEL()}`
const TRIAL_FEATURES = () => [
  'Your full color report: every color that lights you up, on your own face',
  'Your style report: the cuts, necklines and haircuts that flatter you',
  `${env.PRO_TRIAL_CREDITS} looks for your occasions during the trial, then ${env.PRO_MONTHLY_CREDITS} every month, shown on you`,
  'Try on any outfit from a photo, and every haircut picked for you',
]

// The one-time alternatives to the trial.
const PLAN = {
  colorReport: () => ({ name: 'Color Advisor', price: money(env.PRICE_COLOR_REPORT_CENTS), detail: 'Your full palette and drape test, yours to keep' }),
  pack: () => ({ name: 'Look pack', price: money(env.PRICE_LOOK_PACK_CENTS), detail: `${env.LOOK_PACK_CREDITS} more looks. They never expire` }),
  proMonthly: () => ({
    name: 'Avarobe Pro',
    price: `${money(env.PRICE_PRO_MONTHLY_CENTS)}/mo`,
    detail: `${env.PRO_MONTHLY_CREDITS} looks a month on you, try-ons and every haircut, with your reports while you're on it. Cancel anytime`,
  }),
}

// With the trial off (PRO_TRIAL): the Color Advisor leads, once and yours to
// keep, and Pro monthly follows.
const REPORT_FEATURES = [
  'Your full palette: 30+ colors in basics, accents and statements',
  'A drape test: your face next to your best and worst colors',
  'Neutrals, whites and metals, tested on you',
  'Guides for prints, denim, makeup and eyewear',
]
const PRO_FEATURES = () => [
  `${env.PRO_MONTHLY_CREDITS} looks every month, planned for the dress code and shown on you`,
  'Try on any outfit from a photo, and every haircut picked for you',
  'Every piece of a look, found in stores',
  'Your color and style reports while you’re on Pro',
]
const RENEWAL_NOTE = 'Pro renews monthly until you cancel. Cancel anytime in your account settings.'
const reportOnce = () => `${money(env.PRICE_COLOR_REPORT_CENTS)}, once`

// Two offers. People who spent their free look get the looks one; people
// who came for their colors, and have seen them but made no look, get one
// that leads with their palette (`palette`).
export function upgradeOfferEmail(
  input: Recipient & { palette?: { season: string; colors: ColorSwatch[]; heroUrl?: string | null; url?: string } | null },
): EmailContent {
  if (input.palette) {
    return paletteOfferEmail({ ...input, palette: input.palette })
  }

  if (!env.PRO_TRIAL) {
    return layout({
      subject: 'Style every occasion on your calendar',
      preheader: `Avarobe Pro: ${env.PRO_MONTHLY_CREDITS} looks a month on you, try-ons and every haircut. ${money(env.PRICE_PRO_MONTHLY_CENTS)} a month, cancel anytime.`,
      hero: {
        src: `${ASSETS}/occasions.jpg`,
        alt: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends',
      },
      recipient: input,
      promotional: true,
      blocks: [
        eyebrow('Your free look is done'),
        heading('Style every occasion on your calendar.'),
        greeting(input.firstName),
        paragraph('Your stylist has more looks waiting for you. With Avarobe Pro:'),
        checklist(PRO_FEATURES()),
        priceBox(`${money(env.PRICE_PRO_MONTHLY_CENTS)} a month`, `${env.PRO_MONTHLY_CREDITS} looks every month.`, 'Cancel anytime in your account settings.'),
        button('Get Avarobe Pro', appLink('/studio', 'upgrade_offer', { upgrade: 'plan' })),
        small('Or pay once, no subscription:'),
        plans([PLAN.colorReport(), PLAN.pack()]),
        signature(),
      ],
    })
  }

  return layout({
    subject: `Try Avarobe Pro: ${env.PRO_TRIAL_DAYS} days for ${trialPrice()}`,
    preheader: `Your full color and style reports, looks for every occasion on you, try-ons and every haircut. ${trialPrice()} for ${env.PRO_TRIAL_DAYS} days.`,
    hero: {
      src: `${ASSETS}/occasions.jpg`,
      alt: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends',
    },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Your free look is done'),
      heading('Style every occasion on your calendar.'),
      greeting(input.firstName),
      paragraph(`Your stylist has more looks waiting for you. Try everything in Avarobe Pro for ${env.PRO_TRIAL_DAYS} days:`),
      checklist(TRIAL_FEATURES()),
      priceBox(`${trialPrice()} for ${env.PRO_TRIAL_DAYS} days`, `Then ${money(env.PRICE_PRO_MONTHLY_CENTS)} a month.`, TRIAL_CANCEL()),
      button(`Start my ${env.PRO_TRIAL_DAYS} days for ${trialPrice()}`, appLink('/studio', 'upgrade_offer', { upgrade: 'plan' })),
      small('Or pay once, no subscription:'),
      plans([PLAN.colorReport(), PLAN.pack()]),
      signature(),
    ],
  })
}

// Everything in the Color Advisor, as the app's offer lists it.
const COLOR_ADVISOR_FEATURES = [
  'Your best colors and your #1, on your own face',
  'Your full palette: 30+ colors in basics, accents and statements',
  'The live color mirror: 300+ fabrics on your face, each one marked yours, close or one to avoid',
  'Your drape test, your neutrals, gold or silver, your lip or shirt colors and your next hair color, side by side on you',
  'Outfits in your colors, color combinations and six practical guides',
  'Your color video, and five “does this color suit me?” checks for when you shop',
]

// What else Avarobe sells, for the end of the colors offer.
// What a color analysis costs with an analyst in person, for scale next to
// the price (as on the site, lib/color-advisor.ts).
const IN_PERSON_PRICE = '$150–$400'

const OTHER_PRODUCTS = (campaign: LifecycleEmailKind) => [
  { name: 'Style Advisor', price: `${money(env.PRICE_STYLE_REPORT_CENTS)} once`, detail: 'The cuts and necklines that flatter your body, tried on your avatar, with a fit guide and a capsule.', url: appLink('/advisors/style', campaign) },
  { name: 'Hair & Grooming Advisor', price: `${money(env.PRICE_HAIR_ADVISOR_CENTS)} once`, detail: 'Every haircut that suits your face, shown on you, with what to tell your stylist.', url: appLink('/advisors/hair', campaign) },
  { name: 'Event Stylist', price: `${money(env.PRICE_EVENT_CENTS)} an event`, detail: 'Three complete looks on you for your next event, every piece in stores.', url: appLink('/advisors/event', campaign) },
  { name: 'All three advisors', price: `${money(env.PRICE_ADVISORS_BUNDLE_CENTS)} once`, detail: 'Color, Style and Hair & Grooming together, for less.', url: appLink('/advisors', campaign) },
  { name: 'Avarobe Pro', price: `${money(env.PRICE_PRO_MONTHLY_CENTS)}/mo`, detail: `Your stylist all year: ${env.PRO_MONTHLY_CREDITS} looks a month on you and all three advisors. Cancel anytime.`, url: appLink('/advisors/pro', campaign) },
  { name: 'The Outfit Formula Book', price: money(env.PRICE_OUTFIT_GUIDE_CENTS), detail: '120 outfit combinations that always work, as a PDF.', url: appLink('/guide', campaign) },
]

// The colors offer, an hour after their colors came in (colors first, no
// look): their own photo with their best colors blurred (`heroUrl`), what
// the Color Advisor holds, a button that opens checkout signed in (`url`,
// a one-tap sign-in link), and the rest of what Avarobe sells.
function paletteOfferEmail(
  input: Recipient & { palette: { season: string; colors: ColorSwatch[]; heroUrl?: string | null; url?: string } },
): EmailContent {
  const { season, colors } = input.palette

  if (!env.PRO_TRIAL) {
    const price = money(env.PRICE_COLOR_REPORT_CENTS)
    const personal = Boolean(input.palette.heroUrl)
    const name = input.firstName.trim()
    const buyUrl = input.palette.url ?? appLink('/studio', 'upgrade_offer', { buy: 'color_report', from: 'email_colors' })

    // The full report, not "three colors": a price for three colors read as
    // too little for too much (Silvio, Oct 4).
    return layout({
      subject: name ? `${name}, your full color report is ready` : 'Your full color report is ready',
      preheader: `Everything a color analyst would tell you, on your own face: your best colors, 30+ colors, the live mirror and guides. ${price}, once.`,
      hero: personal
        ? {
            src: input.palette.heroUrl as string,
            alt: 'Your photo: three panels in your best colors, blurred until you open your Color Advisor, and one in the color that drains you',
          }
        : { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
      recipient: input,
      promotional: true,
      blocks: [
        eyebrow('Your full color report is ready'),
        heading(`You’re a ${season}.`),
        greeting(input.firstName),
        paragraph(
          personal
            ? 'Your full color report is made from your selfie: everything a color analyst would tell you, shown on your own face. That’s you above, in your best colors (blurred until you open it) and in the color that drains you.'
            : 'Your full color report is made from your selfie: everything a color analyst would tell you, shown on your own face.',
        ),
        ...(colors.length > 0 ? [palette(season, colors, paletteCaption(colors))] : []),
        eyebrow('What’s inside'),
        videoLink(`${VIDEOS}/color.jpg`, 'See what’s inside · 24 s', appLink('/advisors/color', 'upgrade_offer')),
        checklist(COLOR_ADVISOR_FEATURES),
        priceBox(`${price}, once`, `With a color analyst in person: ${IN_PERSON_PRICE}.`, 'One-time payment, no subscription. Yours to keep.'),
        button(`Get my full report · ${price}`, buyUrl),
        small('Opens your checkout, already signed in. Apple Pay, Google Pay or card.'),
        eyebrow('More from Avarobe'),
        products(OTHER_PRODUCTS('upgrade_offer')),
        small(RENEWAL_NOTE),
        signature(),
      ],
    })
  }

  return layout({
    subject: `Your full ${season} palette is waiting`,
    preheader: `Your best colors are waiting. See them on your own face: ${env.PRO_TRIAL_DAYS} days of Pro for ${trialPrice()}.`,
    hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Your colors'),
      heading('There’s more to your palette.'),
      greeting(input.firstName),
      palette(
        season,
        colors,
        paletteCaption(colors),
      ),
      paragraph(`See all of them on your own face, and try everything in Avarobe Pro for ${env.PRO_TRIAL_DAYS} days:`),
      checklist(TRIAL_FEATURES()),
      priceBox(`${trialPrice()} for ${env.PRO_TRIAL_DAYS} days`, `Then ${money(env.PRICE_PRO_MONTHLY_CENTS)} a month.`, TRIAL_CANCEL()),
      button(`Start my ${env.PRO_TRIAL_DAYS} days for ${trialPrice()}`, appLink('/studio', 'upgrade_offer', { upgrade: 'palette' })),
      small('Or pay once, no subscription:'),
      plans([{ ...PLAN.colorReport(), detail: 'Your full palette and drape test, yours to keep' }]),
      signature(),
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
  const price = money(env.PRICE_COLOR_REPORT_CENTS)
  const personal = Boolean(input.heroUrl)

  return layout({
    subject: `Your Color Advisor is now ${price}`,
    preheader: `We lowered the price. See your #1 color and your full palette on your own face: ${price}, once. No subscription.`,
    hero: personal
      ? {
          src: input.heroUrl as string,
          alt: 'Your photo: on the left your #1 color, blurred until you open your report; on the right, a color to keep away from your face',
        }
      : { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('A lower price'),
      heading(`Your #1 color, now ${price}.`),
      greeting(input.firstName),
      paragraph(
        personal
          ? 'We lowered the price of the Color Advisor. The blurred half of your photo is you in your #1 color, the shade that lights up your face. It’s ready in your report.'
          : 'We lowered the price of the Color Advisor. Your #1 color, the shade that lights up your face, is ready in your report.',
      ),
      ...(input.season && input.colors.length > 0
        ? [
            palette(
              input.season,
              input.colors,
              `You’ve seen ${input.colors.length} of your colors. Your full palette has 30+, with your neutrals and the ones to keep away from your face.`,
            ),
          ]
        : []),
      checklist(REPORT_FEATURES),
      priceBox(`${price}, once`, 'One-time payment, no subscription.', 'Yours to keep.'),
      button(`See my #1 color · ${price}`, input.url),
      signature(),
    ],
  })
}

export function upgradeReminderEmail(input: Recipient & { season: string | null; colors: ColorSwatch[] }): EmailContent {
  const { season, colors } = input

  return layout({
    subject: season ? `The rest of your ${season} palette` : 'The colors that light you up',
    preheader: 'Your full palette, a drape test on your own face and guides for everything you wear.',
    hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Your Color Advisor'),
      heading('See every color that lights you up.'),
      greeting(input.firstName),
      ...(season && colors.length > 0
        ? [palette(season, colors, `You’ve seen ${colors.length} of your colors. Your report shows all of them.`)]
        : []),
      paragraph('Your Color Advisor is a visual report made from your own photo, yours to keep:'),
      checklist([
        'Your full palette: 30+ colors in basics, accents and statements',
        'A drape test: your face next to your best and worst colors, like the one above',
        'The colors to keep away from your face, and your best metals',
        'Guides for prints, denim, makeup and eyewear',
      ]),
      ...(env.PRO_TRIAL
        ? [
            plans([
              {
                name: `Pro, ${env.PRO_TRIAL_DAYS} days`,
                price: trialPrice(),
                detail: `Your full color report, your style report and looks on you. Then ${money(env.PRICE_PRO_MONTHLY_CENTS)}/mo, cancel anytime`,
                badge: 'Try it',
              },
              { ...PLAN.colorReport(), detail: 'One time, yours to keep' },
            ]),
            small(TRIAL_NOTE()),
          ]
        : [plans([{ ...PLAN.colorReport(), detail: 'One time, yours to keep', badge: 'Start here' }, PLAN.proMonthly()]), small(RENEWAL_NOTE)]),
      button('See my full palette', appLink('/studio/report', 'upgrade_reminder', { upgrade: 'palette' })),
      signature(),
    ],
  })
}

export function upgradeLastCallEmail(input: Recipient): EmailContent {
  const reports = money(env.PRICE_REPORTS_BUNDLE_CENTS)

  if (!env.PRO_TRIAL) {
    return layout({
      subject: 'One last note about your colors',
      preheader: `Your full palette on your own face, ${reportOnce()}. This is our last reminder.`,
      hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
      recipient: input,
      promotional: true,
      blocks: [
        eyebrow('Our last reminder'),
        heading('Your full palette, on your own face.'),
        greeting(input.firstName),
        paragraph(
          'This is our last note about plans. Your Color Advisor shows every color that lights you up and the ones to keep away from your face, made from your own photo and yours to keep.',
        ),
        priceBox(reportOnce(), 'No subscription.', 'Yours to keep.'),
        button('See my full palette', appLink('/studio', 'upgrade_last_call', { upgrade: 'palette' })),
        small('Or style every occasion with Pro:'),
        plans([PLAN.proMonthly(), PLAN.pack()]),
        small(RENEWAL_NOTE),
        small('Not ready? Your avatar, your season and your looks stay in your account, and you can pick up anytime.'),
        signature(),
      ],
    })
  }

  return layout({
    subject: 'One last note about your stylist',
    preheader: `Everything in Pro for ${env.PRO_TRIAL_DAYS} days for ${trialPrice()}. This is our last reminder.`,
    hero: { src: `${ASSETS}/welcome-hero.jpg`, alt: 'Before and after: the outfit Avarobe planned for her daughter’s wedding' },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Our last reminder'),
      heading(`Everything in Pro, ${env.PRO_TRIAL_DAYS} days for ${trialPrice()}.`),
      greeting(input.firstName),
      paragraph(
        'This is our last note about plans. If Avarobe helped you dress for your first occasion, try your stylist for everything after it: your full color and style reports (' +
          reports +
          ' on their own), looks for every occasion on you, try-ons and every haircut.',
      ),
      priceBox(`${trialPrice()} for ${env.PRO_TRIAL_DAYS} days`, `Then ${money(env.PRICE_PRO_MONTHLY_CENTS)} a month.`, TRIAL_CANCEL()),
      button(`Start my ${env.PRO_TRIAL_DAYS} days for ${trialPrice()}`, appLink('/studio', 'upgrade_last_call', { upgrade: 'plan' })),
      small('Or pay once, no subscription:'),
      plans([PLAN.colorReport(), PLAN.pack()]),
      small('Not ready? Your avatar, your season and your looks stay in your account, and you can pick up anytime.'),
      signature(),
    ],
  })
}

// ---------------------------------------------------------------- rescue
// A checkout left unpaid (most often inside Instagram's or Facebook's own
// browser, where nobody has finished one): a sign-in link that opens their
// own browser where they left off. Promotional, so it carries the address.

const PRODUCT_NAMES: Record<string, string> = {
  color_report: 'Color Advisor',
  color_addon: 'Color Advisor',
  style_report: 'Style Advisor',
  style_addon: 'Style Advisor',
  reports_bundle: 'Color and Style Advisors',
  look_pack: 'looks',
  pro_monthly: 'Avarobe Pro',
  pro_annual: 'Avarobe Pro',
  pro_trial: 'Avarobe Pro',
  // Since 2-Oct the mirror comes with the Color Advisor.
  color_mirror: 'Color Advisor',
  hair_advisor: 'Hair & Grooming Advisor',
  advisors_bundle: 'three advisors',
  event_pass: 'Event Stylist',
  // "Your Personal Magazine is one step away".
  magazine: 'Personal Magazine',
}

// Names that read as plural: "Your three advisors are…".
const PLURAL_PRODUCTS = new Set(['look_pack', 'reports_bundle', 'advisors_bundle'])

export function checkoutRescueEmail(input: Recipient & { product: string; url: string }): EmailContent {
  const name = PRODUCT_NAMES[input.product] ?? 'purchase'
  const what = `Your ${name} ${PLURAL_PRODUCTS.has(input.product) ? 'are' : 'is'}`
  // The color hero for the color and style advisors; hair and events show
  // outfits for occasions.
  const report = /report|addon|reports_bundle|advisors_bundle|mirror/.test(input.product)

  return layout({
    subject: `${what} one step away`,
    preheader: 'Finish in your own browser, where Apple Pay and saved cards work.',
    hero: report
      ? { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' }
      : {
          src: `${ASSETS}/occasions.jpg`,
          alt: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends',
        },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Almost there'),
      heading(`${what} one step away.`),
      greeting(input.firstName),
      paragraph(
        'You started checking out but didn’t finish. If you were paying inside Instagram or Facebook, their browser often can’t use Apple Pay or a saved card. This link opens Avarobe in your own browser, already signed in, right where you left off.',
      ),
      button('Finish in my browser', input.url),
      small('The link works once and expires in 3 days.'),
      signature(),
    ],
  })
}

// ---------------------------------------------------------------- trial
// Pro trial notices. Transactional (billing terms), so they go out even to
// people who turned off tips, and carry no postal address.

const longDate = (date: Date) =>
  date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

export function trialStartedEmail(input: Recipient & { trialEnd: Date }): EmailContent {
  const end = longDate(input.trialEnd)
  const monthly = money(env.PRICE_PRO_MONTHLY_CENTS)

  return layout({
    subject: `Your ${env.PRO_TRIAL_DAYS} days of Avarobe Pro start now`,
    preheader: `Everything in Pro until ${end}. Then ${monthly} a month, or cancel anytime before.`,
    hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
    recipient: input,
    blocks: [
      eyebrow('Avarobe Pro trial'),
      heading(`Your stylist is all yours until ${end}.`),
      greeting(input.firstName),
      paragraph('Here’s what’s open for you now:'),
      checklist(TRIAL_FEATURES()),
      button('Open my studio', appLink('/studio', 'trial_started')),
      priceBox(
        `Then ${monthly} a month`,
        `Your plan renews on ${end} and every month after, until you cancel.`,
        `Today you paid ${trialPrice()}. Cancel anytime before ${end} in your account settings and you won't be charged again. We'll remind you two days before.`,
      ),
      small(`Manage or cancel your plan: ${env.APP_URL}/studio/account#plan`),
      signature(),
    ],
  })
}

export function trialEndingEmail(input: Recipient & { trialEnd: Date; looksLeft: number }): EmailContent {
  const end = longDate(input.trialEnd)
  const monthly = money(env.PRICE_PRO_MONTHLY_CENTS)

  return layout({
    subject: `Your Pro trial ends ${end}`,
    preheader: `Then ${monthly} a month for ${env.PRO_MONTHLY_CREDITS} new looks, your reports and more. Cancel before if you'd rather not.`,
    hero: { src: `${ASSETS}/occasions.jpg`, alt: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends' },
    recipient: input,
    blocks: [
      eyebrow('A reminder about your trial'),
      heading(`Your trial ends ${end}.`),
      greeting(input.firstName),
      paragraph(
        `On ${end} your Avarobe Pro plan renews at ${monthly} a month. Keep it and nothing changes: ${env.PRO_MONTHLY_CREDITS} new looks every month on you, your color and style reports, try-ons and every haircut.` +
          (input.looksLeft > 0 ? ` You still have ${input.looksLeft} look${input.looksLeft === 1 ? '' : 's'} to use.` : ''),
      ),
      button('Keep styling', appLink('/studio/new', 'trial_ending')),
      paragraph(
        `Rather not continue? Cancel in your account settings before ${end} and you won't be charged. Prefer a year? Pro annual is ${money(env.PRICE_PRO_ANNUAL_CENTS)} (${perMonth(env.PRICE_PRO_ANNUAL_CENTS)}/mo) and keeps both reports for good.`,
      ),
      small(`Manage or cancel your plan: ${env.APP_URL}/studio/account#plan`),
      signature(),
    ],
  })
}

// ---------------------------------------------------------------- products

// The Outfit Formula Book's delivery: the download link, for good.
export function outfitGuideEmail(input: { email: string; firstName: string; downloadUrl: string }): EmailContent {
  return layout({
    subject: 'Your Outfit Formula Book is here',
    preheader: '120 outfit formulas, ready to download. Your link works anytime.',
    hero: { src: `${env.APP_URL}/guide/cover-email.jpg`, alt: 'The Outfit Formula Book: 120 outfit combinations that always work' },
    recipient: { firstName: input.firstName, email: input.email, unsubscribeUrl: '' },
    receipt: 'The Outfit Formula Book',
    blocks: [
      eyebrow('The Outfit Formula Book'),
      heading('Your guide is ready.'),
      greeting(input.firstName),
      paragraph(
        'Thank you for your order. Your copy of The Outfit Formula Book is ready: 120 combinations that always work, the Color, Shape and Finish method, a color pairs cheat sheet and printable planners.',
      ),
      button('Download my guide (PDF)', input.downloadUrl),
      small('Save it to your phone or print it. This link is yours and works anytime, so keep this email.'),
      paragraph('Curious which of these colors are yours? Avarobe finds your color season from one selfie, free.'),
      button('Find my colors', `${env.APP_URL}/color-analysis?utm_source=guide&utm_medium=email&utm_campaign=outfit_formula_book`),
      signature(),
    ],
  })
}

// When their personal magazine is ready (modules/magazine): a link to read it.
export function magazineReadyEmail(input: { email: string; firstName: string; url: string }): EmailContent {
  return layout({
    subject: input.firstName ? `${input.firstName}, your magazine is ready` : 'Your magazine is ready',
    preheader: 'Your cover, a letter from your stylist and ten looks on you, on location.',
    hero: { src: `${env.APP_URL}/demo/magazine/email-hero.jpg`, alt: 'Two personal magazine covers made with Avarobe' },
    recipient: { firstName: input.firstName, email: input.email, unsubscribeUrl: '' },
    receipt: 'Your Personal Magazine',
    blocks: [
      eyebrow('Your Personal Magazine'),
      heading('Your issue is out.'),
      greeting(input.firstName),
      paragraph('Your magazine is ready: your own cover, a letter from your stylist, and ten looks on you, on location, with why each one works and the pieces to find.'),
      button('Read my magazine', input.url),
      small('Open it on your phone or computer. You can save it as a PDF from there and keep it.'),
      signature(),
    ],
  })
}

// ---------------------------------------------------------------- cross-sell
// Buyers: the next product they don't have (lifecycle/cross-sell.ts), one
// per email. They've paid, so their best colors can show (Color Advisor
// owners only). Promotional: postal address and unsubscribe in the footer.

export type CrossSellContent = {
  kind: CrossSellKind
  // The price on the button, and the regular one when it's the pair price.
  price: number
  regular: number | null
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
}

// The pair price ends during this day in the US (Pacific: the earliest
// date there), so the email never promises a day too many.
const endDay = (date: Date) =>
  date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })
const endWeekday = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })

const STYLE_FEATURES = [
  'Your style archetype, in words you can shop with',
  'Silhouettes and necklines tried on your own avatar, with the ones that flatter you marked',
  'A fit guide: the lengths, rises and waists that work on you',
  'A 12-piece capsule in your colors and shapes',
]
const HAIR_FEATURES = [
  'Your face shape and hair type, and what they mean for your cut',
  'Six haircuts picked for you, each one on your own photo',
  'The brief for your stylist, in salon words',
  'The hair colors that flatter your skin (or, for menswear, the beard styles that suit your jaw)',
]
const MAGAZINE_FEATURES = [
  'Your own cover, with your name as the masthead',
  'A letter from your stylist about your colors and shapes',
  'Ten looks on you, on location, one for each moment you pick',
  'Why each look works, and the pieces to find',
]
const EVENT_FEATURES = [
  'Three complete looks for its dress code, on you',
  'Every piece found in stores, at your budget',
  'Shoes, bags, hair and makeup to finish each look',
  'A checklist for the day',
]

const BUY_NOTE = 'Opens your checkout, already signed in. Apple Pay, Google Pay or card.'
const ONCE_NOTE = 'One-time payment, no subscription. Yours to keep.'

// What's coming up, for the Event Stylist (by the month in New York).
function upcomingEvents(now: Date) {
  const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric' }).format(now))

  switch (month) {
    case 10:
      return 'Halloween parties and fall weddings are coming up.'
    case 11:
      return 'Thanksgiving and the first holiday parties are coming up.'
    case 12:
      return 'Holiday parties and New Year’s Eve are coming up.'
    default:
      return 'A wedding, an interview, a night out?'
  }
}

export function crossSellEmail(input: Recipient & CrossSellContent): EmailContent {
  const price = money(input.price)
  const pair = input.regular !== null && input.until !== null
  const video = (id: string, seconds: number, path: string) =>
    videoLink(`${VIDEOS}/${id}.jpg`, `See what’s inside · ${seconds} s`, appLink(path, input.kind))
  const yourColors = (caption: string) => (input.season && input.colors.length > 0 ? [palette(input.season, input.colors, caption)] : [])
  // The other report at the pair price, or at its own.
  const reportPrice = (owned: string) =>
    pair
      ? priceBox(`${price}, once`, `Instead of ${money(input.regular!)}, because you have the ${owned}. Ends ${endDay(input.until!)}.`, ONCE_NOTE)
      : priceBox(`${price}, once`, 'For you, on your own photos.', ONCE_NOTE)
  const base = { recipient: input, promotional: true }

  switch (input.kind) {
    case 'xsell_style':
      return layout({
        ...base,
        subject: 'You know your colors. Now see your shapes.',
        preheader: `The Style Advisor tries silhouettes and necklines on your own avatar. ${pair ? `${price} instead of ${money(input.regular!)} for you, until ${endDay(input.until!)}.` : `${price}, once.`}`,
        hero: { src: `${ASSETS}/style.jpg`, alt: 'The same woman in a wrap dress and in straight trousers, side by side' },
        blocks: [
          eyebrow('Your next advisor'),
          heading('You know your colors. Now see your shapes.'),
          greeting(input.firstName),
          paragraph(
            'Your Color Advisor shows the colors that light up your face. The Style Advisor does the same for your body: it reads your proportions, then tries silhouettes and necklines on your own avatar, so you can see what flatters you and why.',
          ),
          ...yourColors('Your colors. The Style Advisor puts them into the cuts that suit you.'),
          video('style', 21, '/advisors/style'),
          checklist(STYLE_FEATURES),
          reportPrice('Color Advisor'),
          button(`Get my Style Advisor · ${price}`, input.url),
          small(BUY_NOTE),
          eyebrow('Get more from your colors'),
          chips([
            { label: 'My palette', url: appLink('/studio/report', input.kind) },
            { label: 'The color mirror', url: appLink('/studio/mirror', input.kind) },
            { label: 'Does this color suit me?', url: appLink('/studio/check', input.kind) },
          ]),
          signature(),
        ],
      })

    case 'xsell_color':
      return layout({
        ...base,
        subject: input.owns.style ? 'You know your shapes. Now find your colors.' : 'The colors that light up your face',
        preheader: `Everything a color analyst would tell you, from one selfie, shown on your own face. ${pair ? `${price} instead of ${money(input.regular!)} for you, until ${endDay(input.until!)}.` : `${price}, once.`}`,
        hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
        blocks: [
          eyebrow('Color Advisor'),
          heading(input.owns.style ? 'You know your shapes. Now find your colors.' : 'Find the colors that light up your face.'),
          greeting(input.firstName),
          paragraph(
            input.owns.style
              ? 'Your Style Advisor shows the shapes that flatter you. The Color Advisor finds the colors that light up your face, from one selfie, and shows every one of them on you.'
              : 'The Color Advisor finds your colors from one selfie: everything a color analyst would tell you, shown on your own face.',
          ),
          video('color', 24, '/advisors/color'),
          checklist(COLOR_ADVISOR_FEATURES),
          pair
            ? reportPrice('Style Advisor')
            : priceBox(`${price}, once`, `With a color analyst in person: ${IN_PERSON_PRICE}.`, ONCE_NOTE),
          button(`Get my Color Advisor · ${price}`, input.url),
          small(BUY_NOTE),
          signature(),
        ],
      })

    case 'xsell_addon_last_call': {
      const style = input.side !== 'color'
      const name = style ? 'Style Advisor' : 'Color Advisor'
      const owned = style ? 'Color Advisor' : 'Style Advisor'
      const regular = money(input.regular ?? (style ? env.PRICE_STYLE_REPORT_CENTS : env.PRICE_COLOR_REPORT_CENTS))
      const until = input.until ?? input.now

      return layout({
        ...base,
        subject: `Your ${name} at ${price} ends ${endWeekday(until)}`,
        preheader: `Because you have the ${owned}: ${price} instead of ${regular}, until ${endDay(until)}.`,
        hero: style
          ? { src: `${ASSETS}/style.jpg`, alt: 'The same woman in a wrap dress and in straight trousers, side by side' }
          : { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, camel, fuchsia and sage' },
        blocks: [
          eyebrow('Last call'),
          heading(`Your pair price ends ${endWeekday(until)}.`),
          greeting(input.firstName),
          paragraph(
            `Because you have the ${owned}, your ${name} is ${price} instead of ${regular}. That price ends ${endDay(until)}; after that it’s ${regular}.`,
          ),
          checklist(style ? STYLE_FEATURES : COLOR_ADVISOR_FEATURES.slice(0, 4)),
          button(`Get my ${name} · ${price}`, input.url),
          small(BUY_NOTE),
          signature(),
        ],
      })
    }

    case 'xsell_hair':
      return layout({
        ...base,
        subject: 'See your next haircut before you get it',
        preheader: `Six cuts picked for your face, on your own photo, and the hair colors that suit you. ${price}, once.`,
        hero: { src: `${ASSETS}/hair.jpg`, alt: 'The same woman with copper hair and with auburn hair, side by side' },
        blocks: [
          eyebrow('Hair & Grooming Advisor'),
          heading('See your next haircut before you get it.'),
          greeting(input.firstName),
          paragraph(
            input.season
              ? `Your hair frames your face as much as anything you wear. As a ${input.season}, some hair colors light you up and some wash you out. The Hair & Grooming Advisor reads your face shape and hair type from a selfie and shows the cuts and colors that suit you, on you.`
              : 'Your hair frames your face as much as anything you wear. The Hair & Grooming Advisor reads your face shape and hair type from a selfie and shows the cuts and hair colors that suit you, on you.',
          ),
          video('hair', 21, '/advisors/hair'),
          checklist(HAIR_FEATURES),
          priceBox(`${price}, once`, 'Every cut picked for you, on your own photo.', ONCE_NOTE),
          button(`Get my Hair & Grooming Advisor · ${price}`, input.url),
          small(BUY_NOTE),
          signature(),
        ],
      })

    case 'xsell_magazine':
      return layout({
        ...base,
        subject: input.firstName.trim() ? `${input.firstName.trim()}, you on the cover` : 'You, on the cover',
        preheader: `Your Personal Magazine: ten looks on you, on location, in your colors, with your own cover. ${price}, once.`,
        hero: { src: 'https://www.avarobe.com/demo/magazine/email-hero.jpg', alt: 'Two personal magazine covers made with Avarobe' },
        blocks: [
          eyebrow('Your Personal Magazine'),
          heading('A magazine about you, with you on the cover.'),
          greeting(input.firstName),
          paragraph(
            'Pick the moments of your season (brunch, a big day at work, a wedding, a trip) and we plan a look for each one and shoot it on you, on location. Then we write it up: your cover, a letter from your stylist and why every look works.',
          ),
          ...yourColors('Every look in your issue is planned in your colors.'),
          video('magazine', 19, '/advisors/magazine'),
          checklist(MAGAZINE_FEATURES),
          priceBox(`${price}, once`, 'One issue, about five minutes after you pick your moments.', ONCE_NOTE),
          button(`Make my magazine · ${price}`, input.url),
          small(BUY_NOTE),
          signature(),
        ],
      })

    case 'xsell_event':
      return layout({
        ...base,
        subject: 'What are you wearing to your next event?',
        preheader: `Three complete looks for its dress code, on you, with every piece in stores. ${price} an event.`,
        hero: {
          src: `${ASSETS}/occasions.jpg`,
          alt: 'The same woman styled by Avarobe for a wedding, an anniversary dinner and brunch with friends',
        },
        blocks: [
          eyebrow('Event Stylist'),
          heading('Never wonder what to wear to it again.'),
          greeting(input.firstName),
          paragraph(
            `${upcomingEvents(input.now)} Tell us the event, the dress code and your budget: you get three complete outfits shown on you, every piece findable in stores, and how to finish the look.`,
          ),
          video('event', 17, '/advisors/event'),
          checklist(EVENT_FEATURES),
          priceBox(`${price} an event`, 'Three complete looks for one event, on you.', 'One-time payment, no subscription.'),
          button(`Style my event · ${price}`, input.url),
          small(BUY_NOTE),
          signature(),
        ],
      })

    case 'xsell_guide':
      return layout({
        ...base,
        subject: '120 outfit formulas that always work',
        preheader: `The Outfit Formula Book: 120 combinations, the Color, Shape and Finish method and printable planners. A ${price} PDF, yours to keep.`,
        hero: { src: 'https://www.avarobe.com/guide/cover-email.jpg', alt: 'The Outfit Formula Book: 120 outfit combinations that always work' },
        blocks: [
          eyebrow('The Outfit Formula Book'),
          heading('Never stare at a full closet again.'),
          greeting(input.firstName),
          paragraph(
            input.season
              ? `Your ${input.season} palette tells you which colors are yours. The Outfit Formula Book shows how to put them together: 120 outfit combinations that always work, the Color, Shape and Finish method, a color pairs cheat sheet and printable planners.`
              : 'The Outfit Formula Book: 120 outfit combinations that always work, the Color, Shape and Finish method, a color pairs cheat sheet and printable planners.',
          ),
          video('guide', 15, '/guide'),
          priceBox(price, 'A PDF, yours to keep.', 'One-time payment. Instant download, and we email it to you too.'),
          button(`Get the book · ${price}`, input.url),
          signature(),
        ],
      })
  }
}
