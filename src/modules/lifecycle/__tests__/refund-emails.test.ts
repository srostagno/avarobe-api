import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { env } from '../../../config/env.js'
import type { RefundRequestDocument } from '../../../types/mongo.js'
import type { Locale } from '../../../utils/locale.js'
import { decisionEmailFor, founderEmail, receivedEmailFor, reminderDigest } from '../../billing/refund-notify.js'

const LOCALES: Locale[] = ['en', 'pt-BR', 'es']

// Prices come with a no-break space where the language puts one.
const plain = (text: string) => text.replace(/\u00a0/g, ' ')

function request(fields: Partial<RefundRequestDocument> = {}): RefundRequestDocument {
  const paidAt = new Date('2026-10-07T15:00:00Z')

  return {
    _id: new ObjectId(),
    ref: 'R-7F3K2Q',
    source: 'account',
    userId: new ObjectId(),
    guideOrderId: null,
    purchaseId: new ObjectId(),
    product: 'color_report',
    covers: [
      {
        purchaseId: new ObjectId(),
        guideOrderId: null,
        product: 'color_report',
        amount: 1490,
        currency: 'brl',
        paidAt,
        stripePaymentIntentId: 'pi_1',
        stripeInvoiceId: null,
      },
    ],
    amount: 1490,
    currency: 'brl',
    amountUsd: 268,
    purchasedAt: paidAt,
    email: 'nora@example.com',
    emailHash: 'hash',
    firstName: 'Nora',
    locale: 'en',
    targetKey: 'p:1',
    openKey: 'p:1',
    market: {
      currency: 'brl',
      region: 'br',
      signupCountry: 'BR',
      requestCountry: 'BR',
      card: { brand: 'visa', last4: '0002', country: 'BR', fingerprint: 'fp' },
      disputed: false,
    },
    within7d: true,
    statutory: null,
    oldGuarantee: false,
    reasonCategory: 'not_accurate',
    explanation: 'Warm colors wash me out. <script>alert(1)</script>\nAn analyst in person gave me Winter.',
    attachment: null,
    usage: {
      at: new Date('2026-10-08T15:00:00Z'),
      hoursSincePurchase: 24,
      colorReportOpenedAt: new Date('2026-10-07T15:10:00Z'),
      styleReportOpenedAt: null,
      hairReadAt: null,
      drapeAt: null,
      looksMade: 0,
      looksWithCredit: 0,
      creditsGiven: 0,
      creditsLeft: 1,
      hairstylesMade: 0,
      eventsStyled: 0,
      magazinesMade: 0,
      checksMade: 2,
      avatarRuns: null,
      guideDownloads: null,
      guideLastDownloadAt: null,
      lastSeenAt: new Date('2026-10-08T14:00:00Z'),
      events: {},
    },
    history: {
      refundsBefore: 1,
      requestsBefore: 1,
      approvedBefore: 1,
      rejectedBefore: 0,
      openRequests: 0,
      purchases: 2,
      paidUsd: 536,
      accountCreatedAt: new Date('2026-10-01T15:00:00Z'),
      channel: 'meta',
      campaign: 'launch_br',
      cardSeenOn: 0,
    },
    flags: ['repeat', 'used'],
    proPause: null,
    status: 'pending',
    decision: null,
    attempts: [],
    refund: null,
    internalNote: null,
    emails: { founderAt: null, receivedAt: null, decisionAt: null, reminderAt: null },
    createdAt: new Date('2026-10-08T15:00:00Z'),
    updatedAt: new Date('2026-10-08T15:00:00Z'),
    ...fields,
  }
}

const decided = (outcome: 'approved' | 'rejected', fields: Partial<NonNullable<RefundRequestDocument['decision']>> = {}) => ({
  outcome,
  by: 'admin' as const,
  adminId: new ObjectId(),
  adminEmail: 'admin@example.test',
  at: new Date('2026-10-09T15:00:00Z'),
  code: null,
  note: null,
  cdcOverride: false,
  ...fields,
})

describe('the refund request emails', () => {
  it('confirm a request in the customer’s language, with its ref, amount and what approval removes', () => {
    const expected = {
      en: { subject: 'We got your refund request', price: 'R$14.90', removed: 'what it unlocked, its report included, is removed from your account', day: 'October 7' },
      'pt-BR': { subject: 'Recebemos seu pedido de reembolso', price: 'R$ 14,90', removed: 'o que ela liberou, incluindo o relatório, é removido da sua conta', day: '7 de outubro' },
      es: { subject: 'Recibimos tu solicitud de reembolso', price: 'BRL 14.90', removed: 'lo que desbloqueó, incluido su reporte, se quita de tu cuenta', day: '7 de octubre' },
    }

    for (const locale of LOCALES) {
      const mail = receivedEmailFor(request({ locale }))
      const words = expected[locale]

      assert.equal(mail.subject, words.subject, locale)
      assert.ok(mail.text.includes('R-7F3K2Q'), locale)
      assert.ok(plain(mail.text).includes(words.price), locale)
      assert.ok(mail.text.includes(words.removed), locale)
      assert.ok(mail.text.includes(words.day), locale)
      // Transactional: no unsubscribe link, and replies welcome.
      assert.ok(!mail.html.includes('unsubscribe'), locale)
      assert.ok(mail.html.includes('mailto:hello@avarobe.com'), locale)
    }
  })

  it('say Pro’s renewal is paused only with a pause, and Brazil’s right only for a withdrawal', () => {
    const plain = receivedEmailFor(request())
    const pro = receivedEmailFor(request({ product: 'pro_monthly', proPause: { subscriptionId: 'sub_1', wasCancelAtPeriodEnd: false, at: new Date(), restoredAt: null } }))
    const withdrawal = receivedEmailFor(request({ locale: 'pt-BR', statutory: { law: 'br_cdc_49', until: new Date('2026-10-15T02:59:59.999Z') } }))

    assert.ok(!plain.text.includes('Pro won’t renew'))
    assert.ok(!plain.text.includes('right of withdrawal'))
    assert.ok(pro.text.includes('Pro won’t renew while we review your request.'))
    assert.ok(pro.text.includes('Pro ends, and the looks it added that are left are removed'))
    assert.ok(withdrawal.text.includes('direito de arrependimento (art. 49 do Código de Defesa do Consumidor)'))
  })

  it('name what approval removes for a look pack and the book', () => {
    assert.ok(receivedEmailFor(request({ product: 'look_pack' })).text.includes('the looks it added that are left are removed'))
    assert.ok(receivedEmailFor(request({ product: 'outfit_guide' })).text.includes('the book’s download link stops working'))
  })

  it('tell them it was approved, with what went back', () => {
    for (const [locale, subject] of [
      ['en', 'Your refund is on its way'],
      ['pt-BR', 'Seu reembolso está a caminho'],
      ['es', 'Tu reembolso va en camino'],
    ] as const) {
      const mail = decisionEmailFor(
        request({ locale, status: 'refunded', decision: decided('approved'), refund: { stripeRefundIds: ['re_1'], amount: 1490, via: 'admin', at: new Date(), partial: false } }),
        { proRenewsAt: null },
      )

      assert.equal(mail.subject, subject)
      assert.ok(mail.text.includes('R-7F3K2Q'))
    }
  })

  it('tell them why it wasn’t approved, each reason in their language, with the founder’s note escaped', () => {
    const reasons = {
      en: 'Why: We checked your account, and the product works and delivers what its page describes.',
      'pt-BR': 'Motivo: Verificamos sua conta, e o produto funciona e entrega o que a página dele descreve.',
      es: 'Motivo: Revisamos tu cuenta, y el producto funciona y entrega lo que describe su página.',
    }

    for (const locale of LOCALES) {
      const mail = decisionEmailFor(
        request({ locale, status: 'rejected', decision: decided('rejected', { code: 'works_as_described', note: 'Your report <b>is</b> right.\nTry daylight.' }) }),
        { proRenewsAt: null },
      )

      assert.ok(mail.text.includes(reasons[locale]), locale)
      assert.ok(mail.html.includes('Your report &lt;b&gt;is&lt;/b&gt; right.<br>Try daylight.'), locale)
      assert.ok(!mail.html.includes('<b>is</b>'), locale)
    }

    for (const code of ['resolved', 'used', 'outside_policy', 'duplicate', 'withdrawn'] as const) {
      const mail = decisionEmailFor(request({ status: 'rejected', decision: decided('rejected', { code }) }), { proRenewsAt: null })
      assert.match(mail.text, /Why: \S/, code)
    }

    // 'other': only the note.
    const other = decisionEmailFor(request({ status: 'rejected', decision: decided('rejected', { code: 'other', note: 'You paid twice; we refunded the other charge.' }) }), {
      proRenewsAt: null,
    })
    assert.ok(!other.text.includes('Why:'))
    assert.ok(other.text.includes('You paid twice; we refunded the other charge.'))
  })

  it('say Pro renews again only when its renewal was put back', () => {
    const rejected = request({ product: 'pro_monthly', status: 'rejected', decision: decided('rejected', { code: 'used' }) })

    assert.ok(decisionEmailFor(rejected, { proRenewsAt: new Date('2026-11-01T12:00:00Z') }).text.includes('renews on November 1'))
    assert.ok(!decisionEmailFor(rejected, { proRenewsAt: null }).text.includes('renews on'))
  })
})

describe('the founder’s email', () => {
  const plan = { total: 1490, currency: 'brl', endsPro: false }
  const account = { createdAt: new Date('2026-10-01T15:00:00Z'), location: { country: 'BR', region: 'SP', source: 'edge' as const, at: new Date() }, locale: 'pt-BR' as const, acquisition: null }

  it('says who, what, why and what approving does, in Spanish, with the link to decide', () => {
    const doc = request()
    const mail = founderEmail({ request: doc, account, plan, removesEs: ['el Asesor de Color (reporte y acceso)'], test: false })

    assert.equal(plain(mail.subject), 'Reembolso R-7F3K2Q: Asesor de Color · R$ 14,90 · nora@example.com')
    assert.ok(mail.text.includes(`${env.APP_URL}/studio/admin/refunds?request=${doc._id.toString()}`))
    assert.ok(mail.text.includes('Motivo: Sus colores o su estación no coinciden'))
    assert.ok(mail.text.includes('Tarjeta: visa ••0002 (BR)'))
    assert.ok(mail.text.includes('Reporte de colores: abierto el'))
    assert.ok(mail.text.includes('Ya tuvo 1 reembolso'))
    assert.ok(plain(mail.text).includes('Se devuelven R$ 14,90 a la tarjeta y se quita: el Asesor de Color (reporte y acceso).'))
    // What they wrote, quoted and escaped.
    assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(!mail.html.includes('<script>'))
  })

  it('marks a Brazilian withdrawal, the old guarantee and a test in the subject, on one line', () => {
    const doc = request({
      statutory: { law: 'br_cdc_49', until: new Date('2026-10-15T02:59:59.999Z') },
      oldGuarantee: true,
      email: 'nora@example.com\r\nBcc: someone@example.com',
    })
    const mail = founderEmail({ request: doc, account, plan, removesEs: [], test: true })

    assert.match(mail.subject, /^\[BR art\. 49\] \[Garantía antigua\] \[PRUEBA\] Reembolso R-7F3K2Q/)
    assert.ok(!/[\r\n]/.test(mail.subject))
    assert.ok(mail.text.includes('DERECHO DE ARREPENTIMIENTO (Brasil, CDC art. 49)'))
    assert.ok(mail.text.includes('Compra hecha con la garantía antigua'))
  })

  it('names pesos by their code, never a bare "$" that reads as dollars', () => {
    const mxn = founderEmail({ request: request({ amount: 7900, currency: 'mxn', amountUsd: 435 }), account, plan: { total: 7900, currency: 'mxn', endsPro: false }, removesEs: [], test: false })
    const cop = founderEmail({ request: request({ amount: 1190000, currency: 'cop', amountUsd: 298 }), account, plan: { total: 1190000, currency: 'cop', endsPro: false }, removesEs: [], test: false })

    assert.equal(plain(mxn.subject), 'Reembolso R-7F3K2Q: Asesor de Color · MXN 79.00 · nora@example.com')
    assert.ok(plain(mxn.text).includes('Se devuelven MXN 79.00 a la tarjeta'))
    assert.equal(plain(cop.subject), 'Reembolso R-7F3K2Q: Asesor de Color · COP 11.900 · nora@example.com')
  })

  it('reminds of the requests waiting, each with its link', () => {
    const doc = request({ statutory: { law: 'br_cdc_49', until: new Date() } })
    const digest = reminderDigest([doc], new Date('2026-10-09T05:00:00Z'))

    assert.equal(digest.subject, '[BR art. 49] Reembolsos por decidir: 1')
    assert.ok(digest.text.includes('pedida hace 14 h · BR art. 49: hay que reembolsarla'))
    assert.ok(digest.text.includes(`/studio/admin/refunds?request=${doc._id.toString()}`))
  })
})
