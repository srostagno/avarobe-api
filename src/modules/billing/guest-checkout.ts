import type { FastifyInstance } from 'fastify'
import type Stripe from 'stripe'

import { isGuestEmail } from '../../utils/guests.js'
import { isLocale } from '../../utils/locale.js'
import { trackServerEvent } from '../analytics/service.js'
import { claimGuest } from '../auth/guests.js'
import { avarobeUserId, sessionSettled } from './stripe.js'

// A guest pays without our email step first (Oct 7-10: 1 in 4 of those who
// tapped Buy left at it, and Stripe asks for the email anyway): the account
// takes the email from the paid checkout, as if they had saved it there.
// When the email already has an account, the purchase stays on the guest
// (it's theirs on this device) and it's counted, to see how often.
export async function claimGuestFromSession(app: FastifyInstance, session: Stripe.Checkout.Session) {
  const userId = avarobeUserId(session.metadata)
  const email = session.customer_details?.email?.trim().toLowerCase()

  if (!userId || !email || isGuestEmail(email) || !sessionSettled(session)) {
    return
  }

  const user = await app.collections.users.findOne({ _id: userId }, { projection: { guest: 1 } })

  if (!user?.guest) {
    return
  }

  const result = await claimGuest(app, userId, {
    email,
    firstName: firstNameFrom(session.customer_details?.name),
    locale: isLocale(session.metadata?.locale) ? session.metadata.locale : undefined,
  })

  void trackServerEvent(app, {
    name: result.ok ? 'guest_saved_at_checkout' : 'guest_checkout_email_taken',
    userId,
    props: { product: session.metadata?.product ?? 'unknown' },
  })
}

// "MARIA DA SILVA" on the card → "Maria".
export function firstNameFrom(name: string | null | undefined) {
  const first = name?.trim().split(/\s+/)[0] ?? ''
  return first ? first.charAt(0).toLocaleUpperCase() + first.slice(1).toLocaleLowerCase() : ''
}
