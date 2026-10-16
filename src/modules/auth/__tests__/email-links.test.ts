import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { routeApp } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import type { UserDocument } from '../../../types/mongo.js'
import { createLink, durationMs, emailLink, studioPathOf } from '../../../utils/auth-links.js'
import authRoutes from '../routes.js'

// The sign-in links in our emails (Oct 14, 2026): an email opened in Gmail's
// own browser and again in Safari must land signed in both times; a used
// one-time link left a US buyer unable to pay on Oct 13.

const saved = { allow: env.EMAIL_DEV_ALLOWLIST, comp: env.COMP_EMAILS }

before(() => {
  env.EMAIL_DEV_ALLOWLIST = []
  env.COMP_EMAILS = 'owner@avarobe.test'
})

after(() => {
  env.EMAIL_DEV_ALLOWLIST = saved.allow
  env.COMP_EMAILS = saved.comp
})

function person(overrides: Partial<UserDocument> = {}): UserDocument {
  const now = new Date()
  return {
    _id: new ObjectId(),
    email: 'rosa@example.com',
    firstName: 'Rosa',
    credits: 0,
    createdAt: now,
    updatedAt: now,
    locale: 'en',
    ...overrides,
  } as UserDocument
}

const tokenOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('token') ?? '')

async function setup(user: UserDocument) {
  const built = await routeApp({ '/auth': authRoutes }, { users: [user] })
  const signIn = (token: string) => built.app.inject({ method: 'POST', url: '/auth/link', payload: { token } })
  const nextOf = async (token: string) => (await signIn(token)).json<{ next?: string }>().next
  return { ...built, signIn, nextOf }
}

describe('email links', () => {
  it('sign in every time, in any browser, and land where the email points', async () => {
    const rosa = person()
    const { app, signIn, collection } = await setup(rosa)
    const url = await emailLink(app, rosa, '/studio?buy=color_report&from=email_offer', { ads: { fbc: 'fb.1.1.abc' } })

    assert.ok(url.startsWith(`${env.APP_URL}/continue?token=`))

    for (const browser of ['gmail', 'safari', 'safari again']) {
      const response = await signIn(tokenOf(url))
      assert.equal(response.statusCode, 200, browser)
      const body = response.json<{ next: string; attribution: { fbc?: string } | null }>()
      assert.equal(body.next, '/studio?buy=color_report&from=email_offer')
      assert.equal(body.attribution?.fbc, 'fb.1.1.abc')
      assert.ok(response.cookies.some((cookie) => cookie.value), `${browser}: a session cookie`)
    }

    // The email it came by is theirs.
    assert.ok((collection('users').docs[0] as UserDocument).emailVerifiedAt)
  })

  it('are not voided by the next email, but a password change voids them', async () => {
    const rosa = person()
    const { app, signIn, collection } = await setup(rosa)
    const first = await emailLink(app, rosa, '/studio')
    await emailLink(app, rosa, '/studio/report')
    await createLink(app, rosa, 'sign_in', undefined, { next: '/studio' })

    assert.equal((await signIn(tokenOf(first))).statusCode, 200)

    await collection('users').updateOne({ _id: rosa._id }, { $set: { passwordUpdatedAt: new Date() } })
    assert.equal((await signIn(tokenOf(first))).statusCode, 400)
  })

  it('stop working for a deleted account, and never go to an admin', async () => {
    const rosa = person()
    const { app, signIn, collection } = await setup(rosa)
    const url = await emailLink(app, rosa, '/studio')

    await collection('users').updateOne({ _id: rosa._id }, { $set: { deletedAt: new Date() } })
    assert.equal((await signIn(tokenOf(url))).statusCode, 400)

    const owner = person({ email: 'owner@avarobe.test' })
    assert.equal(await emailLink(app, owner, '/studio?x=1'), `${env.APP_URL}/studio?x=1`)
  })

  it('only open studio pages', async () => {
    const rosa = person()
    const { app, nextOf } = await setup(rosa)
    const url = await emailLink(app, rosa, 'https://evil.example/steal')

    assert.equal(await nextOf(tokenOf(url)), '/studio')
  })
})

describe('studioPathOf', () => {
  it('reads the studio page a link opens, without its language, and nothing else', () => {
    assert.equal(studioPathOf(`${env.APP_URL}/pt-br/studio?buy=color_report&from=email_x`), '/studio?buy=color_report&from=email_x')
    assert.equal(studioPathOf(`${env.APP_URL}/es/studio/account#plan`), '/studio/account#plan')
    assert.equal(studioPathOf(`${env.APP_URL}/studio`), '/studio')
    assert.equal(studioPathOf(`${env.APP_URL}/pt-br/color-analysis`), null)
    assert.equal(studioPathOf(`${env.APP_URL}/studiox`), null)
    assert.equal(studioPathOf('https://evil.example/studio'), null)
    assert.equal(studioPathOf('not a link'), null)
  })

  it('reads lifetimes as the env writes them', () => {
    assert.equal(durationMs('14d'), 14 * 24 * 60 * 60 * 1000)
    assert.equal(durationMs('12h'), 12 * 60 * 60 * 1000)
    assert.equal(durationMs('90'), 90 * 1000)
    assert.equal(durationMs('soon'), null)
  })
})

describe('verification link', () => {
  it('opened again (or in another browser) still signs in while valid', async () => {
    const rosa = person()
    const { app } = await setup(rosa)
    const url = await createLink(app, rosa, 'verify_email')
    const verify = () => app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: tokenOf(url) } })

    assert.equal((await verify()).statusCode, 200)
    const again = await verify()
    assert.equal(again.statusCode, 200)
    assert.ok(again.cookies.some((cookie) => cookie.value))
  })
})

describe('sign-in link by email', () => {
  it('lands where they were (the Buy that needed it) and works in any browser', async () => {
    const rosa = person()
    const { app, signIn, nextOf } = await setup(rosa)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/link/email',
      payload: { email: 'rosa@example.com', next: '/studio?buy=color_report&from=colors_offer' },
    })
    const link = response.json<{ devLink?: string }>().devLink

    assert.ok(link)
    assert.equal(await nextOf(tokenOf(link)), '/studio?buy=color_report&from=colors_offer')
    assert.equal((await signIn(tokenOf(link))).statusCode, 200)
  })
})
