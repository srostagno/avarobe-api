import { env } from '../config/env.js'

const MAILERSEND_URL = 'https://api.mailersend.com/v1/email'

export function canSendEmail() {
  return Boolean(env.MAILERSEND_API_KEY && env.MAILERSEND_FROM_EMAIL)
}

export async function sendTransactionalEmail(input: {
  to: { email: string; name?: string }
  subject: string
  html: string
  text: string
}) {
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
      to: [{ email: input.to.email, name: input.to.name || input.to.email }],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`MailerSend responded ${response.status}: ${detail.slice(0, 300)}`)
  }
}

export function buildLoginLinkEmail(input: { firstName: string; loginUrl: string }) {
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hi,'
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f7f4ef;font-family:Helvetica,Arial,sans-serif;color:#171412;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e1d8;border-radius:16px;"><tr><td style="padding:32px;"><p style="margin:0 0 24px 0;font-family:Georgia,serif;font-size:22px;font-style:italic;">avarobe</p><p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">${greeting}</p><p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a443e;">Tap the button to sign in. The link works once and expires in 30 minutes.</p><p style="margin:0 0 24px 0;"><a href="${input.loginUrl}" style="display:inline-block;background:#171412;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:14px;font-weight:600;">Sign in to Avarobe</a></p><p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#6b645c;">Or paste this link into your browser:</p><p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;word-break:break-all;color:#171412;">${input.loginUrl}</p><p style="margin:0;font-size:12px;line-height:1.5;color:#6b645c;">Didn't ask for this? You can ignore this email.</p></td></tr></table></body></html>`
  const text = [
    greeting,
    'Use this link to sign in to Avarobe. It works once and expires in 30 minutes.',
    input.loginUrl,
    "Didn't ask for this? You can ignore this email.",
  ].join('\n\n')

  return { subject: 'Your Avarobe sign-in link', html, text }
}
