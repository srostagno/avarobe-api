import { createHash } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'
import type Stripe from 'stripe'

import { env } from '../../config/env.js'
import { isGuestEmail } from '../../utils/guests.js'
import { errorMessage } from '../../utils/http.js'

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
// Checkouts from before it have it implied by their browser ids.
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
// placeholder (utils/guests.ts), which is nobody's.
export function customerEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase()

  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !isGuestEmail(normalized) ? normalized : undefined
}

// Hashed one way (SHA-256) before they leave: Meta compares them with its
// own hashes and never gets the email itself. external_id is our account id
// (a guest's own id too), country the lowercase ISO code. No phone: we keep
// none.
export function metaCustomerData(customer: MetaCustomer | null | undefined) {
  const email = customerEmail(customer?.email)
  const userId = customer?.userId?.trim()
  const country = customer?.country?.trim().toLowerCase()

  return {
    ...(email ? { em: [sha256(email)] } : {}),
    ...(userId ? { external_id: [sha256(userId)] } : {}),
    ...(country && /^[a-z]{2}$/.test(country) ? { country: [sha256(country)] } : {}),
  }
}

// What Meta can match a server event on, only when the browser allowed
// tracking: the _fbp cookie, the ad click id, the IP and user agent, and the
// person's hashed email, account id and country. It goes out with either
// browser id (a buyer without the _fbp cookie, like the first trial, is
// still worth reporting by click id) or, without them, with the email and
// the user agent Meta requires for website events (Safari after the jump,
// a checkout from one of our emails). Otherwise there's nothing to send.
export function metaUserData(metadata: Record<string, string>, customer?: MetaCustomer | null) {
  if (!trackingAllowed(metadata)) {
    return null
  }

  const identifiers = metaCustomerData(customer)

  if (!metadata.fbp && !metadata.fbc && (!identifiers.em || !metadata.ua)) {
    return null
  }

  return {
    ...(metadata.fbp ? { fbp: metadata.fbp } : {}),
    ...(metadata.fbc ? { fbc: metadata.fbc } : {}),
    ...(metadata.ip ? { client_ip_address: metadata.ip } : {}),
    ...(metadata.ua ? { client_user_agent: metadata.ua } : {}),
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
// and the country they signed up from, else the card's, else the
// purchase's region when that's one country.
export function purchaseCustomer(
  user: { email?: string | null; location?: { country?: string | null } | null } | null | undefined,
  metadata: Record<string, string>,
  checkout?: CheckoutBuyer,
): MetaCustomer {
  return {
    email: customerEmail(user?.email) ?? customerEmail(checkout?.email) ?? null,
    userId: metadata.userId && ObjectId.isValid(metadata.userId) ? metadata.userId : null,
    country: user?.location?.country ?? checkout?.country ?? REGION_COUNTRY[metadata.region ?? ''] ?? null,
  }
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
        // country hashed (SHA-256): the privacy notice says Meta gets
        // these hashed identifiers to measure our ads, only when tracking
        // is allowed, and never the email itself.
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

  if (env.GA_API_SECRET && env.GA_MEASUREMENT_ID && metadata.ga_cid) {
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

  // The account is looked up only for a purchase that can go to Meta.
  if (metaConfigured() && trackingAllowed(metadata)) {
    const user = await buyerAccount(app, metadata.userId)
    const meta = sendMetaPurchase({ ...input, customer: purchaseCustomer(user, metadata, input.checkout) })

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
// Only when the browser allowed tracking, like purchases: browser ids, IP
// and user agent, and the hashed email, account id and country only when
// the account has a real email.
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
  const email = customerEmail(user.email)
  const userData = metaUserData(
    metadata,
    email ? { email, userId: user._id.toString(), country: user.location?.country ?? null } : null,
  )

  if (!metaConfigured() || !userData) {
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
