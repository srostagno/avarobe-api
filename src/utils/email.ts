import type { FastifyBaseLogger } from 'fastify'

import { env } from '../config/env.js'
import { emailCopy } from '../i18n/emails.js'
import { isGuestEmail } from './guests.js'
import type { Locale } from './locale.js'

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email'

type EmailContent = { subject: string; html: string; text: string }

function isConfigured() {
  return Boolean(env.MAILERSEND_API_KEY && env.MAILERSEND_FROM_EMAIL)
}

// Production sends every email. Development only sends to the addresses in
// EMAIL_DEV_ALLOWLIST, so tests with made-up addresses don't bounce and hurt
// the sending domain; everyone else gets the link back in the response.
function shouldDeliver(email: string) {
  if (isGuestEmail(email)) {
    return false
  }

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

// Onboarding emails (modules/lifecycle). Throws when delivery fails so the
// caller can try again on its next run. Returns false when it didn't send
// (development, address not allowlisted).
export async function deliverEmail(input: {
  log: FastifyBaseLogger
  to: { email: string; name?: string }
  content: EmailContent
}) {
  if (!shouldDeliver(input.to.email)) {
    input.log.info({ email: input.to.email, subject: input.content.subject }, 'Dev email (not sent)')
    return false
  }

  await sendViaMailersend(input.to, input.content)

  return true
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

// The account emails below, in the reader's language (users.locale; the
// words are in i18n/emails.*.ts, under `auth`). English when missing.
function layout(input: {
  locale?: Locale
  subject: string
  firstName: string
  paragraphs: string[]
  cta?: { label: string; url: string }
  footer: string
}): EmailContent {
  const locale = input.locale ?? 'en'
  const copy = emailCopy(locale).auth
  const greeting = input.firstName ? copy.hi(escapeHtml(input.firstName)) : copy.hiAnonymous
  const body = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#3a3530;">${escapeHtml(paragraph)}</p>`,
    )
    .join('')
  const button = input.cta
    ? `<p style="margin:8px 0 24px 0;"><a href="${input.cta.url}" style="display:inline-block;background:#171412;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:14px;font-weight:600;">${escapeHtml(input.cta.label)}</a></p><p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#6b645c;">${escapeHtml(copy.pasteLink)}</p><p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;word-break:break-all;color:#171412;">${input.cta.url}</p>`
    : ''
  // English keeps its bare <html>; the other languages say theirs.
  const html = `<!doctype html><html${locale === 'en' ? '' : ` lang="${locale}"`}><body style="margin:0;padding:32px 16px;background:#f7f4ef;font-family:Helvetica,Arial,sans-serif;color:#171412;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5ded3;border-radius:16px;"><tr><td style="padding:32px;"><p style="margin:0 0 24px 0;font-family:Georgia,serif;font-size:22px;font-style:italic;">avarobe</p><p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${greeting}</p>${body}${button}<p style="margin:0;font-size:12px;line-height:1.5;color:#6b645c;">${escapeHtml(input.footer)}</p></td></tr></table></body></html>`
  const text = [
    input.firstName ? copy.hi(input.firstName) : copy.hiAnonymous,
    ...input.paragraphs,
    ...(input.cta ? [`${input.cta.label}: ${input.cta.url}`] : []),
    input.footer,
  ].join('\n\n')

  return { subject: input.subject, html, text }
}

export function verificationEmail(input: { firstName: string; url: string; forPasskey: boolean; locale?: Locale }) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.verification.subject,
    firstName: input.firstName,
    paragraphs: [input.forPasskey ? copy.verification.passkey : copy.verification.password, copy.linkOnce24h],
    cta: { label: copy.confirmEmail, url: input.url },
    footer: copy.verification.footer,
  })
}

// Right after someone who tried Avarobe first saves it with their email (no
// password): the link confirms the email and signs them back in.
export function savedEmail(input: { firstName: string; url: string; locale?: Locale }) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.saved.subject,
    firstName: input.firstName,
    paragraphs: copy.saved.paragraphs,
    cta: { label: copy.confirmEmail, url: input.url },
    footer: copy.saved.footer,
  })
}

// Signing in without a password: a one-time link, asked for on the sign-in
// page.
export function signInLinkEmail(input: { firstName: string; url: string; locale?: Locale }) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.signIn.subject,
    firstName: input.firstName,
    paragraphs: [copy.signIn.intro, copy.linkOnce3d],
    cta: { label: copy.signIn.button, url: input.url },
    footer: copy.signIn.footer,
  })
}

// Asked for from Instagram's or Facebook's in-app browser: the mail app opens
// the link in the phone's own browser, signed in.
export function continueInBrowserEmail(input: { firstName: string; url: string; locale?: Locale }) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.continueInBrowser.subject,
    firstName: input.firstName,
    paragraphs: [copy.continueInBrowser.intro, copy.linkOnce3d],
    cta: { label: copy.continueInBrowser.button, url: input.url },
    footer: copy.continueInBrowser.footer,
  })
}

export function passwordResetEmail(input: { firstName: string; url: string; locale?: Locale }) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.passwordReset.subject,
    firstName: input.firstName,
    paragraphs: copy.passwordReset.paragraphs,
    cta: { label: copy.passwordReset.button, url: input.url },
    footer: copy.passwordReset.footer,
  })
}

export function passwordChangedEmail(input: { firstName: string; resetUrl: string; locale?: Locale }) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.passwordChanged.subject,
    firstName: input.firstName,
    paragraphs: [copy.passwordChanged.intro],
    cta: { label: copy.passwordChanged.button, url: input.resetUrl },
    footer: copy.nothingElse,
  })
}

export function passkeyAddedEmail(input: {
  firstName: string
  deviceName: string
  accountUrl: string
  locale?: Locale
}) {
  const copy = emailCopy(input.locale).auth

  return layout({
    locale: input.locale,
    subject: copy.passkeyAdded.subject,
    firstName: input.firstName,
    paragraphs: [copy.passkeyAdded.added(input.deviceName), copy.passkeyAdded.notYou],
    cta: { label: copy.passkeyAdded.button, url: input.accountUrl },
    footer: copy.nothingElse,
  })
}
