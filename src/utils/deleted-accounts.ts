import { createHash } from 'node:crypto'

import type { ObjectId } from 'mongodb'

import { isGuestEmail } from './guests.js'

// A deleted account keeps its row (Oct 2026, me/delete-account.ts) with this
// alias for its email: unique like the user id it's made from, so the real
// address can sign up again, and on a reserved domain that can never receive
// mail (RFC 2606), so the mailer refuses it and nothing hashes it for ads.
export const DELETED_EMAIL_DOMAIN = 'deleted.avarobe.invalid'

export function deletedEmail(userId: ObjectId) {
  return `deleted-${userId.toString()}@${DELETED_EMAIL_DOMAIN}`
}

export function isDeletedEmail(email: string) {
  return email.toLowerCase().endsWith(`@${DELETED_EMAIL_DOMAIN}`)
}

// Not someone's address: a guest's placeholder or a deleted account's alias.
export function isPlaceholderEmail(email: string) {
  return isGuestEmail(email) || isDeletedEmail(email)
}

// sha256 of an email, trimmed and lowercased: kept on refund requests and on
// a deleted account (`emailHash`) to recognize the same person later.
export function emailHash(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}
