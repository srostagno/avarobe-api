import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { emailCopy } from '../../../i18n/emails.js'
import type { UserDocument } from '../../../types/mongo.js'
import { safeNextPath } from '../../../utils/auth-links.js'
import type { Locale } from '../../../utils/locale.js'
import { proTourLinkDue, proTourPath, type CrossSellKind } from '../cross-sell.js'
import { crossSellContentFor, proCreditOffer } from '../service.js'
import { crossSellEmail, type CrossSellContent } from '../templates.js'

const now = new Date('2026-10-14T15:00:00Z')
const until = new Date('2026-10-24T18:00:00Z')
const checkout = 'https://www.avarobe.com/continue?token=buy'
const proUrl = 'https://www.avarobe.com/continue?token=pro'
const tourUrl = 'https://www.avarobe.com/continue?token=tour'
const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=x' }
const LINK: Record<Locale, string> = {
  en: 'See what Pro does · 1 min',
  'pt-BR': 'Veja o que o Pro faz · 1 min',
  es: 'Mira lo que hace Pro · 1 min',
}
const MARKETS = [
  { locale: 'en', region: 'us', currency: 'usd', price: 2500, regular: 2999, credit: 499 },
  { locale: 'pt-BR', region: 'br', currency: 'brl', price: 8500, regular: 9990, credit: 1490 },
  { locale: 'es', region: 'mx', currency: 'mxn', price: 42000, regular: 49900, credit: 7900 },
] as const

function email(kind: CrossSellKind, overrides: Partial<CrossSellContent> & { locale?: Locale; region?: 'us' | 'br' | 'mx' } = {}) {
  return crossSellEmail({
    ...recipient,
    kind,
    price: 799,
    regular: null,
    currency: 'usd',
    until: null,
    side: null,
    owns: { color: true, style: false },
    url: checkout,
    season: 'Warm Autumn',
    colors: [],
    now,
    ...overrides,
  })
}

describe('the Pro tour link in the first cross-sells', () => {
  const due = { on: true, withProCredit: true, colorReport: true, colorsRead: true, presentation: 'womenswear' as const }

  it('goes only to whom the web plays the tour, under the credit block', () => {
    assert.equal(proTourLinkDue(due), true)
    assert.equal(proTourLinkDue({ ...due, presentation: null }), true)
    assert.equal(proTourLinkDue({ ...due, presentation: 'unisex' }), true)
    // Menswear gets the Pro sheet on the web, not the tour.
    assert.equal(proTourLinkDue({ ...due, presentation: 'menswear' }), false)
    // Not without the block (Pro, comp, the day-1/day-3 emails are past).
    assert.equal(proTourLinkDue({ ...due, withProCredit: false }), false)
    // The tour needs her colors and the Color Advisor.
    assert.equal(proTourLinkDue({ ...due, colorReport: false }), false)
    assert.equal(proTourLinkDue({ ...due, colorsRead: false }), false)
    // PRO_TOUR_EMAIL_LINK=off.
    assert.equal(proTourLinkDue({ ...due, on: false }), false)
  })

  it('lands on /studio?see=pro tagged as an email, which a sign-in link keeps', () => {
    const path = proTourPath('xsell_style')

    assert.equal(path, '/studio?see=pro&utm_source=email&utm_medium=lifecycle&utm_campaign=xsell_style')
    assert.equal(safeNextPath(path), path)
  })

  for (const market of MARKETS) {
    it(`shows it under the Pro block, after its checkout, in ${market.locale}`, () => {
      const proCredit = { price: market.price, regular: market.regular, credit: market.credit, from: 'color' as const, until, url: proUrl }
      const base = { locale: market.locale, region: market.region, currency: market.currency, price: 691 }
      const mail = email('xsell_style', { ...base, proCredit: { ...proCredit, tourUrl } })
      const label = LINK[market.locale]

      assert.ok(mail.text.includes(`${label}: ${tourUrl}`), market.locale)
      assert.ok(mail.html.includes(tourUrl) && mail.html.includes(label), market.locale)
      // Under the block's own checkout, before the signature.
      assert.ok(mail.text.indexOf(proUrl) < mail.text.indexOf(tourUrl), market.locale)
      assert.ok(mail.text.indexOf(tourUrl) < mail.text.lastIndexOf(emailCopy(market.locale).common.team), market.locale)
      // Without it, the block as before.
      const plain = email('xsell_style', { ...base, proCredit })
      assert.ok(!plain.text.includes(label) && plain.html.includes(proUrl), market.locale)
    })
  }

  it('stays out of the Pro email, where Pro is the whole offer', () => {
    const proCredit = { price: 2500, regular: 2999, credit: 499, from: 'color' as const, until, url: checkout, tourUrl }
    const mail = email('xsell_pro', { price: 2500, regular: 2999, until, proCredit })

    assert.ok(!mail.text.includes(LINK.en) && !mail.html.includes(tourUrl))
  })

  it('rides from the send into the block', () => {
    const user: UserDocument = {
      _id: new ObjectId(),
      email: 'nora@example.com',
      firstName: 'Nora',
      createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      updatedAt: now,
      lastLoginAt: null,
      emailVerifiedAt: now,
      locale: 'pt-BR',
      location: { country: 'BR', region: null, source: 'edge', at: now },
      colorReportAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    }
    const credit = proCreditOffer(user, now)
    const link = { url: 'https://x/style', side: null, heroUrl: null, gift: null, cut: null, edit: null, occasionUrls: [], credit, proCreditUrl: proUrl }

    assert.equal(crossSellContentFor('xsell_style', user, undefined, { ...link, proTourUrl: tourUrl }, now).proCredit?.tourUrl, tourUrl)
    assert.equal(crossSellContentFor('xsell_style', user, undefined, link, now).proCredit?.tourUrl, null)
  })
})

describe('the official Pro list and the event line', () => {
  const ROLLOVER: Record<Locale, string> = {
    en: 'Unused looks stay in your account, up to 60.',
    'pt-BR': 'Os looks que você não usar continuam na sua conta, até 60.',
    es: 'Los looks que no uses se quedan en tu cuenta, hasta 60.',
  }

  for (const locale of ['en', 'pt-BR', 'es'] as const) {
    it(`says how many looks stay, and promises no budget, in ${locale}`, () => {
      const c = emailCopy(locale)
      const list = c.proIncludes.list({ credits: 30, eventLooks: 3, checks: 10, avatarRuns: 20, rollover: 60 }).join(' ')

      assert.ok(list.includes(ROLLOVER[locale]), list)
      assert.doesNotMatch(c.crossSell.eventFeatures.join(' '), /budget|orçamento|presupuesto|near you|perto de você|cerca de ti/i)
      assert.ok(c.crossSell.proCredit.tourLink.endsWith('· 1 min'))
    })
  }

  it('prints the cap the API enforces in the emails’ list', () => {
    const mail = email('xsell_pro', { price: 799 })

    assert.ok(mail.text.includes(ROLLOVER.en), mail.text)
  })
})
