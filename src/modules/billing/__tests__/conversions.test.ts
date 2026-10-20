import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import type { FastifyInstance } from 'fastify'
import { ObjectId } from 'mongodb'

import { env } from '../../../config/env.js'
import { guestEmail } from '../../../utils/guests.js'
import {
  attributionMetadata,
  consentFirstCountry,
  customerEmail,
  metaCustomerData,
  purchaseCustomer,
  reportPurchase,
  reportRegistration,
  sendMetaPurchase,
  storedAdIds,
  storedMetaClick,
  trackingAllowed,
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

  it("takes the account's email, else Stripe's for a guest, and the card's country, else the one signed up from", () => {
    const metadata = { userId: USER_ID, region: 'us' }

    assert.deepEqual(purchaseCustomer({ email: 'ana.silva@example.com', location: { country: 'US' } }, metadata, { email: 'other@example.com', country: 'BR' }), {
      email: 'ana.silva@example.com',
      userId: USER_ID,
      country: 'BR',
    })
    assert.equal(purchaseCustomer({ email: 'ana.silva@example.com', location: { country: 'US' } }, metadata, { country: null }).country, 'US')
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

  it('skips a country that is not a code instead of letting it hide the next one', () => {
    assert.equal(purchaseCustomer({ location: { country: 'USA' } }, { region: 'mx' }, { country: '' }).country, 'MX')
    assert.equal(purchaseCustomer({ location: { country: 'us' } }, { region: 'latam' }, { country: 'Brazil' }).country, 'US')
    assert.equal(purchaseCustomer(null, { region: 'latam' }, {}).country, null)
  })

  it('sends no hashed identifiers for someone in the EEA, the UK or Switzerland', () => {
    for (const country of ['DE', 'fr', ' IE ', 'NO', 'GB', 'CH', 'RE']) {
      assert.equal(consentFirstCountry(country), true, country)
      assert.deepEqual(metaCustomerData({ email: 'ana.silva@example.com', userId: USER_ID, country }), {}, country)
    }

    for (const country of ['US', 'BR', 'MX', 'CO', 'CA', 'AU', null]) {
      assert.equal(consentFirstCountry(country), false, String(country))
    }

    // Any of the buyer's countries there is enough: a card from France
    // for an account that signed up in the US, or the other way round.
    const metadata = { userId: USER_ID, region: 'us' }
    assert.equal(purchaseCustomer({ email: 'ana.silva@example.com', location: { country: 'US' } }, metadata, { country: 'FR' }).country, 'FR')
    assert.equal(purchaseCustomer({ email: 'ana.silva@example.com', location: { country: 'ES' } }, metadata, { country: 'US' }).country, 'ES')
    assert.deepEqual(metaCustomerData(purchaseCustomer({ email: 'ana.silva@example.com', location: { country: 'ES' } }, metadata, { country: 'US' })), {})
  })
})

describe('server events to Meta', () => {
  const saved = {
    fetch: globalThis.fetch,
    token: env.META_CAPI_TOKEN,
    pixel: env.META_PIXEL_ID,
    gaSecret: env.GA_API_SECRET,
    gaId: env.GA_MEASUREMENT_ID,
    comp: env.COMP_EMAILS,
  }
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
    env.GA_MEASUREMENT_ID = 'G-TEST'
    env.COMP_EMAILS = 'founder@example.com'
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
    env.GA_MEASUREMENT_ID = saved.gaId
    env.COMP_EMAILS = saved.comp
  })

  const toMeta = () => sent.filter((request) => request.url.startsWith('https://graph.facebook.com/'))
  const toGa = () => sent.filter((request) => request.url.startsWith('https://www.google-analytics.com/'))

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

  it('sends a Pro subscription as a Purchase and a Subscribe with its predicted value', async () => {
    const metadata = { ...attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request), userId: USER_ID }

    await reportPurchase(app({ email: 'ana.silva@example.com' }), { transactionId: 'in_1', product: 'pro_monthly', amount: 799, currency: 'usd', metadata })

    const events = toMeta()[0]!.body.data
    assert.deepEqual(
      events.map((event) => [event.event_name, event.event_id]),
      [
        ['Purchase', 'in_1'],
        ['Subscribe', 'in_1-sub'],
      ],
    )
    assert.deepEqual(events[1]!.custom_data, { value: 7.99, currency: 'USD', predicted_ltv: 29.56 })
    assert.deepEqual(events[1]!.user_data, events[0]!.user_data)
  })

  it('sends a free trial as a StartTrial worth nothing, never a Purchase (its first charge is the purchase)', async () => {
    const metadata = { ...attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request), userId: USER_ID, ga_cid: '123.456' }
    env.GA_API_SECRET = 'ga-secret'

    await reportPurchase(app({ email: 'ana.silva@example.com' }), { transactionId: 'in_trial', product: 'pro_trial', amount: 0, currency: 'aud', metadata })

    const events = toMeta()[0]!.body.data
    assert.deepEqual(
      events.map((event) => [event.event_name, event.event_id]),
      [['StartTrial', 'in_trial']],
    )
    assert.deepEqual(events[0]!.custom_data, { value: 0, currency: 'AUD', content_ids: ['pro_trial'], content_type: 'product' })
    assert.equal((toGa()[0]!.body as unknown as { events: Array<{ name: string }> }).events[0]!.name, 'start_trial')
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

  it("doesn't send a website event without the user agent Meta requires, even with browser ids", async () => {
    const noAgent = { ip: request.ip, headers: {} }
    const withIds = attributionMetadata({ fbp: 'fb.1.1791000000000.456', fbc: 'fb.1.1790000000000.IwAR0abc' }, noAgent)

    assert.equal(withIds.ua, '')
    assert.equal(sendMetaPurchase({ ...purchase, metadata: withIds, customer: { email: 'ana.silva@example.com' } }), null)
    const withoutAgent = attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request)
    delete withoutAgent.ua
    assert.equal(sendMetaPurchase({ ...purchase, metadata: withoutAgent }), null)

    await reportRegistration(app(null), {
      metadata: withIds,
      eventId: 'evt-ua',
      method: 'password',
      user: { _id: new ObjectId(USER_ID), email: 'ana.silva@example.com', location: { country: 'US' } },
    })
    assert.equal(sent.length, 0)
  })

  it('counts a checkout from before the tracking flag, with only the GA client id, as allowed', async () => {
    env.GA_API_SECRET = 'test-secret'
    // Its IP and user agent were kept with the ids then too.
    const old = { ga_cid: '123.456', ip: request.ip, ua: 'Instagram 300.0 (iPhone)', userId: USER_ID, region: 'us' }

    assert.equal(trackingAllowed(old), true)
    assert.equal(trackingAllowed({ userId: USER_ID, region: 'us' }), false)

    await reportPurchase(app({ email: 'ana.silva@example.com', location: { country: 'US' } }), { ...purchase, metadata: old })

    assert.equal(toGa().length, 1)
    assert.equal(toMeta().length, 1)
    assert.deepEqual(toMeta()[0]!.body.data[0]!.user_data, {
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
      em: [HASH.email],
      external_id: [HASH.userId],
      country: [HASH.us],
    })
  })

  it('sends GA only with its client id: the tracking flag alone never triggers it, and an opt-out sends neither', async () => {
    env.GA_API_SECRET = 'test-secret'
    const user = app({ email: 'ana.silva@example.com', location: { country: 'US' } })

    await reportPurchase(user, { ...purchase, metadata: { ...attributionMetadata({}, request), userId: USER_ID } })
    assert.equal(toGa().length, 0)
    assert.equal(toMeta().length, 1)

    sent = []
    await reportPurchase(user, { ...purchase, metadata: { ...attributionMetadata({ gaClientId: '123.456' }, request), userId: USER_ID } })
    assert.equal(toGa().length, 1)
    assert.match(toGa()[0]!.url, /measurement_id=G-TEST&api_secret=/)
    assert.equal((toGa()[0]!.body as unknown as { client_id: string }).client_id, '123.456')
    assert.ok(!JSON.stringify(toGa()[0]!.body).includes('example.com'), 'GA gets no email')

    sent = []
    await reportPurchase(user, { ...purchase, metadata: { ...attributionMetadata(undefined, request), userId: USER_ID } })
    assert.equal(sent.length, 0)
  })

  it("never reports an admin's test purchase, signed out as a guest or for the book, by the email Stripe asked for", async () => {
    env.GA_API_SECRET = 'test-secret'
    const ids = attributionMetadata({ fbp: 'fb.1.1791000000000.456', gaClientId: '123.456' }, request)

    // A guest checkout: the account still has its placeholder.
    await reportPurchase(app({ email: guestEmail(new ObjectId(USER_ID)), location: { country: 'US' } }), {
      ...purchase,
      metadata: { ...ids, userId: USER_ID },
      checkout: { email: ' Founder@Example.com ', country: 'US' },
    })
    // The book, bought signed out: no account at all.
    await reportPurchase(app(null), {
      ...purchase,
      product: 'outfit_guide',
      metadata: { ...ids, region: 'us' },
      checkout: { email: 'founder@example.com', country: 'US' },
    })
    // Signed in with an admin account, from a checkout that kept ids anyway.
    await reportPurchase(app({ email: 'founder@example.com', location: { country: 'US' } }), {
      ...purchase,
      metadata: { ...ids, userId: USER_ID },
      checkout: { email: 'founder@example.com' },
    })

    assert.equal(sent.length, 0)

    // Someone else's purchase from the same kind of checkout still goes.
    await reportPurchase(app(null), { ...purchase, metadata: { ...ids, region: 'us' }, checkout: { email: 'ana.silva@example.com', country: 'US' } })
    assert.equal(toMeta().length, 1)
    assert.equal(toGa().length, 1)
  })

  it('sends a purchase from the EEA, the UK or Switzerland by the browser ids alone, and not at all without them', async () => {
    await reportPurchase(app({ email: 'ana.silva@example.com', location: { country: 'US' } }), {
      ...purchase,
      metadata: { ...attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request), userId: USER_ID, region: 'us' },
      checkout: { email: 'ana.silva@example.com', country: 'GB' },
    })

    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0]!.body.data[0]!.user_data, {
      fbp: 'fb.1.1791000000000.456',
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
    })

    sent = []
    await reportPurchase(app({ email: 'ana.silva@example.com', location: { country: 'DE' } }), {
      ...purchase,
      metadata: { ...attributionMetadata({}, request), userId: USER_ID, region: 'us' },
      checkout: { email: 'ana.silva@example.com', country: 'DE' },
    })
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

  it('sends a sign-up without _fbp or _fbc by the hashed email and the user agent, and not without the user agent', async () => {
    const user = { _id: new ObjectId(USER_ID), email: 'ana.silva@example.com', location: { country: 'US' } }

    await reportRegistration(app(null), { metadata: attributionMetadata({}, request), eventId: 'evt-4', method: 'password', user })
    await reportRegistration(app(null), {
      metadata: attributionMetadata({}, { ip: request.ip, headers: {} }),
      eventId: 'evt-5',
      method: 'passkey',
      user,
    })

    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.body.data[0]!.event_id, 'evt-4')
    assert.deepEqual(sent[0]!.body.data[0]!.user_data, {
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
      em: [HASH.email],
      external_id: [HASH.userId],
      country: [HASH.us],
    })
  })

  it("never sends an admin's sign-up, and one from the EEA, the UK or Switzerland only by the browser ids", async () => {
    const withIds = attributionMetadata({ fbp: 'fb.1.1791000000000.456' }, request)
    const user = { _id: new ObjectId(USER_ID), email: 'Founder@example.com', location: { country: 'US' } }

    await reportRegistration(app(null), { metadata: withIds, eventId: 'evt-6', method: 'password', user })
    assert.equal(sent.length, 0)

    const european = { ...user, email: 'ana.silva@example.com', location: { country: 'IE' } }
    await reportRegistration(app(null), { metadata: attributionMetadata({}, request), eventId: 'evt-7', method: 'password', user: european })
    await reportRegistration(app(null), { metadata: withIds, eventId: 'evt-8', method: 'password', user: european })

    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.body.data[0]!.event_id, 'evt-8')
    assert.deepEqual(sent[0]!.body.data[0]!.user_data, {
      fbp: 'fb.1.1791000000000.456',
      client_ip_address: request.ip,
      client_user_agent: 'Instagram 300.0 (iPhone)',
    })
  })
})
