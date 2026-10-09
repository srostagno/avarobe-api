import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import type { PurchaseProduct, UserDocument } from '../../types/mongo.js'
import { createLink, linkSentRecently, type LinkAdIds } from '../../utils/auth-links.js'
import { deliverLinkEmail } from '../../utils/email.js'
import { isGuestEmail } from '../../utils/guests.js'
import type { Locale } from '../../utils/locale.js'
import { trackServerEvent } from '../analytics/service.js'
import { regionForCountry } from '../billing/pricing.js'
import { productCopy } from '../billing/stripe.js'
import { trackContent, unsubscribeUrl } from './service.js'
import { checkoutLinkEmail } from './templates.js'

// Buy, tapped inside Instagram's or Facebook's browser on a phone: those
// browsers have no Apple Pay or Google Pay, and the jump to Safari or
// Chrome fails about half the time (Oct 5-9: 7 in 10 paid when it worked,
// 2 in 10 on the card form left behind). So the web asks for this email
// the moment the jump doesn't happen: one tap in the mail app opens their
// checkout in the phone's own browser, signed in, with the wallet. Nobody
// used the "email me the link" button in those days; sent unasked, the
// link is already in their inbox.

// One per product this often: tapping Buy again, or another advisor and
// back, doesn't fill their inbox.
export const CHECKOUT_LINK_EVERY_MS = 6 * 60 * 60 * 1000

const WALLET = { ios: 'Apple Pay', android: 'Google Pay' } as const
const APP_NAME = { instagram: 'Instagram', facebook: 'Facebook' } as const

export type CheckoutLinkInput = {
  product: PurchaseProduct
  // Where they tapped Buy (first-party analytics), e.g. colors_home.
  placement: string
  os: 'ios' | 'android'
  // Which app's browser, when the web could tell.
  app?: 'instagram' | 'facebook'
  // That browser's ad ids, so the purchase still reaches Meta.
  ads?: LinkAdIds
}

export type CheckoutLinkResult = { status: 'sent' | 'recent' | 'unsent'; devLink?: string }

// "Color Advisor", "Asesor de Color", "Avarobe Pro": the product's name
// without the brand in front or the note in brackets.
export function shortProductName(product: PurchaseProduct, locale: Locale = 'en') {
  return productCopy(product, locale)
    .name.replace(/\s*\([^)]*\)$/, '')
    .replace(/^Avarobe (?!Pro)/, '')
}

export async function sendCheckoutLink(
  app: FastifyInstance,
  user: UserDocument,
  input: CheckoutLinkInput,
  now = new Date(),
): Promise<CheckoutLinkResult> {
  if (isGuestEmail(user.email)) {
    return { status: 'unsent' }
  }

  const field = `checkoutLinkEmails.${input.product}`
  const previous = user.checkoutLinkEmails?.[input.product] ?? null
  const since = new Date(now.getTime() - CHECKOUT_LINK_EVERY_MS)

  if ((previous && previous > since) || linkSentRecently(user, 'checkout')) {
    return { status: 'recent' }
  }

  // Claimed before sending, so a double tap (or two tabs) sends one.
  const claimed = await app.collections.users.updateOne(
    { _id: user._id, $or: [{ [field]: { $exists: false } }, { [field]: { $lte: since } }] },
    { $set: { [field]: now } },
  )

  if (claimed.modifiedCount === 0) {
    return { status: 'recent' }
  }

  const sendId = new ObjectId()
  const locale = user.locale ?? 'en'

  try {
    const url = await createLink(app, user, 'checkout', undefined, {
      next: `/studio?buy=${input.product}&from=${input.placement}`,
      ads: input.ads,
    })
    const content = checkoutLinkEmail({
      firstName: user.firstName,
      email: user.email,
      unsubscribeUrl: unsubscribeUrl(user._id, sendId, locale),
      locale,
      region: regionForCountry(user.location?.country),
      product: input.product,
      name: shortProductName(input.product, locale),
      url,
      wallet: WALLET[input.os],
      app: input.app ? APP_NAME[input.app] : null,
    })

    await app.collections.emailSends.insertOne({
      _id: sendId,
      userId: user._id,
      kind: 'checkout_link',
      subject: content.subject,
      sentAt: now,
      opens: 0,
      clicks: 0,
    })

    const result = await deliverLinkEmail({
      log: app.log,
      to: { email: user.email, name: user.firstName },
      link: url,
      content: trackContent(content, sendId),
    })
    void trackServerEvent(app, {
      name: 'checkout_email_sent',
      userId: user._id,
      props: { product: input.product, placement: input.placement, os: input.os, app: input.app ?? 'unknown', delivered: result.sent },
    })

    return { status: result.sent ? 'sent' : 'unsent', ...(result.devLink ? { devLink: result.devLink } : {}) }
  } catch (error) {
    app.log.error({ err: error, userId: user._id.toString() }, 'Checkout link email failed')
    await Promise.all([
      app.collections.emailSends.deleteOne({ _id: sendId }),
      app.collections.users.updateOne({ _id: user._id }, previous ? { $set: { [field]: previous } } : { $unset: { [field]: '' } }),
    ])
    return { status: 'unsent' }
  }
}
