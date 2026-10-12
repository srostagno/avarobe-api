import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../../config/env.js'
import { guestEmail } from '../../../utils/guests.js'
import {
  attributionMetadata,
  customerEmail,
  metaCustomerData,
  purchaseCustomer,
  reportPurchase,
  reportRegistration,
  sendMetaPurchase,
  storedAdIds,
  storedMetaClick,
} from '../conversions.js'

const request = { ip: '203.0.113.7', headers: { 'user-agent': 'Instagram 300.0 (iPhone)' } }

describe('checkout attribution kept in Stripe metadata', () => {
  it('keeps the click id without the _fbp cookie, with IP and user agent for Meta', () => {
    const metadata = attributionMetadata({ fbc: 'fb.1.1790000000000.IwAR0abc' }, request)

    assert.deepEqual(metadata, {
      fbc: 'fb.1.1790000000000.IwAR0abc',
      tracking: 'allowed',
      ip: request.ip,
      ua: 'Instagram 300.0 (iPhone)',
    })
  })

  it('drops an id longer than a Stripe metadata value instead of failing the checkout', () => {
    const metadata = attributionMetadata({ fbp: 'fb.1.1790000000000.123', fbc: `fb.1.1790000000000.${'x'.repeat(600)}` }, request)

    assert.equal(metadata.fbc, undefined)
    assert.equal(metadata.fbp, 'fb.1.1790000000000.123')
  })

  it('keeps nothing when the browser sent no ids object (the visitor opted out)', () => {
    assert.deepEqual(attributionMetadata(undefined, request), {})
  })

  it('notes a browser that allowed tracking but has no ids yet, with IP and user agent', () => {
    assert.deepEqual(attributionMetadata({}, request), { tracking: 'allowed', ip: request.ip, ua: 'Instagram 300.0 (iPhone)' })
  })
})

describe("the account's own Meta click, for a browser that lost it", () => {
  const user = { acquisition: { fbclid: 'IwZXh0bgNhZW0BMAABHRx_aem_Q1' }, createdAt: new Date(1791000000000) }
  const stored = storedMetaClick(user)

  it('spells it like the _fbc cookie, timed at the account', () => {
    assert.equal(stored, 'fb.1.1791000000000.IwZXh0bgNhZW0BMAABHRx_aem_Q1')
    assert.deepEqual(storedAdIds(user), { fbc: stored })
    assert.equal(storedMetaClick({ acquisition: { fbclid: null }, createdAt: new Date() }), undefined)
    assert.equal(storedMetaClick({ acquisition: { fbclid: 'bad id!' }, createdAt: new Date() }), undefined)
    assert.equal(storedAdIds(null), undefined)
  })

  it('fills in for a browser that sent its ids without a click id (Safari after the jump)', () => {
    const metadata = attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request, stored)
    assert.deepEqual(metadata, {
      fbp: 'fb.1.1791000000000.456',
      fbc: stored,
      tracking: 'allowed',
      ip: request.ip,
      ua: 'Instagram 300.0 (iPhone)',
    })
    assert.equal(attributionMetadata({}, request, stored).fbc, stored)
  })

  it("never replaces the browser's own click, and never goes for a browser that opted out", () => {
    assert.equal(attributionMetadata({ fbc: 'fb.1.1791000500000.newer' }, request, stored).fbc, 'fb.1.1791000500000.newer')
    assert.deepEqual(attributionMetadata(undefined, request, stored), {})
  })
})


// SHA-256 of the normalized values, worked out independently.
const HASH = {
  email: '7bda2560ce1bf126ff5df73ed84b6c9f8dd6064e33fc273eb05b7761e31c2b86', // ana.silva@example.com
  us: '79adb2a2fce5c6ba215fe5f27f532d4e7edbac4b6a5e09e1ef3a08084a904621',
  br: '885036a0da3dff3c3e05bc79bf49382b12bc5098514ed57ce0875aba1aa2c40d',
  userId: '778ca395433557e8fa5b43ecd342c5674fdc2208b7c6d6a04525f4fb08ba30c8', // 65f0c0ffee0000000000abcd
}
const USER_ID = '65f0c0ffee0000000000abcd'

describe("Meta's customer information, hashed", () => {
  it('trims and lowercases the email, and the country, before hashing them with SHA-256', () => {
    assert.deepEqual(metaCustomerData({ email: '  Ana.Silva@Example.COM ', userId: USER_ID, country: 'US' }), {
      em: [HASH.email],
      external_id: [HASH.userId],
      country: [HASH.us],
    })
  })

  it('never hashes a guest placeholder, an address that is not one, or a country that is not a code', () => {
    const placeholder = guestEmail(new ObjectId(USER_ID))

    assert.equal(customerEmail(placeholder), undefined)
    assert.equal(customerEmail(placeholder.toUpperCase()), undefined)
    assert.equal(customerEmail('not an email'), undefined)
    assert.deepEqual(metaCustomerData({ email: placeholder, country: 'USA' }), {})
    assert.deepEqual(metaCustomerData(null), {})
  })

  it("takes the account's email, else Stripe's for a guest, and the country signed up from, else the card's", () => {
    const metadata = { userId: USER_ID, region: 'us' }

    assert.deepEqual(purchaseCustomer({ email: 'ana.silva@example.com', location: { country: 'US' } }, metadata, { email: 'other@example.com', country: 'BR' }), {
      email: 'ana.silva@example.com',
      userId: USER_ID,
      country: 'US',
    })
    assert.deepEqual(purchaseCustomer({ email: guestEmail(new ObjectId(USER_ID)), location: null }, metadata, { email: 'Ana.Silva@Example.com', country: 'BR' }), {
      email: 'ana.silva@example.com',
      userId: USER_ID,
      country: 'BR',
    })
    // A guest who paid without Stripe's email reaching us: no email at all.
    assert.equal(purchaseCustomer({ email: guestEmail(new ObjectId(USER_ID)) }, metadata, {}).email, null)
    // A book bought without an account, priced for Brazil.
    assert.deepEqual(purchaseCustomer(null, { region: 'br' }, { email: 'ana.silva@example.com' }), {
      email: 'ana.silva@example.com',
      userId: null,
      country: 'BR',
    })
  })
})

describe('server events to Meta', () => {
  const saved = { fetch: globalThis.fetch, token: env.META_CAPI_TOKEN, pixel: env.META_PIXEL_ID, gaSecret: env.GA_API_SECRET }
  type Sent = { url: string; body: { data: Array<Record<string, unknown> & { user_data: Record<string, unknown> }> } }
  let sent: Sent[] = []

  const app = (user: Record<string, unknown> | null) =>
    ({
      collections: { users: { findOne: async () => user } },
      log: { warn: () => undefined },
    }) as unknown as FastifyInstance

  beforeEach(() => {
    sent = []
    env.META_CAPI_TOKEN = 'test-token'
    env.META_PIXEL_ID = '1234567890'
    env.GA_API_SECRET = undefined
    // Never a real request to Meta from a test.
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      sent.push({ url: href, body: JSON.parse(init?.body as string) as Sent['body'] })
      return new Response('{"events_received":1}', { status: 200 })
    }
  })

  afterEach(() => {
    globalThis.fetch = saved.fetch
    env.META_CAPI_TOKEN = saved.token
    env.META_PIXEL_ID = saved.pixel
    env.GA_API_SECRET = saved.gaSecret
  })

  const purchase = { transactionId: 'cs_test_1', product: 'color_report', amount: 499, currency: 'usd' }

  it('sends a purchase with browser ids, IP, user agent and the hashed email, account id and country', async () => {
    const metadata = { ...attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request), userId: USER_ID, region: 'us' }

    await reportPurchase(app({ email: 'Ana.Silva@example.com', location: { country: 'US' } }), { ...purchase, metadata })

    assert.equal(sent.length, 1)
    assert.match(sent[0]!.url, /^https:\/\/graph\.facebook\.com\/v21\.0\/1234567890\/events\?access_token=/)
    const [event] = sent[0]!.body.data
    assert.equal(event!.event_name, 'Purchase')
    assert.equal(event!.event_id, 'cs_test_1')
    assert.equal(event!.action_source, 'website')
    assert.deepEqual(event!.user_data, {
      fbp: 'fb.1.1791000000000.456',
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
      em: [HASH.email],
      external_id: [HASH.userId],
      country: [HASH.us],
    })
    assert.deepEqual(event!.custom_data, { value: 4.99, currency: 'USD', content_ids: ['color_report'], content_type: 'product' })
    assert.ok(!JSON.stringify(sent[0]!.body).includes('example.com'), 'the email itself never leaves')
  })

  it('sends a purchase without _fbp or _fbc by the email, when tracking was allowed (Safari after the jump)', async () => {
    const metadata = { ...attributionMetadata({}, request), userId: USER_ID, region: 'br' }

    await reportPurchase(app({ email: guestEmail(new ObjectId(USER_ID)), location: null }), {
      ...purchase,
      metadata,
      checkout: { email: 'ana.silva@example.com', country: null },
    })

    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0]!.body.data[0]!.user_data, {
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
      em: [HASH.email],
      external_id: [HASH.userId],
      country: [HASH.br],
    })
  })

  it('sends nothing for a visitor who opted out, or an admin test purchase, even with an email on file', async () => {
    let looked = false
    const watching = {
      collections: { users: { findOne: async () => ((looked = true), { email: 'ana.silva@example.com' }) } },
      log: { warn: () => undefined },
    } as unknown as FastifyInstance

    await reportPurchase(watching, { ...purchase, metadata: { ...attributionMetadata(undefined, request), userId: USER_ID }, checkout: { email: 'ana.silva@example.com' } })
    await reportPurchase(watching, { ...purchase, metadata: { userId: USER_ID } })

    assert.equal(sent.length, 0)
    assert.equal(looked, false, 'not even the account is read')
    assert.equal(sendMetaPurchase({ ...purchase, metadata: {}, customer: { email: 'ana.silva@example.com', userId: USER_ID } }), null)
  })

  it("doesn't send a website event with neither browser ids nor the user agent and an email to match", () => {
    const allowed = attributionMetadata({}, request)

    assert.equal(sendMetaPurchase({ ...purchase, metadata: allowed, customer: { email: guestEmail(new ObjectId(USER_ID)), userId: USER_ID } }), null)
    assert.equal(sendMetaPurchase({ ...purchase, metadata: { ...allowed, ua: '' }, customer: { email: 'ana.silva@example.com' } }), null)
    assert.equal(sent.length, 0)
  })

  it('sends a sign-up with the hashed identifiers only for a real email, and nothing when tracking was refused', async () => {
    const user = { _id: new ObjectId(USER_ID), email: 'ana.silva@example.com', location: { country: 'BR' } }
    const withIds = attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request)

    await reportRegistration(app(null), { metadata: withIds, eventId: 'evt-1', method: 'password', user })
    await reportRegistration(app(null), {
      metadata: withIds,
      eventId: 'evt-2',
      method: 'guest',
      user: { ...user, email: guestEmail(user._id) },
    })
    await reportRegistration(app(null), { metadata: attributionMetadata(undefined, request), eventId: 'evt-3', method: 'password', user })

    assert.equal(sent.length, 2)
    assert.equal(sent[0]!.body.data[0]!.event_name, 'CompleteRegistration')
    assert.deepEqual(sent[0]!.body.data[0]!.user_data, {
      fbp: 'fb.1.1791000000000.456',
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
      em: [HASH.email],
      external_id: [HASH.userId],
      country: [HASH.br],
    })
    assert.deepEqual(sent[1]!.body.data[0]!.user_data, {
      fbp: 'fb.1.1791000000000.456',
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
    })
  })
})
