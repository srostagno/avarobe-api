import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { form, memoryStorage, photo, routeApp } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { RefundRequestDocument } from '../../../types/mongo.js'
import guideRoutes from '../../guide/routes.js'
import billingRoutes from '../routes.js'

const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms)
const WHY = 'The season it gave me is wrong: warm colors make my face look grey and tired in every photo I take.'
const PT = { 'x-avarobe-locale': 'pt-BR' }

const saved = { stripe: env.STRIPE_SECRET_KEY, refunds: env.REFUNDS_EMAIL, allow: env.EMAIL_DEV_ALLOWLIST }
const files = memoryStorage()

before(() => {
  // No Stripe here (the card's details are best effort) and no real inbox.
  env.STRIPE_SECRET_KEY = undefined
  env.REFUNDS_EMAIL = ['founder@example.test']
  env.EMAIL_DEV_ALLOWLIST = []
})

after(() => {
  env.STRIPE_SECRET_KEY = saved.stripe
  env.REFUNDS_EMAIL = saved.refunds
  env.EMAIL_DEV_ALLOWLIST = saved.allow
  files.restore()
})

async function setup() {
  const userId = new ObjectId()
  const purchaseId = new ObjectId()
  const routes = await routeApp(
    { '/billing': billingRoutes, '/guide': guideRoutes },
    {
      users: [{ _id: userId, email: 'nora@example.com', firstName: 'Nora', createdAt: ago(30 * DAY), colorReportAt: ago(DAY) }],
      purchases: [
        {
          _id: purchaseId,
          userId,
          product: 'color_report',
          stripeSessionId: 'cs_color',
          stripePaymentIntentId: 'pi_color',
          amountTotal: 499,
          currency: 'usd',
          credits: 0,
          createdAt: ago(DAY),
          refundedAt: null,
        },
      ],
      guideOrders: [
        {
          _id: new ObjectId(),
          sessionId: 'cs_book',
          email: 'guest@example.com',
          userId: null,
          token: 'download_token_abcdefghijkl',
          refundToken: 'refund_token_abcdefghijklm',
          amount: 1490,
          currency: 'usd',
          paymentIntentId: 'pi_book',
          downloads: 0,
          lastDownloadAt: null,
          emailedAt: new Date(),
          createdAt: ago(DAY),
          refundedAt: null,
        },
      ],
    },
    { languages: true },
  )

  return { ...routes, userId, purchaseId, requests: () => routes.collection('refundRequests').docs as unknown as RefundRequestDocument[] }
}

describe('asking for a refund from the account page', () => {
  it('takes the form with a screenshot, keeps the screenshot and lists the request', async () => {
    const { app, auth, userId, purchaseId, requests } = await setup()
    const body = await form(
      { purchaseId: purchaseId.toString(), category: 'not_accurate', explanation: WHY, acknowledge: 'true' },
      { screenshot: await photo([200, 120, 90]) },
      auth(userId),
    )

    const created = await app.inject({ method: 'POST', url: '/billing/refund-requests', ...body })

    assert.equal(created.statusCode, 201)
    const json = created.json<{ request: { status: string; ref: string }; purchases: { refundableUntil: string | null; refundRequest: unknown }[]; refunds: { mode: string } }>()
    assert.equal(json.request.status, 'pending')
    assert.equal(json.refunds.mode, 'request')
    assert.equal(json.purchases[0]?.refundableUntil, null)
    assert.ok(json.purchases[0]?.refundRequest)
    const stored = requests()[0]!
    assert.equal(stored.attachment?.key, `users/${userId.toString()}/refund-${stored._id.toString()}.jpg`)
    assert.ok(files.files.has(stored.attachment.key))

    // Twice: the same request (200).
    const again = await app.inject({ method: 'POST', url: '/billing/refund-requests', ...(await form({ purchaseId: purchaseId.toString(), category: 'not_accurate', explanation: WHY, acknowledge: 'true' }, {}, auth(userId))) })
    assert.equal(again.statusCode, 200)
    assert.equal(again.json<{ request: { ref: string } }>().request.ref, json.request.ref)

    const listed = await app.inject({ method: 'GET', url: '/billing/refund-requests', headers: auth(userId) })
    assert.equal(listed.json<{ requests: unknown[] }>().requests.length, 1)

    const purchases = await app.inject({ method: 'GET', url: '/billing/purchases', headers: auth(userId) })
    const list = purchases.json<{ purchases: { refundRequest: { status: string } | null; withdrawal: unknown }[]; refunds: { mode: string; minChars: number } }>()
    assert.equal(list.refunds.mode, 'request')
    assert.equal(list.refunds.minChars, 80)
    assert.equal(list.purchases[0]?.refundRequest?.status, 'pending')
    assert.equal(list.purchases[0]?.withdrawal, null)
  })

  it('answers the form’s problems in the page’s language', async () => {
    const { app, auth, userId, purchaseId } = await setup()
    const short = await app.inject({
      method: 'POST',
      url: '/billing/refund-requests',
      ...(await form({ purchaseId: purchaseId.toString(), category: 'not_accurate', explanation: 'Não gostei.', acknowledge: 'true' }, {}, { ...auth(userId), ...PT })),
    })

    assert.equal(short.statusCode, 400)
    assert.equal(short.json<{ message: string }>().message, 'Conte um pouco mais sobre o que aconteceu, com suas palavras.')

    const missing = await app.inject({ method: 'POST', url: '/billing/refund-requests', ...(await form({ purchaseId: new ObjectId().toString() }, {}, { ...auth(userId), ...PT })) })
    assert.equal(missing.statusCode, 404)
    assert.equal(missing.json<{ message: string }>().message, 'Não encontramos esta compra.')
  })

  it('refuses a screenshot over 8 MB', async () => {
    const { app, auth, userId, purchaseId, requests } = await setup()
    const big = Buffer.alloc(8 * 1024 * 1024 + 1024, 1)
    const response = await app.inject({
      method: 'POST',
      url: '/billing/refund-requests',
      ...(await form({ purchaseId: purchaseId.toString(), category: 'technical', explanation: WHY, acknowledge: 'true' }, { screenshot: big }, auth(userId))),
    })

    assert.equal(response.statusCode, 400)
    assert.equal(response.json<{ message: string }>().message, 'The screenshot must be an image under 8 MB.')
    assert.equal(requests().length, 0)
  })

  it('answers the old one-tap refund with 409 refund_review, in the page’s language', async () => {
    const { app, auth, userId, purchaseId } = await setup()
    const response = await app.inject({
      method: 'POST',
      url: '/billing/refund',
      headers: { ...auth(userId), ...PT },
      payload: { purchaseId: purchaseId.toString(), reason: 'mistake' },
    })

    assert.equal(response.statusCode, 409)
    assert.deepEqual(response.json(), {
      code: 'refund_review',
      message: 'Os reembolsos agora são analisados pela nossa equipe: peça o seu em Compras, na sua conta.',
    })
  })
})

describe('asking for the book’s refund from its link', () => {
  it('takes a guest’s request, and the order then shows it instead of a refund', async () => {
    const { app, requests } = await setup()
    const before = await app.inject({ method: 'GET', url: '/guide/order/refund_token_abcdefghijklm' })
    const order = before.json<{ refundableUntil: unknown; requestableUntil: string | null; refundRequest: unknown }>()

    assert.equal(order.refundableUntil, null)
    assert.ok(order.requestableUntil)
    assert.equal(order.refundRequest, null)

    const created = await app.inject({
      method: 'POST',
      url: '/guide/refund-requests',
      headers: { 'x-avarobe-locale': 'es' },
      payload: { token: 'refund_token_abcdefghijklm', category: 'not_expected', explanation: WHY, acknowledge: true },
    })

    assert.equal(created.statusCode, 201)
    assert.equal(requests()[0]?.locale, 'es')
    const after = (await app.inject({ method: 'GET', url: '/guide/order/refund_token_abcdefghijklm' })).json<{ requestableUntil: unknown; refundRequest: { status: string } }>()
    assert.equal(after.requestableUntil, null)
    assert.equal(after.refundRequest.status, 'pending')

    const legacy = await app.inject({ method: 'POST', url: '/guide/refund', headers: { 'x-avarobe-locale': 'es' }, payload: { token: 'refund_token_abcdefghijklm' } })
    assert.equal(legacy.statusCode, 409)
    assert.deepEqual(legacy.json(), {
      code: 'refund_review',
      message: 'Ahora nuestro equipo revisa los reembolsos: solicítalo desde el enlace del correo de tu libro.',
    })
  })

  it('never takes the download link as the key', async () => {
    const { app } = await setup()
    const response = await app.inject({
      method: 'POST',
      url: '/guide/refund-requests',
      payload: { token: 'download_token_abcdefghijkl', category: 'not_expected', explanation: WHY, acknowledge: true },
    })

    assert.equal(response.statusCode, 404)
  })
})
