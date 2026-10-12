import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { memoryStorage, routeApp } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { RefundRequestDocument } from '../../../types/mongo.js'
import adminRefundRequestRoutes from '../refund-requests.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms)

const saved = { comp: env.COMP_EMAILS, stripe: env.STRIPE_SECRET_KEY, refunds: env.REFUNDS_EMAIL, allow: env.EMAIL_DEV_ALLOWLIST }
const files = memoryStorage()

before(() => {
  env.COMP_EMAILS = 'admin@example.test'
  // No Stripe: an approval here fails the way Stripe refusing would.
  env.STRIPE_SECRET_KEY = undefined
  env.REFUNDS_EMAIL = ['founder@example.test']
  env.EMAIL_DEV_ALLOWLIST = []
})

after(() => {
  env.COMP_EMAILS = saved.comp
  env.STRIPE_SECRET_KEY = saved.stripe
  env.REFUNDS_EMAIL = saved.refunds
  env.EMAIL_DEV_ALLOWLIST = saved.allow
  files.restore()
})

function requestDoc(userId: ObjectId, purchaseId: ObjectId, fields: Partial<RefundRequestDocument> = {}): RefundRequestDocument {
  const paidAt = ago(2 * DAY)

  return {
    _id: new ObjectId(),
    ref: `R-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    source: 'account',
    userId,
    guideOrderId: null,
    purchaseId,
    product: 'color_report',
    covers: [{ purchaseId, guideOrderId: null, product: 'color_report', amount: 499, currency: 'usd', paidAt, stripePaymentIntentId: 'pi_color', stripeInvoiceId: null }],
    amount: 499,
    currency: 'usd',
    amountUsd: 499,
    purchasedAt: paidAt,
    email: 'nora@example.com',
    emailHash: 'hash_nora',
    firstName: 'Nora',
    locale: 'en',
    targetKey: `p:${purchaseId.toString()}`,
    openKey: `p:${purchaseId.toString()}`,
    market: { currency: 'usd', region: 'us', signupCountry: 'US', requestCountry: 'US', card: { brand: 'visa', last4: '4242', country: 'US', fingerprint: 'fp_1' }, disputed: false },
    within7d: true,
    statutory: null,
    oldGuarantee: false,
    reasonCategory: 'technical',
    explanation: 'The report never loaded on my phone: the page stayed white after I paid, in Safari and Chrome.',
    attachment: null,
    usage: {
      at: ago(DAY),
      hoursSincePurchase: 24,
      colorReportOpenedAt: null,
      styleReportOpenedAt: null,
      hairReadAt: null,
      drapeAt: null,
      looksMade: 0,
      looksWithCredit: 0,
      creditsGiven: 0,
      creditsLeft: 0,
      hairstylesMade: 0,
      eventsStyled: 0,
      magazinesMade: 0,
      checksMade: 0,
      avatarRuns: null,
      guideDownloads: null,
      guideLastDownloadAt: null,
      lastSeenAt: null,
      events: {},
    },
    history: {
      refundsBefore: 0,
      requestsBefore: 0,
      approvedBefore: 0,
      rejectedBefore: 0,
      openRequests: 0,
      purchases: 1,
      paidUsd: 499,
      accountCreatedAt: ago(30 * DAY),
      channel: 'meta',
      campaign: null,
      cardSeenOn: 0,
    },
    flags: [],
    proPause: null,
    status: 'pending',
    decision: null,
    attempts: [],
    refund: null,
    internalNote: null,
    emails: { founderAt: ago(DAY), receivedAt: ago(DAY), decisionAt: null, reminderAt: null },
    createdAt: ago(DAY),
    updatedAt: ago(DAY),
    ...fields,
  }
}

async function setup() {
  const adminId = new ObjectId()
  const userId = new ObjectId()
  const purchases = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()]
  const ordinary = requestDoc(userId, purchases[0]!, { createdAt: ago(30 * HOUR), attachment: { key: `users/${userId.toString()}/refund-a.jpg`, bytes: 1200 } })
  const brazil = requestDoc(userId, purchases[1]!, {
    createdAt: ago(2 * HOUR),
    currency: 'brl',
    amount: 1490,
    market: { currency: 'brl', region: 'br', signupCountry: 'BR', requestCountry: 'BR', card: null, disputed: false },
    statutory: { law: 'br_cdc_49', until: new Date(Date.now() + 5 * DAY) },
    locale: 'pt-BR',
  })
  const rejected = requestDoc(userId, purchases[2]!, {
    status: 'rejected',
    openKey: undefined,
    createdAt: ago(10 * DAY),
    decision: { outcome: 'rejected', by: 'admin', adminId, adminEmail: 'admin@example.test', at: ago(9 * DAY), code: 'used', note: null, cdcOverride: false },
  })
  const routes = await routeApp(
    { '/admin/refund-requests': adminRefundRequestRoutes },
    {
      users: [
        { _id: adminId, email: 'admin@example.test', firstName: 'Admin', createdAt: ago(300 * DAY) },
        { _id: userId, email: 'nora@example.com', firstName: 'Nora', createdAt: ago(30 * DAY), colorReportAt: ago(2 * DAY) },
      ],
      purchases: purchases.slice(0, 3).map((_id, index) => ({
        _id,
        userId,
        product: 'color_report',
        stripeSessionId: `cs_${index}`,
        stripePaymentIntentId: index === 0 ? 'pi_color' : `pi_${index}`,
        amountTotal: index === 1 ? 1490 : 499,
        currency: index === 1 ? 'brl' : 'usd',
        credits: 0,
        createdAt: ago(2 * DAY),
        refundedAt: null,
      })),
      refundRequests: [ordinary, brazil, rejected] as unknown as Record<string, unknown>[],
    },
  )
  files.files.set(ordinary.attachment!.key, Buffer.from('jpeg'))

  return { ...routes, adminId, userId, ordinary, brazil, rejected }
}

describe('Admin → Refunds', () => {
  it('is for admins only: list, detail, approve, reject and note', async () => {
    const { app, auth, userId, ordinary } = await setup()
    const id = ordinary._id.toString()
    const calls = [
      { method: 'GET' as const, url: '/admin/refund-requests' },
      { method: 'GET' as const, url: `/admin/refund-requests/${id}` },
      { method: 'POST' as const, url: `/admin/refund-requests/${id}/approve`, payload: { expectedAmount: 499 } },
      { method: 'POST' as const, url: `/admin/refund-requests/${id}/reject`, payload: { code: 'used' } },
      { method: 'POST' as const, url: `/admin/refund-requests/${id}/note`, payload: { note: 'hi' } },
    ]

    for (const call of calls) {
      const response = await app.inject({ ...call, headers: auth(userId) })
      assert.equal(response.statusCode, 403, call.url)
    }

    assert.equal((await app.inject({ method: 'GET', url: '/admin/refund-requests' })).statusCode, 401)
  })

  it('lists open requests with Brazil’s withdrawals first, then the oldest, and filters by status and market', async () => {
    const { app, auth, adminId, ordinary, brazil, rejected } = await setup()
    const open = (await app.inject({ method: 'GET', url: '/admin/refund-requests', headers: auth(adminId) })).json<{
      counts: { pending: number; rejected: number; statutory: number; overdue: number }
      rows: { ref: string; statutory: boolean; excerpt: string; hasAttachment: boolean }[]
    }>()

    assert.deepEqual(
      open.rows.map((row) => row.ref),
      [brazil.ref, ordinary.ref],
    )
    assert.equal(open.counts.pending, 2)
    assert.equal(open.counts.rejected, 1)
    assert.equal(open.counts.statutory, 1)
    assert.equal(open.rows[1]?.hasAttachment, true)

    const decided = (await app.inject({ method: 'GET', url: '/admin/refund-requests?status=rejected', headers: auth(adminId) })).json<{ rows: { ref: string }[] }>()
    assert.deepEqual(
      decided.rows.map((row) => row.ref),
      [rejected.ref],
    )

    const other = (await app.inject({ method: 'GET', url: '/admin/refund-requests?market=other', headers: auth(adminId) })).json<{ rows: { ref: string }[] }>()
    assert.deepEqual(
      other.rows.map((row) => row.ref),
      [ordinary.ref],
    )

    assert.equal((await app.inject({ method: 'GET', url: '/admin/refund-requests?status=maybe', headers: auth(adminId) })).statusCode, 400)
  })

  it('opens a request with its screenshot, usage now, the plan and the customer', async () => {
    const { app, auth, adminId, ordinary } = await setup()
    const detail = (await app.inject({ method: 'GET', url: `/admin/refund-requests/${ordinary._id.toString()}`, headers: auth(adminId) })).json<{
      request: { ref: string; attachment: { bytes: number }; openKey?: string }
      attachmentUrl: string
      plan: { total: number; removes: string[]; payments: unknown[] }
      customer: { email: string; purchases: unknown[] }
      flagsNow: string[]
    }>()

    assert.equal(detail.request.ref, ordinary.ref)
    assert.deepEqual(detail.request.attachment, { bytes: 1200 })
    assert.equal(detail.request.openKey, undefined)
    assert.equal(detail.attachmentUrl, `https://media.test/${ordinary.attachment!.key}`)
    assert.equal(detail.plan.total, 499)
    assert.deepEqual(detail.plan.removes, ['Color Advisor: report and access'])
    assert.equal(detail.customer.email, 'nora@example.com')
    assert.equal(detail.customer.purchases.length, 3)
    assert.equal((await app.inject({ method: 'GET', url: `/admin/refund-requests/${new ObjectId().toString()}`, headers: auth(adminId) })).statusCode, 404)
  })

  it('checks what approving and rejecting send, and says why Stripe didn’t refund', async () => {
    const { app, auth, adminId, ordinary, brazil } = await setup()
    const id = ordinary._id.toString()
    const post = (path: string, payload: unknown) => app.inject({ method: 'POST', url: `/admin/refund-requests/${path}`, headers: auth(adminId), payload: payload as Record<string, unknown> })

    assert.equal((await post(`${id}/approve`, {})).statusCode, 400)
    assert.equal((await post(`${id}/approve`, { expectedAmount: 0 })).statusCode, 400)
    assert.equal((await post(`${id}/reject`, { code: 'because' })).statusCode, 400)
    assert.equal((await post(`${id}/reject`, { code: 'other', note: 'short' })).statusCode, 400)
    assert.equal((await post(`${id}/approve`, { expectedAmount: 999 })).statusCode, 409)

    // Without Stripe, the refund fails and the request says so.
    const failed = await post(`${id}/approve`, { expectedAmount: 499 })
    assert.equal(failed.statusCode, 502)
    assert.match(failed.json<{ message: string }>().message, /^Stripe didn't refund it: /)
    assert.equal(failed.json<{ request: { status: string } }>().request.status, 'failed')

    // Brazil's withdrawal: not without the override.
    const blocked = await post(`${brazil._id.toString()}/reject`, { code: 'duplicate' })
    assert.equal(blocked.statusCode, 409)
    const overridden = await post(`${brazil._id.toString()}/reject`, { code: 'duplicate', note: 'Pagou duas vezes; a outra cobrança já foi devolvida.', cdcOverride: true })
    assert.equal(overridden.statusCode, 200)
    assert.equal(overridden.json<{ request: { status: string; decision: { cdcOverride: boolean } } }>().request.decision.cdcOverride, true)

    const noted = await post(`${id}/note`, { note: 'Asked her for a screenshot of Safari.' })
    assert.equal(noted.json<{ request: { internalNote: string } }>().request.internalNote, 'Asked her for a screenshot of Safari.')
  })
})
