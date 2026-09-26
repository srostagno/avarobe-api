import type { FastifyBaseLogger } from 'fastify'

import { env } from '../config/env.js'

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email'

type EmailContent = { subject: string; html: string; text: string }

function isConfigured() {
  return Boolean(env.MAILERSEND_API_KEY && env.MAILERSEND_FROM_EMAIL)
}

// Production sends every email. Development only sends to the addresses in
// EMAIL_DEV_ALLOWLIST, so tests with made-up addresses don't bounce and hurt
// the sending domain; everyone else gets the link back in the response.
function shouldDeliver(email: string) {
  if (env.NODE_ENV === 'production') {
    return true
  }

  return isConfigured() && env.EMAIL_DEV_ALLOWLIST.includes(email.toLowerCase())
}

async function sendViaMailersend(to: { email: string; name?: string }, content: EmailContent) {
  if (!env.MAILERSEND_API_KEY || !env.MAILERSEND_FROM_EMAIL) {
    throw new Error('MailerSend is not configured on avarobe-api.')
  }

  const response = await fetch(MAILERSEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.MAILERSEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { email: env.MAILERSEND_FROM_EMAIL, name: env.MAILERSEND_FROM_NAME },
      to: [{ email: to.email, name: to.name || to.email }],
      subject: content.subject,
      html: content.html,
      text: content.text,
      // Tracking rewrites links through a redirect; one-time links must not.
      settings: { track_clicks: false, track_opens: false },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`MailerSend responded ${response.status}: ${detail.slice(0, 300)}`)
  }
}

export type DeliveryResult = { sent: boolean; devLink?: string }

// Sends an email that carries a one-time link. Throws when delivery fails so
// the caller can tell the person; in development (address not allowlisted)
// it hands the link back instead of sending.
export async function deliverLinkEmail(input: {
  log: FastifyBaseLogger
  to: { email: string; name?: string }
  link: string
  content: EmailContent
}): Promise<DeliveryResult> {
  if (!shouldDeliver(input.to.email)) {
    input.log.info({ email: input.to.email, link: input.link }, 'Dev email link (not sent)')
    return { sent: false, devLink: input.link }
  }

  await sendViaMailersend(input.to, input.content)

  return { sent: true }
}

// Security notices (password changed, passkey added). Best effort: a failed
// notice never blocks the action that triggered it.
export async function sendNotice(input: {
  log: FastifyBaseLogger
  to: { email: string; name?: string }
  content: EmailContent
}) {
  if (!shouldDeliver(input.to.email)) {
    input.log.info({ email: input.to.email, subject: input.content.subject }, 'Dev notice (not sent)')
    return
  }

  try {
    await sendViaMailersend(input.to, input.content)
  } catch (error) {
    input.log.error({ err: error, email: input.to.email }, 'Failed to send notice email')
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layout(input: {
  subject: string
  firstName: string
  paragraphs: string[]
  cta?: { label: string; url: string }
  footer: string
}): EmailContent {
  const greeting = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : 'Hi,'
  const body = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#3a3530;">${escapeHtml(paragraph)}</p>`,
    )
    .join('')
  const button = input.cta
    ? `<p style="margin:8px 0 24px 0;"><a href="${input.cta.url}" style="display:inline-block;background:#171412;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:14px;font-weight:600;">${escapeHtml(input.cta.label)}</a></p><p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#6b645c;">Or paste this link into your browser:</p><p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;word-break:break-all;color:#171412;">${input.cta.url}</p>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f7f4ef;font-family:Helvetica,Arial,sans-serif;color:#171412;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5ded3;border-radius:16px;"><tr><td style="padding:32px;"><p style="margin:0 0 24px 0;font-family:Georgia,serif;font-size:22px;font-style:italic;">avarobe</p><p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${greeting}</p>${body}${button}<p style="margin:0;font-size:12px;line-height:1.5;color:#6b645c;">${escapeHtml(input.footer)}</p></td></tr></table></body></html>`
  const text = [
    input.firstName ? `Hi ${input.firstName},` : 'Hi,',
    ...input.paragraphs,
    ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`] : []),
    input.footer,
  ].join('\n\n')

  return { subject: input.subject, html, text }
}

export function verificationEmail(input: { firstName: string; url: string; forPasskey: boolean }) {
  return layout({
    subject: 'Confirm your email for Avarobe',
    firstName: input.firstName,
    paragraphs: input.forPasskey
      ? [
          'Confirm this is your email to finish creating your Avarobe account. Right after, you will set up a passkey so you can sign in with Face ID, Touch ID or your device PIN.',
          'The link works once and expires in 24 hours.',
        ]
      : [
          'Confirm this is your email. It lets you add passkeys and recover your account if you forget your password.',
          'The link works once and expires in 24 hours.',
        ],
    cta: { label: 'Confirm my email', url: input.url },
    footer: "Didn't sign up for Avarobe? You can ignore this email.",
  })
}

export function passwordResetEmail(input: { firstName: string; url: string }) {
  return layout({
    subject: 'Reset your Avarobe password',
    firstName: input.firstName,
    paragraphs: [
      'We got a request to reset the password for this email. Choose a new one with the button below.',
      'The link works once and expires in 1 hour. Resetting signs you out everywhere and removes your passkeys, so you can add them again safely.',
    ],
    cta: { label: 'Choose a new password', url: input.url },
    footer: "Didn't ask for this? Ignore this email and your password stays the same.",
  })
}

export function passwordChangedEmail(input: { firstName: string; resetUrl: string }) {
  return layout({
    subject: 'Your Avarobe password was changed',
    firstName: input.firstName,
    paragraphs: ['The password for your Avarobe account was just changed.'],
    cta: { label: "Wasn't me: reset my password", url: input.resetUrl },
    footer: 'If this was you, there is nothing else to do.',
  })
}

export function passkeyAddedEmail(input: {
  firstName: string
  deviceName: string
  accountUrl: string
}) {
  return layout({
    subject: 'A passkey was added to your Avarobe account',
    firstName: input.firstName,
    paragraphs: [
      `A passkey for "${input.deviceName}" can now sign in to your Avarobe account.`,
      "If this wasn't you, remove it in your account settings and reset your password.",
    ],
    cta: { label: 'Review my passkeys', url: input.accountUrl },
    footer: 'If this was you, there is nothing else to do.',
  })
}
