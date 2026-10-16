import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import type { PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { emailLink } from '../../utils/auth-links.js'
import { deliverLinkEmail } from '../../utils/email.js'
import { isGuestEmail } from '../../utils/guests.js'
import { appUrl, isLocale } from '../../utils/locale.js'
import { trackServerEvent } from '../analytics/service.js'
import { claimGuest } from '../auth/guests.js'
import { shortProductName } from '../lifecycle/checkout-link.js'
import { trackContent, unsubscribeUrl } from '../lifecycle/service.js'
import { purchaseInAccountEmail } from '../lifecycle/templates.js'
import { avarobeUserId, PRODUCTS, sessionSettled } from './stripe.js'

// A guest pays without our email step first (Oct 7-10: 1 in 4 of those who
// tapped Buy left at it, and Stripe asks for the email anyway): the account
// takes the email from the paid checkout, as if they had saved it there.
// When the email already has an account, the purchase stays on the guest
// (it's theirs on this device), and since Oct 16, 2026 it's unlocked in that
// account too (shareWithEmailOwner): a buyer who came back signed out paid
// as a guest with her own email, signed in, didn't find her Color Advisor
// and paid for it again.

export type GuestClaim = { status: 'claimed' } | { status: 'taken'; ownerId: ObjectId } | null

export async function claimGuestFromSession(app: FastifyInstance, session: Stripe.Checkout.Session): Promise<GuestClaim> {
  const userId = avarobeUserId(session.metadata)
  const email = session.customer_details?.email?.trim().toLowerCase()

  if (!userId || !email || isGuestEmail(email) || !sessionSettled(session)) {
    return null
  }

  const user = await app.collections.users.findOne({ _id: userId }, { projection: { guest: 1, purchaseSharedWith: 1 } })

  if (!user?.guest) {
    // Claimed by an earlier call (the success page and the webhook both
    // come here), or its email belonged to an account then.
    return user?.purchaseSharedWith ? { status: 'taken', ownerId: user.purchaseSharedWith } : null
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

  if (result.ok) {
    return { status: 'claimed' }
  }

  const owner = result.reason === 'email_taken' ? await app.collections.users.findOne({ email }, { projection: { _id: 1, guest: 1 } }) : null

  if (!owner || owner.guest || owner._id.equals(userId)) {
    return null
  }

  await app.collections.users.updateOne({ _id: userId }, { $set: { purchaseSharedWith: owner._id } })

  return { status: 'taken', ownerId: owner._id }
}

// What a one-time purchase unlocks, set on the account that owns the
// checkout's email (what it already had stays as it was).
export function ownerUnlocks(product: PurchaseProduct, owner: Pick<UserDocument, 'colorReportAt' | 'styleReportAt' | 'hairAdvisorAt' | 'colorMirrorAt'>, now: Date) {
  const unlocks = PRODUCTS[product]?.unlocks

  if (!unlocks) {
    return null
  }

  return {
    ...(unlocks.color ? { colorReportAt: owner.colorReportAt ?? now } : {}),
    ...(unlocks.style ? { styleReportAt: owner.styleReportAt ?? now } : {}),
    ...(unlocks.hair ? { hairAdvisorAt: owner.hairAdvisorAt ?? now } : {}),
    ...(unlocks.mirror ? { colorMirrorAt: owner.colorMirrorAt ?? now } : {}),
  }
}

// Where the email's link signs them in: what they bought.
export function ownerPage(product: PurchaseProduct) {
  if (product === 'color_mirror') {
    return '/studio/mirror'
  }

  if (product === 'hair_advisor') {
    return '/studio/hair'
  }

  return '/studio/report'
}

// The guest's one-time purchase, unlocked in the account its email belongs
// to (the advisors and the mirror; looks, events and magazines stay on the
// guest, so nothing is counted twice), once per checkout, with an email
// that signs them in on it. The purchase itself stays the guest's record.
export async function shareWithEmailOwner(app: FastifyInstance, session: Stripe.Checkout.Session, ownerId: ObjectId, now = new Date()) {
  const guestId = avarobeUserId(session.metadata)
  const product = session.metadata?.product as PurchaseProduct | undefined

  if (!guestId || !product || session.mode !== 'payment' || !sessionSettled(session)) {
    return false
  }

  const owner = await app.collections.users.findOne({ _id: ownerId })
  const unlocks = owner ? ownerUnlocks(product, owner, now) : null

  if (!owner || !unlocks || Object.keys(unlocks).length === 0) {
    return false
  }

  const shared = await app.collections.users.updateOne(
    { _id: ownerId, 'sharedPurchases.sessionId': { $ne: session.id } },
    {
      $set: { ...unlocks, paidAt: owner.paidAt ?? now, updatedAt: now },
      $push: { sharedPurchases: { sessionId: session.id, product, fromUserId: guestId, at: now } },
    },
  )

  if (shared.modifiedCount === 0) {
    return false
  }

  void trackServerEvent(app, { name: 'guest_purchase_shared', userId: ownerId, props: { product } })

  try {
    await sendPurchaseInAccount(app, owner, product, now)
  } catch (error) {
    app.log.warn({ err: error instanceof Error ? error.message : String(error), product }, 'Purchase-in-account email failed')
  }

  return true
}

async function sendPurchaseInAccount(app: FastifyInstance, owner: UserDocument, product: PurchaseProduct, now: Date) {
  const locale = owner.locale ?? 'en'
  const sendId = new ObjectId()
  // The page; the click signs them in (lifecycle clickDestination).
  const url = appUrl(locale, ownerPage(product))
  const content = purchaseInAccountEmail({
    firstName: owner.firstName,
    email: owner.email,
    unsubscribeUrl: unsubscribeUrl(owner._id, sendId, locale),
    locale,
    name: shortProductName(product, locale),
    url,
  })

  await app.collections.emailSends.insertOne({
    _id: sendId,
    userId: owner._id,
    kind: 'purchase_in_account',
    subject: content.subject,
    sentAt: now,
    opens: 0,
    clicks: 0,
    // No ad ids, as its sign-in link had none.
    ads: null,
  })

  await deliverLinkEmail({
    log: app.log,
    to: { email: owner.email, name: owner.firstName },
    // Only for development, where nothing is sent: a link that signs in.
    link: await emailLink(app, owner, ownerPage(product)),
    content: trackContent(content, sendId),
  })
}

// "MARIA DA SILVA" on the card → "Maria".
export function firstNameFrom(name: string | null | undefined) {
  const first = name?.trim().split(/\s+/)[0] ?? ''
  return first ? first.charAt(0).toLocaleUpperCase() + first.slice(1).toLocaleLowerCase() : ''
}
