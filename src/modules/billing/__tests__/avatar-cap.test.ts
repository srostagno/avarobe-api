import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ProSubscription } from '../../../types/mongo.js'
import { withLocale } from '../../../utils/request-locale.js'
import {
  AvatarCapError,
  PaywallError,
  avatarRunsResetAt,
  billingState,
  releaseAvatarRun,
  serializeBilling,
  spendCredits,
  useAvatarRun,
} from '../entitlements.js'

const DAY = 24 * 60 * 60 * 1000
const inDays = (days: number) => new Date(Date.now() + days * DAY)

const pro = (overrides: Partial<ProSubscription> = {}): ProSubscription => ({
  subscriptionId: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  interval: 'month',
  periodEnd: inDays(20),
  cancelAtPeriodEnd: false,
  avatarCap: true,
  ...overrides,
})

function account(fields: Record<string, unknown> = {}) {
  const userId = new ObjectId()
  const { app, collection } = fakeApp({ users: [{ _id: userId, email: 'customer@example.com', ...fields }] })
  const user = () => collection('users').docs[0] as Record<string, unknown> & { pro?: ProSubscription; freeAvatarRuns?: number; credits?: number }

  return { app, userId, user }
}

describe('Pro’s avatar changes a month', () => {
  const before = { limit: env.PRO_AVATAR_RUNS_PER_MONTH, grandfather: env.PRO_AVATAR_GRANDFATHER, comp: env.COMP_EMAILS }

  beforeEach(() => {
    env.PRO_AVATAR_RUNS_PER_MONTH = 20
    env.PRO_AVATAR_GRANDFATHER = true
    env.COMP_EMAILS = 'founder@example.com'
  })

  afterEach(() => {
    env.PRO_AVATAR_RUNS_PER_MONTH = before.limit
    env.PRO_AVATAR_GRANDFATHER = before.grandfather
    env.COMP_EMAILS = before.comp
  })

  it('counts each render on Pro up to the limit, then says when more come', async () => {
    const { app, userId, user } = account({ pro: pro({ avatarRuns: 19 }) })

    assert.equal(await useAvatarRun(app, userId), 'pro')
    assert.equal(user().pro?.avatarRuns, 20)
    await assert.rejects(useAvatarRun(app, userId), (error: unknown) => {
      assert.ok(error instanceof AvatarCapError)
      assert.equal(error.limit, 20)
      assert.equal(error.resetsAt?.getTime(), user().pro?.periodEnd?.getTime())
      return true
    })
    assert.equal(user().pro?.avatarRuns, 20)
  })

  it('gives a failed render back, never below zero, and free renders stay used', async () => {
    const { app, userId, user } = account({ pro: pro({ avatarRuns: 1 }) })

    await releaseAvatarRun(app, userId, 'pro')
    await releaseAvatarRun(app, userId, 'pro')
    assert.equal(user().pro?.avatarRuns, 0)

    const free = account()
    assert.equal(await useAvatarRun(free.app, free.userId), 'free')
    await releaseAvatarRun(free.app, free.userId, 'free')
    assert.equal(free.user().freeAvatarRuns, 1)
  })

  it('leaves a subscription paid before the cap unlimited until its next payment, unless that’s off', async () => {
    const { app, userId, user } = account({ pro: pro({ avatarCap: undefined, avatarRuns: undefined }) })

    assert.equal(await useAvatarRun(app, userId), 'exempt')
    assert.equal(user().pro?.avatarRuns, undefined)
    assert.equal(serializeBilling(user() as never).proAvatarRuns, null)

    env.PRO_AVATAR_GRANDFATHER = false
    assert.equal(await useAvatarRun(app, userId), 'pro')
  })

  it('takes nothing from comp accounts, and the free renders from everyone else', async () => {
    const comp = account({ email: 'founder@example.com' })
    assert.equal(await useAvatarRun(comp.app, comp.userId), 'comp')

    const free = account({ freeAvatarRuns: env.FREE_AVATAR_RUNS })
    await assert.rejects(useAvatarRun(free.app, free.userId), PaywallError)
  })

  it('starts over with the trial’s end, annual’s next looks or the next monthly payment', () => {
    const trialEnd = inDays(5)
    assert.equal(avatarRunsResetAt(pro({ status: 'trialing', trialEnd, periodEnd: trialEnd })), trialEnd)
    const next = inDays(9)
    assert.equal(avatarRunsResetAt(pro({ interval: 'year', nextCreditsAt: next, periodEnd: inDays(300) })), next)
    // The year's last month: when it ends.
    const end = inDays(4)
    assert.equal(avatarRunsResetAt(pro({ interval: 'year', nextCreditsAt: inDays(30), periodEnd: end })), end)
    const monthly = pro()
    assert.equal(avatarRunsResetAt(monthly), monthly.periodEnd)
  })

  it('shows the web how many are left and until when', () => {
    const shown = serializeBilling({ email: 'customer@example.com', pro: pro({ avatarRuns: 7 }) }).proAvatarRuns
    assert.equal(shown?.left, 13)
    assert.equal(shown?.limit, 20)
    assert.ok(shown?.resetsAt)
    assert.equal(billingState({ email: 'customer@example.com' }).proAvatarRuns, null)
  })

  it('says it in the language of the page', () => {
    const resetsAt = new Date('2026-11-07T12:00:00Z')
    assert.equal(withLocale('en', () => new AvatarCapError(20, resetsAt).message), 'You’ve used this month’s 20 avatar changes. More on November 7.')
    assert.equal(withLocale('pt-BR', () => new AvatarCapError(20, resetsAt).message), 'Você já usou as 20 mudanças de avatar deste mês. Mais em 7 de novembro.')
    assert.equal(withLocale('es', () => new AvatarCapError(20, resetsAt).message), 'Ya usaste los 20 cambios de avatar de este mes. Tendrás más el 7 de noviembre.')
  })
})

describe('annual Pro’s first week, out of looks', () => {
  it('says when the rest of the month’s looks arrive', async () => {
    const at = inDays(5)
    const { app, userId } = account({ credits: 0, pro: pro({ interval: 'year', heldCredits: { amount: 20, at } }) })

    await assert.rejects(withLocale('en', () => spendCredits(app, userId, 1)), (error: unknown) => {
      assert.ok(error instanceof PaywallError)
      assert.equal(error.code, 'no_credits')
      assert.match(error.message, /You’ve used your first 10 looks\. The other 20 arrive on /)
      return true
    })
  })

  it('is the usual message once nothing is held', async () => {
    const { app, userId } = account({ credits: 0, pro: pro({ interval: 'year' }) })

    await assert.rejects(spendCredits(app, userId, 1), /You’ve used this month’s looks/)
  })
})
