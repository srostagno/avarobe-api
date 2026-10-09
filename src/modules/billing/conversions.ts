import type { FastifyInstance } from 'fastify'
import type Stripe from 'stripe'

import { env } from '../../config/env.js'
import { errorMessage } from '../../utils/http.js'

// Purchases reported from the server, so ad blockers and iOS don't lose them:
// GA4 Measurement Protocol and Meta's Conversions API. Both deduplicate with
// the browser events (GA by transaction_id, Meta by event_id = session id).
// They only run when the browser sent its analytics ids at checkout, which
// it doesn't do for visitors who opted out.

export function serverConversionsEnabled() {
  return Boolean((env.GA_API_SECRET && env.GA_MEASUREMENT_ID) || (env.META_CAPI_TOKEN && env.META_PIXEL_ID))
}

// What the browser hands over at checkout, kept in the session metadata.
export type Attribution = { gaClientId?: string; fbp?: string; fbc?: string }

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

// `storedFbc` (storedMetaClick) stands in for a click id the browser didn't
// send, only when it sent its ids at all: a browser that opted out (or with
// Global Privacy Control) sends none, and then nothing goes to Meta.
export function attributionMetadata(
  attribution: Attribution | undefined,
  request: { ip: string; headers: Record<string, string | string[] | undefined> },
  storedFbc?: string,
): Record<string, string> {
  const fit = (value: string | undefined) => (value && value.length <= METADATA_MAX ? value : undefined)
  const gaClientId = fit(attribution?.gaClientId)
  const fbp = fit(attribution?.fbp)
  const fbc = fit(attribution?.fbc) ?? (attribution ? fit(storedFbc) : undefined)

  if (!gaClientId && !fbp && !fbc) {
    return {}
  }

  const userAgent = request.headers['user-agent']

  return {
    ...(gaClientId ? { ga_cid: gaClientId } : {}),
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
    ip: request.ip,
    ua: (typeof userAgent === 'string' ? userAgent : '').slice(0, 400),
  }
}

// What Meta can match a server event on: the browser cookie, the ad click
// id, and the IP and user agent (required for website events). The event
// goes out when either id is there: a buyer without the _fbp cookie (it
// happened with the first trial) is still worth reporting by click id.
function metaUserData(metadata: Record<string, string>) {
  if (!metadata.fbp && !metadata.fbc) {
    return null
  }

  return {
    ...(metadata.fbp ? { fbp: metadata.fbp } : {}),
    ...(metadata.fbc ? { fbc: metadata.fbc } : {}),
    ...(metadata.ip ? { client_ip_address: metadata.ip } : {}),
    ...(metadata.ua ? { client_user_agent: metadata.ua } : {}),
  }
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
}

// The purchase to Meta's Conversions API, or null when it can't go: no
// token, or no browser ids to match it on.
export function sendMetaPurchase(input: PurchaseReport) {
  const userData = metaUserData(input.metadata ?? {})

  if (!env.META_CAPI_TOKEN || !env.META_PIXEL_ID || !userData) {
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
        // No email or other identifiers: the privacy notice promises Meta
        // never gets them. Browser ids, IP and user agent only.
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

  const meta = sendMetaPurchase(input)

  if (meta) {
    tasks.push(meta)
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
// Browser ids, IP and user agent only: never the email.
export async function reportRegistration(
  app: FastifyInstance,
  input: { metadata: Record<string, string>; eventId: string; method: string },
) {
  const metadata = input.metadata

  const userData = metaUserData(metadata)

  if (!env.META_CAPI_TOKEN || !env.META_PIXEL_ID || !userData) {
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
