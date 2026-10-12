import { createHash } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { env } from '../../config/env.js'
import { isPlaceholderEmail } from '../../utils/deleted-accounts.js'
import { errorMessage } from '../../utils/http.js'
import { isAdmin } from './entitlements.js'

// Purchases reported from the server, so ad blockers and iOS don't lose them:
// GA4 Measurement Protocol and Meta's Conversions API. Both deduplicate with
// the browser events (GA by transaction_id, Meta by event_id = session id).
// They only run when the browser said at checkout that tracking is allowed
// (it sends its ids object, even empty), which it doesn't do for visitors who
// opted out or send Global Privacy Control: then nothing is kept or sent.

export function serverConversionsEnabled() {
  return Boolean((env.GA_API_SECRET && env.GA_MEASUREMENT_ID) || (env.META_CAPI_TOKEN && env.META_PIXEL_ID))
}

// What the browser hands over at checkout, kept in the session metadata.
export type Attribution = { gaClientId?: string; fbp?: string; fbc?: string }

// In the metadata of a checkout (or sign-up) whose browser allowed tracking,
// with or without ids yet: Meta may then match the purchase by the email.
// Checkouts from before it have it implied by their browser ids. The IP and
// user agent stay in the checkout's Stripe metadata with the payment (the
// privacy notice says so under Payments).
export const TRACKING_ALLOWED = { tracking: 'allowed' } as const

export function trackingAllowed(metadata: Record<string, string>) {
  return metadata.tracking === TRACKING_ALLOWED.tracking || Boolean(metadata.ga_cid || metadata.fbp || metadata.fbc)
}

// Stripe caps each metadata value at 500 characters.
const METADATA_MAX = 500

// The Meta ad click an account came with (users.acquisition.fbclid, read
// from the ad's link on their first visit), spelled like Meta's _fbc cookie
// with the account's creation as the click time. For a checkout whose
// browser lost it: Safari after the jump from Instagram, a link from one of
// our emails, or an in-app visit where the pixel never set the cookie.
// Oct 5-9: 1 in 5 purchases reached Meta without a click id, and Meta
// credited the ads with about 17 of the 25 purchases that came from them.
export function storedMetaClick(user: { acquisition?: { fbclid?: string | null } | null; createdAt?: Date | null } | null | undefined) {
  const fbclid = user?.acquisition?.fbclid
  const clickedAt = user?.createdAt

  return fbclid && /^[\w-]{4,450}$/.test(fbclid) && clickedAt ? `fb.1.${clickedAt.getTime()}.${fbclid}` : undefined
}

// The same click for the sign-in links in our emails: the page they open
// on puts it back in the browser (when tracking is allowed there), so the
// pixel and the checkout have it.
export function storedAdIds(user: Parameters<typeof storedMetaClick>[0]) {
  const fbc = storedMetaClick(user)

  return fbc ? { fbc } : undefined
}

// Only for a browser that allowed tracking: it sends its ids object (empty
// when it has none yet: Safari after the jump, a link from an email), and
// then the metadata says so, with the IP and user agent. `storedFbc`
// (storedMetaClick) stands in for a click id it didn't send. A browser that
// opted out (or with Global Privacy Control) sends none, and then nothing is
// kept and nothing goes to Meta or GA.
export function attributionMetadata(
  attribution: Attribution | undefined,
  request: { ip: string; headers: Record<string, string | string[] | undefined> },
  storedFbc?: string,
): Record<string, string> {
  if (!attribution) {
    return {}
  }

  const fit = (value: string | undefined) => (value && value.length <= METADATA_MAX ? value : undefined)
  const gaClientId = fit(attribution.gaClientId)
  const fbp = fit(attribution.fbp)
  const fbc = fit(attribution.fbc) ?? fit(storedFbc)
  const userAgent = request.headers['user-agent']

  return {
    ...(gaClientId ? { ga_cid: gaClientId } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ...TRACKING_ALLOWED,
    ip: request.ip,
    ua: (typeof userAgent === 'string' ? userAgent : '').slice(0, 400),
  }
}

// Who bought or signed up, for Meta to match the event on (customer
// information parameters): the email, our account id and the country.
export type MetaCustomer = { email?: string | null; userId?: string | null; country?: string | null }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// A real address, trimmed and lowercased as Meta asks: never a guest's
// placeholder or a deleted account's alias (utils/deleted-accounts.ts),
// which are nobody's.
export function customerEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase()

  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !isPlaceholderEmail(normalized) ? normalized : undefined
}

// A two-letter ISO country code, uppercase, or nothing.
function countryCode(value: string | null | undefined) {
  const code = value?.trim().toUpperCase()

  return code && /^[A-Z]{2}$/.test(code) ? code : undefined
}

// Where the GDPR (the EEA, with the EU's outermost regions and the Aland
// Islands, which have codes of their own), the UK GDPR (with the Crown
// Dependencies and Gibraltar, under their own similar laws) or Switzerland's
// FADP ask for consent first. Our tracking is the US model (on unless the
// visitor opts out) and there's no consent banner yet, so people there never
// have their hashed email, account id or country sent to Meta: their events
// go as before, by the browser ids alone (metaCustomerData).
const CONSENT_FIRST = new Set([
  // EU
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // the rest of the EEA
  'IS', 'LI', 'NO',
  // EU regions with codes of their own
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  // the UK and Switzerland
  'GB', 'UK', 'GG', 'JE', 'IM', 'GI', 'CH',
])

export function consentFirstCountry(country: string | null | undefined) {
  const code = countryCode(country)

  return Boolean(code && CONSENT_FIRST.has(code))
}

// Hashed one way (SHA-256) before they leave, so Meta doesn't receive them
// readable: it compares them with the ones it holds to find the person's
// Meta account, so they are still personal data, and the privacy notice
// says so. external_id is our account id (a guest's own id too), country
// the lowercase ISO code. No phone: we keep none. Nothing from someone in
// the EEA, the UK or Switzerland (CONSENT_FIRST).
export function metaCustomerData(customer: MetaCustomer | null | undefined) {
  if (consentFirstCountry(customer?.country)) {
    return {}
  }

  const email = customerEmail(customer?.email)
  const userId = customer?.userId?.trim()
  const country = countryCode(customer?.country)?.toLowerCase()

  return {
    ...(email ? { em: [sha256(email)] } : {}),
    ...(userId ? { external_id: [sha256(userId)] } : {}),
    ...(country ? { country: [sha256(country)] } : {}),
  }
}

// What Meta can match a server event on, only when the browser allowed
// tracking: the _fbp cookie, the ad click id, the IP and user agent, and the
// person's hashed email, account id and country. Always with the user agent:
// Meta requires it for website events and refuses one without it. It goes
// out with either browser id (a buyer without the _fbp cookie, like the
// first trial, is still worth reporting by click id) or, without them, with
// the hashed email (Safari after the jump, a checkout from one of our
// emails). Otherwise there's nothing to send.
export function metaUserData(metadata: Record<string, string>, customer?: MetaCustomer | null) {
  if (!trackingAllowed(metadata) || !metadata.ua) {
    return null
  }

  const identifiers = metaCustomerData(customer)

  if (!metadata.fbp && !metadata.fbc && !identifiers.em) {
    return null
  }

  return {
    ...(metadata.fbp ? { fbp: metadata.fbp } : {}),
    ...(metadata.fbc ? { fbc: metadata.fbc } : {}),
    ...(metadata.ip ? { client_ip_address: metadata.ip } : {}),
    client_user_agent: metadata.ua,
    ...identifiers,
  }
}

// What Stripe has of the buyer: the email it asked for (a guest's only one)
// and the card's billing country.
export type CheckoutBuyer = { email?: string | null; country?: string | null }

// The pricing regions that are one country (billing/pricing.ts).
const REGION_COUNTRY: Record<string, string> = { br: 'BR', mx: 'MX', co: 'CO' }

// The buyer for Meta: the account's email when it's real (a guest's is a
// placeholder until Stripe's is claimed), else Stripe's; the account id;
// and the card's billing country (closest to the home country Meta asks
// for), else the one they signed up from, else the purchase's region when
// that's one country, each used only when it's a country code. When any of
// them is in the EEA, the UK or Switzerland, that one is the country, so
// none of the identifiers leave (metaCustomerData).
export function purchaseCustomer(
  user: { email?: string | null; location?: { country?: string | null } | null } | null | undefined,
  metadata: Record<string, string>,
  checkout?: CheckoutBuyer,
): MetaCustomer {
  const countries = [checkout?.country, user?.location?.country, REGION_COUNTRY[metadata.region ?? '']]
    .map(countryCode)
    .filter((code): code is string => Boolean(code))

  return {
    email: customerEmail(user?.email) ?? customerEmail(checkout?.email) ?? null,
    userId: metadata.userId && ObjectId.isValid(metadata.userId) ? metadata.userId : null,
    country: countries.find(consentFirstCountry) ?? countries[0] ?? null,
  }
}

// An admin's own test purchase or sign-up is never a conversion, however it
// was made: signed in (the checkout then keeps no ids), or signed out, as a
// guest checkout or the book, when only the email Stripe asked for is theirs.
export function adminEmail(...emails: Array<string | null | undefined>) {
  return emails.some((email) => Boolean(email?.trim()) && isAdmin({ email: email!.trim() }))
}

async function buyerAccount(app: FastifyInstance, userId: string | undefined) {
  if (!userId || !ObjectId.isValid(userId)) {
    return null
  }

  return app.collections.users
    .findOne({ _id: new ObjectId(userId) }, { projection: { email: 1, location: 1 } })
    .catch(() => null)
}

async function post(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`)
  }

  return response.json().catch(() => null)
}

type PurchaseReport = {
  metadata: Stripe.Metadata | null | undefined
  transactionId: string
  product: string
  amount: number
  currency: string
  // When it was bought, if not now (a purchase reported late; Meta takes
  // events up to 7 days old).
  eventTime?: Date
  // What Stripe has of the buyer (reportPurchase adds the account's).
  checkout?: CheckoutBuyer
}

function metaConfigured() {
  return Boolean(env.META_CAPI_TOKEN && env.META_PIXEL_ID)
}

// The purchase to Meta's Conversions API, or null when it can't go: no
// token, tracking not allowed, or nothing to match it on (metaUserData).
export function sendMetaPurchase(input: Omit<PurchaseReport, 'checkout'> & { customer?: MetaCustomer | null }) {
  const userData = metaUserData(input.metadata ?? {}, input.customer)

  if (!metaConfigured() || !userData) {
    return null
  }

  return post(`https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`, {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor((input.eventTime?.getTime() ?? Date.now()) / 1000),
        event_id: input.transactionId,
        action_source: 'website',
        event_source_url: `${env.APP_URL}/studio/billing/success`,
        // Browser ids, IP and user agent, and the email, account id and
        // country hashed (SHA-256): the privacy notice says Meta gets them
        // to measure our ads, only when tracking is allowed, the hashed
        // ones never from the EEA, the UK or Switzerland.
        user_data: userData,
        custom_data: {
          value: input.amount / 100,
          currency: input.currency.toUpperCase(),
          content_ids: [input.product],
          content_type: 'product',
        },
      },
    ],
  })
}

export async function reportPurchase(app: FastifyInstance, input: PurchaseReport) {
  const metadata = input.metadata ?? {}
  const value = input.amount / 100
  const currency = input.currency.toUpperCase()
  const tasks: Promise<unknown>[] = []
  const toGa = Boolean(env.GA_API_SECRET && env.GA_MEASUREMENT_ID && metadata.ga_cid)
  const toMeta = metaConfigured() && trackingAllowed(metadata)

  // The account is looked up only for a purchase that can go somewhere
  // (never after an opt-out or GPC).
  if (!toGa && !toMeta) {
    return
  }

  const user = await buyerAccount(app, metadata.userId)
  const customer = purchaseCustomer(user, metadata, input.checkout)

  if (adminEmail(user?.email, input.checkout?.email)) {
    return
  }

  if (toGa) {
    tasks.push(
      post(
        `https://www.google-analytics.com/mp/collect?measurement_id=${env.GA_MEASUREMENT_ID}&api_secret=${env.GA_API_SECRET}`,
        {
          client_id: metadata.ga_cid,
          events: [
            {
              name: 'purchase',
              params: { transaction_id: input.transactionId, value, currency, items: [{ item_id: input.product }] },
            },
          ],
        },
      ),
    )
  }

  if (toMeta) {
    const meta = sendMetaPurchase({ ...input, customer })

    if (meta) {
      tasks.push(meta)
    }
  }

  const results = await Promise.allSettled(tasks)

  for (const result of results) {
    if (result.status === 'rejected') {
      app.log.warn({ err: errorMessage(result.reason), transactionId: input.transactionId }, 'Server conversion failed')
    }
  }
}

// A new account, reported to Meta from the server too (the pixel sends the
// same event from the browser with the same event id, and Meta keeps one).
// Only when the browser allowed tracking, like purchases, and never for an
// admin: browser ids, IP and user agent, and the hashed email, account id
// and country only when the account has a real email (and isn't in the EEA,
// the UK or Switzerland).
export async function reportRegistration(
  app: FastifyInstance,
  input: {
    metadata: Record<string, string>
    eventId: string
    method: string
    user: { _id: { toString(): string }; email: string; location?: { country?: string | null } | null }
  },
) {
  const { metadata, user } = input

  if (!metaConfigured() || adminEmail(user.email)) {
    return
  }

  const email = customerEmail(user.email)
  const userData = metaUserData(
    metadata,
    email ? { email, userId: user._id.toString(), country: user.location?.country ?? null } : null,
  )

  if (!userData) {
    return
  }

  try {
    await post(`https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`, {
      data: [
        {
          event_name: 'CompleteRegistration',
          event_time: Math.floor(Date.now() / 1000),
          event_id: input.eventId,
          action_source: 'website',
          event_source_url: `${env.APP_URL}/login`,
          user_data: userData,
          custom_data: { status: input.method },
        },
      ],
    })
  } catch (error) {
    app.log.warn({ err: errorMessage(error), eventId: input.eventId }, 'Server registration event failed')
  }
}
