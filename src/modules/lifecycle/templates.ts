import { env } from '../../config/env.js'
import type { ColorSwatch, LifecycleEmailKind } from '../../types/mongo.js'

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

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td bgcolor="${COLOR.ivory}" style="border-radius:16px;padding:20px 20px 16px 20px;"><p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${COLOR.muted};">Your season</p><p style="margin:0 0 14px 0;font-family:${SERIF};font-size:26px;line-height:32px;font-style:italic;color:${COLOR.accent};">${esc(season)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table><p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:19px;color:${COLOR.muted};">${esc(caption)}</p></td></tr></table>`,
    text: `Your season: ${season} (${colors
      .slice(0, 4)
      .map((color) => color.name)
      .join(', ')}). ${caption}`,
  }
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

function footer(recipient: Recipient, promotional: boolean): Block {
  const link = (label: string, url: string) =>
    `<a href="${esc(url)}" style="color:${COLOR.muted};text-decoration:underline;">${esc(label)}</a>`
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
}): EmailContent {
  const foot = footer(input.recipient, input.promotional ?? false)
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

export function welcomeEmail(input: Recipient & { stage: WelcomeStage; season: string | null }): EmailContent {
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
    hero: { src: `${ASSETS}/welcome-hero.jpg`, alt: 'Before and after: the outfit Avarobe planned for a cocktail wedding' },
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

export function avatarNudgeEmail(input: Recipient): EmailContent {
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
      alt: 'The same woman styled by Avarobe for a cocktail wedding, a job interview and a first date',
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
const RENEWAL_NOTE =
  'Pro renews automatically until you cancel, and you can cancel anytime in your account settings. Changed your mind? Write to hello@avarobe.com within 7 days of your first payment.'

function proPlans(): Block {
  return plans([
    {
      name: 'Pro annual',
      price: `${money(env.PRICE_PRO_ANNUAL_CENTS)}/yr`,
      detail: `${perMonth(env.PRICE_PRO_ANNUAL_CENTS)} a month, with your Color and Style Reports included`,
      badge: 'Best value',
    },
    { name: 'Pro monthly', price: `${money(env.PRICE_PRO_MONTHLY_CENTS)}/mo`, detail: 'Cancel anytime' },
    { name: 'Look pack', price: money(env.PRICE_LOOK_PACK_CENTS), detail: `${env.LOOK_PACK_CREDITS} more looks, no subscription` },
  ])
}

export function upgradeOfferEmail(input: Recipient): EmailContent {
  return layout({
    subject: `Your next ${env.PRO_MONTHLY_CREDITS} looks, for ${perMonth(env.PRICE_PRO_ANNUAL_CENTS)} a month`,
    preheader: `Avarobe Pro: ${env.PRO_MONTHLY_CREDITS} looks every month, try-ons from any photo, and your color and style reports.`,
    hero: {
      src: `${ASSETS}/occasions.jpg`,
      alt: 'The same woman styled by Avarobe for a cocktail wedding, a job interview and a first date',
    },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Your free looks are done'),
      heading('Style every occasion on your calendar.'),
      greeting(input.firstName),
      paragraph(`You’ve used your ${env.FREE_CREDITS} free looks. Avarobe Pro keeps your stylist working for everything coming up:`),
      checklist([
        `${env.PRO_MONTHLY_CREDITS} new looks every month, planned for the dress code and shown on you`,
        'Try on any outfit from a photo before you buy it',
        'Every piece of a look, found in stores',
        'Your Color Report and Style Report, included with the annual plan',
      ]),
      proPlans(),
      button('See my options', appLink('/studio', 'upgrade_offer', { upgrade: 'look' })),
      small(RENEWAL_NOTE),
      signature(),
    ],
  })
}

export function upgradeReminderEmail(input: Recipient & { season: string | null; colors: ColorSwatch[] }): EmailContent {
  const { season, colors } = input
  const bundleSavings = env.PRICE_COLOR_REPORT_CENTS + env.PRICE_STYLE_REPORT_CENTS - env.PRICE_REPORTS_BUNDLE_CENTS

  return layout({
    subject: season ? `The rest of your ${season} palette` : 'The colors that light you up',
    preheader: 'Your full palette, a drape test on your own face and guides for everything you wear.',
    hero: { src: `${ASSETS}/color-report.jpg`, alt: 'A drape test: the same face next to black, espresso, lavender and teal' },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Your Color Report'),
      heading('See every color that lights you up.'),
      greeting(input.firstName),
      ...(season && colors.length > 0
        ? [palette(season, colors, `You’ve seen ${colors.length} of your colors. Your report shows all of them.`)]
        : []),
      paragraph('Your Color Report is a visual report made from your own photo, yours to keep:'),
      checklist([
        'Your full palette: 30+ colors in basics, accents and statements',
        'A drape test: your face next to your best and worst colors, like the one above',
        'The colors to keep away from your face, and your best metals',
        'Guides for prints, denim, makeup and eyewear',
      ]),
      plans([
        { name: 'Color Report', price: money(env.PRICE_COLOR_REPORT_CENTS), detail: 'One time, yours to keep' },
        {
          name: 'Color + Style Reports',
          price: money(env.PRICE_REPORTS_BUNDLE_CENTS),
          detail: `Add the cuts and necklines that flatter you, and save ${money(bundleSavings)}`,
        },
        {
          name: 'Included with Pro annual',
          price: `${money(env.PRICE_PRO_ANNUAL_CENTS)}/yr`,
          detail: `Both reports and ${env.PRO_MONTHLY_CREDITS} looks every month`,
        },
      ]),
      button('Get my Color Report', appLink('/studio/report', 'upgrade_reminder', { upgrade: 'palette' })),
      signature(),
    ],
  })
}

export function upgradeLastCallEmail(input: Recipient): EmailContent {
  const reports = money(env.PRICE_REPORTS_BUNDLE_CENTS)

  return layout({
    subject: 'One last note about your stylist',
    preheader: `Pro annual: both reports and ${env.PRO_MONTHLY_CREDITS} looks a month for ${perMonth(env.PRICE_PRO_ANNUAL_CENTS)}. This is our last reminder.`,
    hero: { src: `${ASSETS}/welcome-hero.jpg`, alt: 'Before and after: the outfit Avarobe planned for a cocktail wedding' },
    recipient: input,
    promotional: true,
    blocks: [
      eyebrow('Our last reminder'),
      heading(`Everything, for ${perMonth(env.PRICE_PRO_ANNUAL_CENTS)} a month.`),
      greeting(input.firstName),
      paragraph(
        'This is our last note about plans. If Avarobe helped you dress for your first occasion, the annual plan is the simplest way to keep your stylist for every one after it.',
      ),
      priceBox(
        `${money(env.PRICE_PRO_ANNUAL_CENTS)} a year`,
        `${env.PRO_MONTHLY_CREDITS} looks every month, try-ons, stores, and both reports (${reports} on their own).`,
        RENEWAL_NOTE,
      ),
      button('Go Pro annual', appLink('/studio', 'upgrade_last_call', { upgrade: 'look' })),
      small('Not ready? Your avatar, your season and your looks stay in your account, and you can pick up anytime.'),
      signature(),
    ],
  })
}
