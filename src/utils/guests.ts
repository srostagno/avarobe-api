import type { ObjectId } from 'mongodb'

// Guests (trying Avarobe before an account) have no email until they save.
// Their placeholder keeps the unique email index and every `user.email`
// working, on a reserved domain that can never receive mail (RFC 2606), and
// the mailer refuses it outright.
export const GUEST_EMAIL_DOMAIN = 'guest.avarobe.invalid'

export function guestEmail(userId: ObjectId) {
  return `${userId.toString()}@${GUEST_EMAIL_DOMAIN}`
}

export function isGuestEmail(email: string) {
  return email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`)
}
