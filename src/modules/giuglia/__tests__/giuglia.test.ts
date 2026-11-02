import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { routeApp, until } from '../../../__tests__/color-reads.js'
import { env } from '../../../config/env.js'
import { GIUGLIA_TOPICS, giugliaAnswer, type GiugliaContext } from '../answers.js'
import giugliaRoutes from '../routes.js'

type Ask = { ai: boolean; disclosure: string; code?: string; answer: { topic: string; text: string; action: string | null } }
type Intro = { ai: boolean; disclosure: string; topics: string[] }

// Giuglia in the app (Nov 2026, E-1102-giuglia1): behind GIUGLIA_IN_APP, she
// answers a tapped doubt from the person's own result, says she's an AI and
// keeps only the topic.

const savedFlag = env.GIUGLIA_IN_APP
const savedColorPro = env.COLOR_PRO_TRIAL_DAYS

before(() => {
  env.COLOR_PRO_TRIAL_DAYS = 7
})

after(() => {
  env.GIUGLIA_IN_APP = savedFlag
  env.COLOR_PRO_TRIAL_DAYS = savedColorPro
})

const analysis = {
  season: 'Soft Autumn',
  undertone: 'warm',
  contrast: 'low',
  summary: 'Warm and soft.',
  bestColors: [],
  neutrals: [],
  avoidColors: [],
  metals: 'gold',
  confidence: 'high',
  photoNote: null,
}

async function setup(options: { colors?: boolean; country?: string; user?: Record<string, unknown> } = {}) {
  const userId = new ObjectId()
  const built = await routeApp(
    { '/giuglia': giugliaRoutes },
    {
      users: [
        {
          _id: userId,
          email: 'ana@example.com',
          credits: 0,
          createdAt: new Date(),
          location: options.country ? { country: options.country } : null,
          ...options.user,
        },
      ],
      avatars: [{ _id: new ObjectId(), userId, status: 'ready', versions: [], colorAnalysis: options.colors === false ? null : analysis }],
    },
  )
  const headers = built.auth(userId)
  const ask = (body: unknown, locale = 'en') =>
    built.app.inject({ method: 'POST', url: '/giuglia/ask', headers: { ...headers, 'x-avarobe-locale': locale }, payload: body as object })
  const events = () => built.collection('analyticsEvents').docs as Array<Record<string, unknown>>

  return { ...built, headers, ask, events }
}

describe('Giuglia in the app', () => {
  it('is off by default: both routes answer 404', async () => {
    env.GIUGLIA_IN_APP = false
    const { app, headers, ask } = await setup()

    assert.equal((await app.inject({ method: 'GET', url: '/giuglia', headers })).statusCode, 404)
    assert.equal((await ask({ topic: 'price', placement: 'results' })).statusCode, 404)
  })

  it('needs a signed-in person', async () => {
    env.GIUGLIA_IN_APP = true
    const { app } = await setup()

    assert.equal((await app.inject({ method: 'POST', url: '/giuglia/ask', payload: { topic: 'price', placement: 'results' } })).statusCode, 401)
  })

  it('says she is an AI and lists the doubts she answers', async () => {
    env.GIUGLIA_IN_APP = true
    const { app, headers } = await setup()
    const response = await app.inject({ method: 'GET', url: '/giuglia', headers: { ...headers, 'x-avarobe-locale': 'es' } })

    assert.equal(response.statusCode, 200)
    const body = response.json<Intro>()
    assert.equal(body.ai, true)
    assert.match(body.disclosure, /asistente con IA/)
    assert.deepEqual(body.topics, [...GIUGLIA_TOPICS])
  })

  it('answers the price from her region and season, and keeps only the topic', async () => {
    env.GIUGLIA_IN_APP = true
    const { ask, events } = await setup({ country: 'BR' })
    const response = await ask({ topic: 'price', placement: 'checkout' }, 'pt-BR')

    assert.equal(response.statusCode, 200)
    const body = response.json<Ask>()
    assert.equal(body.ai, true)
    assert.equal(body.answer.action, 'checkout')
    assert.match(body.answer.text, /R\$/)
    assert.match(body.answer.text, /7 dias de Pro/)
    assert.match(body.answer.text, /reembolso em até 7 dias/)

    await until(async () => events().length === 1)
    const [event] = events()
    assert.equal(event!.name, 'giuglia_question')
    assert.deepEqual(event!.props, { topic: 'price', placement: 'checkout', region: 'br', owns: false, action: 'checkout' })
  })

  it('names her season in her language when she asks about accuracy', async () => {
    env.GIUGLIA_IN_APP = true
    const { ask } = await setup()
    const body = (await ask({ topic: 'accuracy', placement: 'results' }, 'es')).json<Ask>()

    assert.match(body.answer.text, /tu lectura fue clara/)
    assert.equal(body.answer.action, 'studio')
    assert.match((await ask({ topic: 'later', placement: 'results' }, 'es')).json<Ask>().answer.text, /Otoño Suave/)
  })

  it('never sells the Color Advisor to who already has it', async () => {
    env.GIUGLIA_IN_APP = true
    const { ask } = await setup({ user: { colorReportAt: new Date() } })
    const body = (await ask({ topic: 'price', placement: 'results' })).json<Ask>()

    assert.equal(body.answer.action, 'studio')
    assert.match(body.answer.text, /You already have your full Soft Autumn palette/)
    assert.doesNotMatch(body.answer.text, /\$/)
  })

  it('waits for her colors, and refuses free text or unknown topics', async () => {
    env.GIUGLIA_IN_APP = true
    const { ask } = await setup({ colors: false })
    const none = await ask({ topic: 'price', placement: 'results' })

    assert.equal(none.statusCode, 409)
    assert.equal(none.json<Ask>().code, 'no_colors')

    const withText = await (await setup()).ask({ topic: 'other', placement: 'results', text: 'my email is ana@example.com' })
    assert.equal(withText.statusCode, 400)
    assert.equal((await (await setup()).ask({ topic: 'refund', placement: 'results' })).statusCode, 400)
  })
})

describe('giugliaAnswer', () => {
  const context: GiugliaContext = {
    season: 'Soft Autumn',
    confidence: 'medium',
    colorPrice: '$14.90',
    proMonthlyPrice: '$10.90',
    colorProDays: null,
    ownsColorAdvisor: false,
    refundDays: 7,
  }

  it('only mentions Pro and its renewal when the days come with it', () => {
    assert.doesNotMatch(giugliaAnswer('price', context, 'en').text, /Pro/)
    const withPro = giugliaAnswer('price', { ...context, colorProDays: 7 }, 'en').text
    assert.match(withPro, /7 days of Pro/)
    assert.match(withPro, /renews at \$10\.90 a month unless you cancel/)
  })

  it('answers every topic in every language', () => {
    for (const locale of ['en', 'es', 'pt-BR'] as const) {
      for (const topic of GIUGLIA_TOPICS) {
        assert.ok(giugliaAnswer(topic, context, locale).text.length > 20, `${locale} ${topic}`)
      }
    }
  })
})
