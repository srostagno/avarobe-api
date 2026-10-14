import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp, type Doc } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { EmailSendDocument, UserDocument } from '../../../types/mongo.js'
import type { Locale } from '../../../utils/locale.js'
import { pickLifecycleEmail } from '../schedule.js'
import { costumeOfferNames, sendCostumeOffers, stateFor } from '../service.js'
import { costumeOfferEmail } from '../templates.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const now = new Date('2026-10-14T15:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const later = (ms: number) => new Date(now.getTime() + ms)
const POSTAL = 'Avarobe, 1 Example Street, Dublin'
const saved = { postal: env.EMAIL_POSTAL_ADDRESS, comp: env.COMP_EMAILS }

before(() => {
  env.EMAIL_POSTAL_ADDRESS = POSTAL
  env.COMP_EMAILS = 'admin@example.test'
})

after(() => {
  env.EMAIL_POSTAL_ADDRESS = saved.postal
  env.COMP_EMAILS = saved.comp
})

// A saved account that came through the Halloween flow: Medusa tried on
// free, two costumes picked while the avatar was drawing.
function flow(options: { user?: Doc; look?: Doc } = {}) {
  const userId = new ObjectId()
  const lookId = new ObjectId()
  const user: Doc = {
    _id: userId,
    email: 'nora@example.com',
    firstName: 'Nora',
    createdAt: ago(2 * HOUR),
    updatedAt: ago(2 * HOUR),
    lastLoginAt: null,
    emailVerifiedAt: null,
    claimedAt: ago(90 * MINUTE),
    freeTryOns: 1,
    lookPicks: { ids: ['hw-ghost-bride', 'hw-ice-queen'], at: ago(2 * HOUR) },
    ...options.user,
  }
  const look: Doc = {
    _id: lookId,
    userId,
    source: 'tryon',
    iconId: 'hw-medusa',
    freeTryOn: true,
    status: 'ready',
    imageKey: `users/${userId.toString()}/look-${lookId.toString()}.jpg`,
    createdAt: ago(HOUR + 10 * MINUTE),
    readyAt: ago(HOUR + 5 * MINUTE),
    ...options.look,
  }
  const fake = fakeApp({ users: [user], looks: [look] })
  // The sign-in links' payloads, to see where the button lands.
  const signed: Doc[] = []
  ;(fake.app as unknown as { jwt: { sign: (payload: Doc) => Promise<string> } }).jwt.sign = async (payload) => {
    signed.push(payload)
    return `test-token-${signed.length}`
  }
  const offered = () => Boolean((fake.collection('users').docs[0] as UserDocument).lifecycleEmails?.costume_offer)
  const sends = () => fake.collection('emailSends').docs as EmailSendDocument[]

  return { ...fake, userId, lookId, signed, offered, sends }
}

describe('the costume offer email', () => {
  it('goes once to a non-Pro account an hour after its free costume try-on, with it and the picks', async () => {
    const { app, userId, signed, offered, sends, logs, collection } = flow()

    await sendCostumeOffers(app, now)

    assert.equal(offered(), true)
    assert.equal(sends().length, 1)
    assert.equal(sends()[0]!.kind, 'costume_offer')
    assert.equal(sends()[0]!.subject, 'You as Medusa 🎃')
    assert.equal((collection('users').docs[0] as UserDocument).lifecycleEmailLastAt?.getTime(), now.getTime())
    // Signed in on the Halloween Edit (and on every other studio link in it,
    // like their account's settings), by email links.
    const edit = signed.find((payload) => payload.nx === '/studio/halloween?from=email')
    assert.ok(edit)
    assert.equal(edit.typ, 'email')
    assert.equal(String(edit.sub), userId.toString())
    assert.ok(signed.every((payload) => payload.typ === 'email' && String(payload.sub) === userId.toString()))
    // Their try-on on top, and both picks.
    const line = logs.find((entry) => entry.msg === 'Costume offer email')?.obj as Doc | undefined
    assert.deepEqual(
      { costume: line?.costume, picks: line?.picks, photo: line?.photo },
      { costume: 'hw-medusa', picks: 2, photo: true },
    )
    assert.ok(logs.some((entry) => entry.msg === 'Dev email (not sent)' && (entry.obj as Doc).subject === 'You as Medusa 🎃'))
  })

  it('waits the hour after the try-on is ready', async () => {
    const { app, offered } = flow({ look: { readyAt: ago(30 * MINUTE) } })

    await sendCostumeOffers(app, now)
    assert.equal(offered(), false)

    await sendCostumeOffers(app, later(31 * MINUTE))
    assert.equal(offered(), true)
  })

  it('never goes twice', async () => {
    const { app, sends } = flow()

    await sendCostumeOffers(app, now)
    await sendCostumeOffers(app, later(10 * MINUTE))
    await sendCostumeOffers(app, later(DAY))

    assert.equal(sends().length, 1)
  })

  it('skips Pro (a trial too)', async () => {
    const pro = { subscriptionId: 'sub_1', customerId: 'cus_1', status: 'trialing', interval: 'month', periodEnd: later(7 * DAY), cancelAtPeriodEnd: false }
    const { app, offered, sends } = flow({ user: { pro } })

    await sendCostumeOffers(app, now)

    assert.equal(offered(), false)
    assert.equal(sends().length, 0)
  })

  it('skips guests, until they save', async () => {
    const { app, offered, collection } = flow({ user: { guest: true, email: `${new ObjectId().toString()}@guest.avarobe.invalid` } })

    await sendCostumeOffers(app, now)
    assert.equal(offered(), false)

    await collection('users').updateOne({}, { $unset: { guest: '' }, $set: { email: 'nora@example.com' } })
    await sendCostumeOffers(app, later(MINUTE))
    assert.equal(offered(), true)
  })

  it('skips admins, deleted accounts and anyone who turned off tips', async () => {
    for (const user of [{ email: 'admin@example.test' }, { deletedAt: ago(MINUTE) }, { emailTipsOptOutAt: ago(DAY) }]) {
      const { app, offered } = flow({ user })

      await sendCostumeOffers(app, now)
      assert.equal(offered(), false, JSON.stringify(user))
    }
  })

  it('only follows a costume tried on free, and not after three days', async () => {
    for (const look of [{ freeTryOn: false }, { iconId: 'fall-pumpkin-patch' }, { status: 'failed' }, { readyAt: ago(3 * DAY + HOUR) }]) {
      const { app, offered } = flow({ look })

      await sendCostumeOffers(app, now)
      assert.equal(offered(), false, JSON.stringify(look))
    }
  })

  it('needs the postal address: it is promotional', async () => {
    const { app, offered, sends } = flow()
    env.EMAIL_POSTAL_ADDRESS = undefined

    try {
      assert.equal(await sendCostumeOffers(app, now), 0)
      assert.equal(offered(), false)
      assert.equal(sends().length, 0)
    } finally {
      env.EMAIL_POSTAL_ADDRESS = POSTAL
    }
  })

  it('gives the claim back when the email can’t be made, for the next run', async () => {
    const { app, offered, sends } = flow()
    ;(app as unknown as { jwt: { sign: () => Promise<string> } }).jwt.sign = async () => {
      throw new Error('signing is down')
    }

    await sendCostumeOffers(app, now)

    assert.equal(offered(), false)
    assert.equal(sends().length, 0)
  })
})

describe('the welcome, for the Halloween flow', () => {
  const base: UserDocument = {
    _id: new ObjectId(),
    email: 'nora@example.com',
    firstName: 'Nora',
    createdAt: ago(20 * MINUTE),
    updatedAt: ago(20 * MINUTE),
    lastLoginAt: null,
    emailVerifiedAt: null,
  }
  const due = (user: UserDocument) => pickLifecycleEmail(stateFor(user, undefined, { count: 0, lastAt: null }), now)

  it('stays out: the costume offer is their first email', () => {
    assert.equal(due(base), 'welcome')
    assert.equal(due({ ...base, lookPicks: { ids: ['hw-medusa'], at: ago(15 * MINUTE) } }), null)
    assert.equal(due({ ...base, freeTryOns: 1 }), null)
    // Picks cleared and no free try-on: the welcome as before.
    assert.equal(due({ ...base, lookPicks: null, freeTryOns: 0 }), 'welcome')
  })
})

describe('the costume offer’s names', () => {
  it('come in their language, without the costume they tried, with the next two Edits', () => {
    const picks = ['hw-ghost-bride', 'hw-medusa', 'hw-ice-queen', 'hw-ghost-bride', 'not-a-look']

    assert.deepEqual(costumeOfferNames('en', 'hw-medusa', picks, now), {
      costume: 'Medusa',
      picks: ['Ghost Bride', 'Ice Queen'],
      next: [
        { name: 'The Last-Minute Costume Edit', emoji: '🦇', at: '2026-10-20' },
        { name: 'The Sweater Weather Edit', emoji: '🧶', at: '2026-10-27' },
      ],
    })
    const es = costumeOfferNames('es', 'hw-medusa', picks, now)
    assert.deepEqual(es.picks, ['Novia Fantasma', 'Reina de Hielo'])
    assert.equal(es.next[0]!.name, 'Edit Disfraz de Último Minuto')
    assert.deepEqual(costumeOfferNames('pt-BR', 'hw-medusa', picks, now).picks, ['Noiva Fantasma', 'Rainha do Gelo'])
  })

  it('leave out an Edit once it dropped in New York', () => {
    // 1 a.m. UTC on the 20th is still the 19th in New York.
    assert.equal(costumeOfferNames('en', 'hw-medusa', [], new Date('2026-10-20T01:00:00Z')).next[0]!.at, '2026-10-20')
    assert.equal(costumeOfferNames('en', 'hw-medusa', [], new Date('2026-10-20T15:00:00Z')).next[0]!.at, '2026-10-27')
  })
})

describe('the costume offer template', () => {
  const recipient = { firstName: 'Nora', email: 'nora@example.com', unsubscribeUrl: 'https://www.avarobe.com/email/unsubscribe?t=x' }
  const photo = 'https://api.avarobe.com/api/v1/email/i/abc/look-0123456789abcdef01234567.jpg?e=1&s=sig'
  const url = 'https://www.avarobe.com/continue?token=x&utm_source=email&utm_medium=lifecycle&utm_campaign=costume_offer'
  const next = [
    { name: 'The Last-Minute Costume Edit', emoji: '🦇', at: '2026-10-20' },
    { name: 'The Sweater Weather Edit', emoji: '🧶', at: '2026-10-27' },
  ]
  const email = (overrides: Partial<Parameters<typeof costumeOfferEmail>[0]> = {}) =>
    costumeOfferEmail({ ...recipient, costume: 'Medusa', picks: ['Ghost Bride', 'Ice Queen'], photoUrl: photo, next, url, ...overrides })

  before(() => {
    env.EMAIL_POSTAL_ADDRESS = POSTAL
  })

  it('carries the costume in the subject and the heading, their try-on on top, and the button', () => {
    const mail = email()

    assert.equal(mail.subject, 'You as Medusa 🎃')
    assert.ok(mail.text.includes('You as Medusa\n'), mail.text)
    assert.ok(mail.html.includes('>You as Medusa</h1>'))
    assert.ok(mail.html.includes(`src="${photo.replace(/&/g, '&amp;')}"`))
    assert.ok(mail.text.includes('The costumes you picked are waiting: Ghost Bride and Ice Queen are ready to try on you.'))
    assert.ok(mail.text.includes('🦇 The Last-Minute Costume Edit · Oct 20\n🧶 The Sweater Weather Edit · Oct 27'))
    assert.ok(mail.text.includes(`Try on my next costumes: ${url}`))
    assert.ok(mail.html.includes(url.replace(/&/g, '&amp;')))
    // Promotional: the postal address in the footer.
    assert.ok(mail.text.includes(POSTAL) && mail.html.includes(POSTAL))
  })

  it('reads well with one pick, none, and no picture', () => {
    assert.ok(email({ picks: ['Ghost Bride'] }).text.includes('The costume you picked is waiting: Ghost Bride is ready to try on you.'))
    assert.ok(email({ picks: [] }).text.includes('every costume in it is ready to try on you.'))
    assert.ok(email({ picks: ['A', 'B', 'C'] }).text.includes('A, B and C are ready to try on you.'))
    const stock = email({ photoUrl: null, next: [] })
    assert.ok(stock.html.includes('/email/occasions.jpg'))
    assert.ok(!stock.text.includes('Coming next'.toUpperCase()))
  })

  for (const locale of ['en', 'es', 'pt-BR'] as Locale[]) {
    it(`says no price, nothing free and no AI, in ${locale}`, () => {
      const mail = email({ locale, region: locale === 'en' ? 'us' : locale === 'es' ? 'mx' : 'br' })
      const all = [mail.subject, mail.text, mail.html].join('\n')

      assert.ok(mail.subject.includes('Medusa') && mail.subject.endsWith('🎃'), mail.subject)
      assert.ok(mail.html.includes(`<html lang="${locale}"`))
      assert.doesNotMatch(all, /\$|free|gr[aá]tis/i)
      assert.doesNotMatch(all, /\bAI\b|\bIA\b/)
      assert.ok(!all.includes('undefined') && !all.includes('[object'), locale)
    })
  }
})
