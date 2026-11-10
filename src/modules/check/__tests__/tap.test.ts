import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { routeApp, until } from '../../../__tests__/color-reads.js'
import checkRoutes from '../routes.js'
import { deltaE2000, hexToLab, tapVerdict } from '../tap.js'

// A Warm Autumn palette, with optic white and pure black to keep away.
const palette = {
  bestColors: [
    { name: 'Rust', hex: '#B7410E' },
    { name: 'Olive', hex: '#808000' },
    { name: 'Teal', hex: '#008080' },
    { name: 'Mustard', hex: '#E1AD01' },
    { name: 'Terracotta', hex: '#E2725B' },
  ],
  neutrals: [
    { name: 'Camel', hex: '#C19A6B' },
    { name: 'Chocolate', hex: '#7B3F00' },
    { name: 'Ivory', hex: '#FFFFF0' },
  ],
  avoidColors: [
    { name: 'Fuchsia', hex: '#FF00FF' },
    { name: 'Icy blue', hex: '#A5F2F3' },
    { name: 'Black', hex: '#000000' },
    { name: 'Optic white', hex: '#FFFFFF' },
  ],
}

describe('CIEDE2000', () => {
  it('matches the published test data (Sharma, Wu & Dalal 2005)', () => {
    const pairs: [[number, number, number], [number, number, number], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    ]

    for (const [a, b, expected] of pairs) {
      assert.ok(Math.abs(deltaE2000(a, b) - expected) < 1e-4, `${deltaE2000(a, b)} vs ${expected}`)
      assert.ok(Math.abs(deltaE2000(b, a) - expected) < 1e-4)
    }
  })

  it('reads hex as sRGB Lab (white is L 100, black L 0) and rejects anything else', () => {
    assert.ok(Math.abs(hexToLab('#FFFFFF')![0] - 100) < 1e-3)
    assert.deepEqual(hexToLab('#000000'), [0, 0, 0])
    assert.deepEqual(hexToLab('#fff'), hexToLab('#FFFFFF'))
    assert.equal(hexToLab('red'), null)
  })
})

describe('tapVerdict', () => {
  it('a palette color is a wear at ΔE 0, with three other best colors as alternatives', () => {
    const result = tapVerdict('#B7410E', palette)

    assert.deepEqual(result, {
      hex: '#B7410E',
      verdict: 'wear',
      reasonKey: 'in_palette',
      nearest: { name: 'Rust', hex: '#B7410E', list: 'best', deltaE: 0 },
      alternatives: [
        { name: 'Terracotta', hex: '#E2725B' },
        { name: 'Mustard', hex: '#E1AD01' },
        { name: 'Olive', hex: '#808000' },
      ],
    })
  })

  it('an avoid color is an avoid at ΔE 0', () => {
    const result = tapVerdict('#FF00FF', palette)

    assert.equal(result?.verdict, 'avoid')
    assert.equal(result?.reasonKey, 'near_avoid')
    assert.deepEqual(result?.nearest, { name: 'Fuchsia', hex: '#FF00FF', list: 'avoid', deltaE: 0 })
    assert.ok(result?.alternatives.length === 3)
  })

  it('a color far from everything is an avoid (far_from_palette)', () => {
    const result = tapVerdict('#0000FF', palette)

    assert.equal(result?.verdict, 'avoid')
    assert.equal(result?.reasonKey, 'far_from_palette')
    assert.ok((result?.nearest.deltaE ?? 0) > 20)
  })

  it('grades by distance: same family is wear, a near neutral is away', () => {
    assert.equal(tapVerdict('#B9450F', palette)?.reasonKey, 'in_palette')
    assert.deepEqual(
      [tapVerdict('#6B8E23', palette)?.verdict, tapVerdict('#6B8E23', palette)?.reasonKey, tapVerdict('#6B8E23', palette)?.nearest.name],
      ['wear', 'close_to_palette', 'Olive'],
    )
    assert.deepEqual([tapVerdict('#D2B48C', palette)?.verdict, tapVerdict('#D2B48C', palette)?.reasonKey], ['wear', 'neutral_base'])
    assert.deepEqual([tapVerdict('#E8C898', palette)?.verdict, tapVerdict('#E8C898', palette)?.reasonKey], ['away', 'near_neutral'])
  })

  it('handles white, black and grey with the same math', () => {
    // Optic white is on the avoid list; a warm off-white lands on Ivory.
    assert.equal(tapVerdict('#FFFFFF', palette)?.verdict, 'avoid')
    assert.deepEqual([tapVerdict('#FAF5E6', palette)?.verdict, tapVerdict('#FAF5E6', palette)?.nearest.name], ['wear', 'Ivory'])
    assert.deepEqual([tapVerdict('#1A1A1A', palette)?.verdict, tapVerdict('#1A1A1A', palette)?.nearest.name], ['avoid', 'Black'])
    // A mid grey is nowhere near a warm palette.
    assert.equal(tapVerdict('#808080', palette)?.reasonKey, 'far_from_palette')
  })

  it('is deterministic and case-insensitive', () => {
    const first = tapVerdict('#9e7b55', palette)

    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(tapVerdict('#9E7B55', palette), first)
    }
  })

  it('rejects an invalid hex and a palette with nothing to compare', () => {
    for (const hex of ['#FFF', 'FFFFFF', '#GGGGGG', 'red', '#FFFFFF0', '']) {
      assert.equal(tapVerdict(hex, palette), null, hex)
    }

    assert.equal(tapVerdict('#FFFFFF', { bestColors: [], neutrals: [], avoidColors: [] }), null)
  })
})

describe('POST /check/tap', () => {
  async function setup(withColors = true, user: Record<string, unknown> = { colorReportAt: new Date() }) {
    const userId = new ObjectId()
    const colorAnalysis = { season: 'Warm Autumn', undertone: 'warm', contrast: 'medium', ...palette }
    const routes = await routeApp(
      { '/check': checkRoutes },
      {
        users: [{ _id: userId, email: 'tap@example.test', createdAt: new Date(), ...user }],
        avatars: [{ _id: new ObjectId(), userId, ...(withColors ? { colorAnalysis } : {}) }],
      },
    )

    return { ...routes, userId }
  }

  it('answers from the saved palette, saves nothing but the event', async () => {
    const { app, auth, userId, collection } = await setup()
    const response = await app.inject({ method: 'POST', url: '/check/tap', headers: auth(userId), payload: { hex: '#e2725b' } })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { ...tapVerdict('#E2725B', palette), freeLeft: 2 })
    assert.equal(collection('colorChecks').docs.length, 0)
    assert.equal(collection('usageCounters').docs.length, 0)

    // The event is recorded without holding up the reply.
    await until(async () => collection('analyticsEvents').docs.length > 0)
    const events = collection('analyticsEvents').docs

    assert.equal(events.length, 1)
    assert.equal(events[0]?.name, 'color_tap_check')
    assert.deepEqual(events[0]?.props, { verdict: 'wear', pro: false })
  })

  it('takes one free check per photo with the Color Advisor, then Pro', async () => {
    const { app, auth, userId, collection } = await setup()
    const tap = (photo: string, hex = '#B7410E') => app.inject({ method: 'POST', url: '/check/tap', headers: auth(userId), payload: { hex, photo } })

    assert.equal((await tap('photoaaaa1')).json<{ freeLeft: number | null }>().freeLeft, 2)
    // More taps on the same photo are free.
    assert.equal((await tap('photoaaaa1', '#808000')).json<{ freeLeft: number | null }>().freeLeft, 2)
    assert.equal((await tap('photobbbb2')).json<{ freeLeft: number | null }>().freeLeft, 1)
    assert.equal((await tap('photocccc3')).json<{ freeLeft: number | null }>().freeLeft, 0)
    assert.equal((await tap('photocccc3', '#008080')).statusCode, 200)

    const blocked = await tap('photodddd4')

    assert.equal(blocked.statusCode, 402)
    assert.equal(blocked.json<{ code: string }>().code, 'needs_pro')
    const user = collection('users').docs[0]
    assert.deepEqual(user?.freeUses, { color_tap: 3 })
    assert.deepEqual(user?.colorTapPhotos, ['photoaaaa1', 'photobbbb2', 'photocccc3'])
    // A bad photo id is a 400.
    assert.equal((await tap('BAD ID')).statusCode, 400)
  })

  it('needs the Color Advisor; Pro has no limit', async () => {
    const free = await setup(true, {})
    const response = await free.app.inject({ method: 'POST', url: '/check/tap', headers: free.auth(free.userId), payload: { hex: '#B7410E' } })

    assert.equal(response.statusCode, 402)
    assert.equal(response.json<{ code: string }>().code, 'needs_color_report')

    const periodEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
    const pro = await setup(true, { pro: { status: 'active', periodEnd, interval: 'month' } })

    for (let i = 0; i < 5; i += 1) {
      const tapped = await pro.app.inject({ method: 'POST', url: '/check/tap', headers: pro.auth(pro.userId), payload: { hex: '#B7410E', photo: `photopro${i}` } })

      assert.equal(tapped.statusCode, 200)
      assert.equal(tapped.json<{ freeLeft: number | null }>().freeLeft, null)
    }

    assert.equal(pro.collection('users').docs[0]?.freeUses, undefined)
  })

  it('400 on a bad hex or extra fields, 401 signed out, 409 without colors', async () => {
    const { app, auth, userId } = await setup()

    for (const payload of [{ hex: '#FFF' }, { hex: 'red' }, {}, { hex: '#FFFFFF', name: 'x' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/check/tap', headers: auth(userId), payload })).statusCode, 400, JSON.stringify(payload))
    }

    assert.equal((await app.inject({ method: 'POST', url: '/check/tap', payload: { hex: '#FFFFFF' } })).statusCode, 401)

    const bare = await setup(false)
    const response = await bare.app.inject({ method: 'POST', url: '/check/tap', headers: bare.auth(bare.userId), payload: { hex: '#FFFFFF' } })

    assert.equal(response.statusCode, 409)
    assert.deepEqual(response.json(), { message: 'We need your colors first: send a selfie.' })
  })
})
