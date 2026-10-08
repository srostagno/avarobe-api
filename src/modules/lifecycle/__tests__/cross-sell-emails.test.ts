import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatMoney } from '../../../i18n/emails.js'
import type { Locale } from '../../../utils/locale.js'
import type { CrossSellKind } from '../cross-sell.js'
import { crossSellEmail, type CrossSellContent } from '../templates.js'

const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=x' }
const now = new Date('2026-10-14T15:00:00Z')
const photo = 'https://api.avarobe.com/api/v1/email/i/abc/xsell_style.jpg?e=1&s=sig'
const checkout = 'https://www.avarobe.com/continue?token=buy'
const COLORS = [
  { name: 'Rust', hex: '#A0482A' },
  { name: 'Olive', hex: '#5B5A2C' },
]
const inHtml = (url: string) => url.replace(/&/g, '&amp;')

function email(
  kind: CrossSellKind,
  overrides: Partial<CrossSellContent> & { locale?: Locale; region?: 'us' | 'br' | 'mx'; firstName?: string } = {},
) {
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
    colors: COLORS,
    now,
    ...overrides,
  })
}

describe('cross-sell emails lead with their own picture', () => {
  it('Style Advisor: the gift look in their #1 color, a link to it, and the pair price', () => {
    const gift = { url: 'https://www.avarobe.com/continue?token=look', color: 'Rust' }
    const mail = email('xsell_style', { heroUrl: photo, gift, price: 691, regular: 790, until: new Date('2026-10-20T20:00:00Z') })
    assert.equal(mail.subject, 'We styled a look around your #1 color: Rust')
    assert.ok(mail.html.includes(`src="${inHtml(photo)}"`))
    assert.ok(mail.html.includes(gift.url) && mail.html.includes('Open my gift look'))
    assert.ok(mail.html.includes(checkout))
    assert.match(mail.text, /Instead of \$7\.90, because you have the Color Advisor\./)
    // Without the picture: the stock one and the words that go with it.
    const stock = email('xsell_style', { gift: null, heroUrl: null })
    assert.equal(stock.subject, 'You know your colors. Now see your shapes.')
    assert.ok(stock.html.includes('/email/style.jpg'))
    assert.ok(!stock.text.includes('gift look'))
  })

  it('Color Advisor: their drape photo, best side blurred, and no colors', () => {
    const mail = email('xsell_color', { heroUrl: photo, colors: [], owns: { color: false, style: true }, price: 499 })
    assert.equal(mail.subject, 'Your best side is still blurred')
    assert.ok(mail.text.includes('The blurred part is you in your best colors'))
    assert.doesNotMatch(mail.text, /Your season:/)
    assert.equal(email('xsell_color', { colors: [], owns: { color: false, style: true } }).subject, 'You know your shapes. Now find your colors.')
  })

  it('Hair & Grooming: their ideal cut on them, by name, and the five others', () => {
    const mail = email('xsell_hair', { heroUrl: photo, cut: 'Soft curtain bangs', price: 790 })
    assert.equal(mail.subject, 'Your ideal cut, on you')
    assert.ok(mail.text.includes('Your ideal cut: Soft curtain bangs.'))
    assert.ok(mail.text.includes('the other five cuts'))
    assert.equal(email('xsell_hair', { cut: 'Soft curtain bangs' }).subject, 'See your next haircut before you get it')
  })

  it('Pro: this week’s Edit on them, monthly, with its checkout over the Edits', () => {
    const edit = { id: 'fall-weddings-2026', name: 'The Fall Wedding Guest Edit', tagline: 'Never in white.' }
    const mail = email('xsell_pro', { heroUrl: photo, edit })
    assert.equal(mail.subject, 'We tried the Fall Wedding Guest Edit on you')
    assert.ok(mail.text.includes('$7.99 a month'))
    assert.ok(mail.text.includes('30 looks a month'))
    assert.ok(mail.text.includes('Pro renews monthly until you cancel'))
    assert.ok(mail.html.includes('Get Avarobe Pro · $7.99/mo'))
    // No picture: the stock one, still naming the Edit.
    const stock = email('xsell_pro', { edit })
    assert.equal(stock.subject, 'A new collection every week, tried on you')
    assert.ok(stock.text.includes('This week it’s the Fall Wedding Guest Edit.'))
    assert.ok(stock.html.includes('/email/occasions.jpg'))
  })

  it('a new Edit: on them when it could be made, and Pro’s email without one', () => {
    const edit = { id: 'fall-weddings-2026', name: 'The Fall Wedding Guest Edit', tagline: 'Never in white.' }
    assert.equal(email('xsell_edit', { heroUrl: photo, edit }).subject, 'The Fall Wedding Guest Edit just dropped, and here it is on you')
    const stock = email('xsell_edit', { edit })
    assert.equal(stock.subject, 'The Fall Wedding Guest Edit just dropped')
    assert.ok(stock.text.includes('Never in white.'))
    assert.equal(email('xsell_edit', { edit: null }).subject, 'A new collection every week, tried on you')
  })

  it('Event Stylist: three occasions to start from, each with its own link, and the price', () => {
    const occasionUrls = ['https://x/continue?token=a', 'https://x/continue?token=b', 'https://x/continue?token=c']
    const mail = email('xsell_event', { heroUrl: photo, occasionUrls, price: 490 })
    assert.equal(mail.subject, 'Something coming up?')
    for (const [index, label] of ['Wedding', 'Work event', 'Date'].entries()) {
      assert.ok(mail.text.includes(`${label}: ${occasionUrls[index]}`))
    }
    assert.ok(mail.text.includes('$4.90 an event'))
    assert.ok(mail.text.includes('That’s your latest look'))
    // Without the send's links: plain links with the occasion filled in.
    const plain = email('xsell_event', { price: 490 })
    assert.ok(plain.html.includes('/studio/events?occasion=A+wedding'))
    assert.ok(!plain.text.includes('latest look'))
  })

  it('magazine: their cover, with their name', () => {
    const mail = email('xsell_magazine', { heroUrl: photo, price: 990 })
    assert.equal(mail.subject, 'Nora, on the cover')
    assert.ok(mail.html.includes(`src="${inHtml(photo)}"`))
    assert.equal(email('xsell_magazine', { firstName: '', heroUrl: photo }).subject, 'You, on the cover')
  })

  it('book: their palette beside it, for Color Advisor owners only', () => {
    const owner = email('xsell_guide', { price: 1490 })
    assert.ok(owner.text.includes('120 outfit formulas, and here’s your palette to use with them.'))
    assert.ok(owner.html.includes('#A0482A'))
    const other = email('xsell_guide', { price: 1490, colors: [], owns: { color: false, style: true } })
    assert.ok(!other.html.includes('#A0482A'))
    assert.ok(!other.text.includes('your palette to use'))
  })
})

describe('cross-sell emails in every language', () => {
  const EDITS: Record<Locale, string> = {
    en: 'The Fall Wedding Guest Edit',
    'pt-BR': 'Edit Convidada de Casamento de Outono',
    es: 'Edit Invitada de Boda de Otoño',
  }
  const MARKETS = [
    { locale: 'en', region: 'us', currency: 'usd' },
    { locale: 'pt-BR', region: 'br', currency: 'brl' },
    { locale: 'es', region: 'mx', currency: 'mxn' },
  ] as const
  // Subjects with their picture, by language.
  const SUBJECTS: Record<Locale, Partial<Record<CrossSellKind, string>>> = {
    en: {
      xsell_style: 'We styled a look around your #1 color: Rust',
      xsell_color: 'Your best side is still blurred',
      xsell_hair: 'Your ideal cut, on you',
      xsell_pro: 'We tried the Fall Wedding Guest Edit on you',
      xsell_edit: 'The Fall Wedding Guest Edit just dropped, and here it is on you',
      xsell_event: 'Something coming up?',
      xsell_magazine: 'Nora, on the cover',
    },
    'pt-BR': {
      xsell_style: 'Montamos um look em torno da sua cor nº 1: Rust',
      xsell_color: 'Seu melhor lado continua desfocado',
      xsell_hair: 'Seu corte ideal, em você',
      xsell_pro: 'Provamos o Edit Convidada de Casamento de Outono em você',
      xsell_edit: 'O Edit Convidada de Casamento de Outono acabou de chegar, e aqui está ele em você',
      xsell_event: 'Tem algum evento chegando?',
      xsell_magazine: 'Nora, na capa',
    },
    es: {
      xsell_style: 'Armamos un look alrededor de tu color #1: Rust',
      xsell_color: 'Tu mejor lado sigue difuminado',
      xsell_hair: 'Tu corte ideal, en ti',
      xsell_pro: 'Te probamos el Edit Invitada de Boda de Otoño',
      xsell_edit: 'Acaba de llegar el Edit Invitada de Boda de Otoño, y así se te ve',
      xsell_event: '¿Tienes algún evento pronto?',
      xsell_magazine: 'Nora, en la portada',
    },
  }
  const KINDS: CrossSellKind[] = ['xsell_style', 'xsell_color', 'xsell_hair', 'xsell_pro', 'xsell_edit', 'xsell_event', 'xsell_magazine', 'xsell_guide']

  for (const { locale, region, currency } of MARKETS) {
    it(`write every variant in ${locale}, with and without their picture`, () => {
      const edit = { id: 'fall-weddings-2026', name: EDITS[locale], tagline: 'Tagline.' }
      const personal = {
        locale,
        region,
        currency,
        price: 2490,
        gift: { url: 'https://www.avarobe.com/continue?token=look', color: 'Rust' },
        cut: 'Bob',
        edit,
        occasionUrls: ['https://x/a', 'https://x/b', 'https://x/c'],
      }

      for (const kind of KINDS) {
        const mine = email(kind, { ...personal, heroUrl: photo })
        const stock = email(kind, personal)
        const expected = SUBJECTS[locale][kind]

        if (expected) {
          assert.equal(mine.subject, expected, `${locale} ${kind}`)
        }

        assert.ok(mine.html.includes(`<html lang="${locale}"`), `${locale} ${kind}`)
        assert.ok(mine.text.includes(formatMoney(2490, currency, locale)), `${locale} ${kind} price`)
        // The picture only when the send has it.
        assert.equal(stock.html.includes(inHtml(photo)), false, `${locale} ${kind}`)
        assert.equal(mine.html.includes(inHtml(photo)), kind !== 'xsell_guide', `${locale} ${kind}`)

        for (const part of [mine.text, stock.text, mine.subject, stock.subject]) {
          assert.ok(!part.includes('undefined') && !part.includes('[object'), `${locale} ${kind}`)
        }
      }

      // The book is in English: said in the other languages.
      const book = email('xsell_guide', personal)
      assert.equal(/inglés|inglês/.test(book.text), locale !== 'en')
    })
  }
})
