import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import { ObjectId } from 'mongodb'

import { classicReply, failure, memoryStorage, stubOpenAi, type AiCall } from '../../../__tests__/color-reads.js'
import { fakeApp } from '../../../__tests__/fake-app.js'
import { env } from '../../../config/env.js'
import type { ColorAnalysis, ColorReadLog } from '../../../types/mongo.js'
import { withLocale } from '../../../utils/request-locale.js'
import { runColorsJob } from '../service.js'

// The scored read's two calls: what each asks OpenAI, a close call measured
// once more, and a model that refuses the fixed settings.

const files = memoryStorage()
const ai = stubOpenAi()

after(() => {
  files.restore()
  ai.restore()
})

beforeEach(() => {
  ai.calls.length = 0
  ai.state.reply = null
  ai.state.scores = { warmth: 2, depth: 4, chroma: -1, contrast: 2 }
  env.COLOR_READ_METHOD = 'scored'
})

type Content = { type: string; text?: string; image_url?: string; detail?: string }
const contentOf = (call: AiCall) => (call.body.input as { content: Content[] }[])[0]!.content
const imageOf = (call: AiCall) => contentOf(call).find((part) => part.type === 'input_image')!
const schemas = () => ai.calls.map((call) => call.schema)

function firstRead() {
  const { app, collection } = fakeApp()
  const userId = new ObjectId()
  const avatarId = new ObjectId()
  const selfieKey = `users/${userId.toString()}/selfie-1.jpg`
  files.files.set(selfieKey, Buffer.from(`selfie-${avatarId.toString()}`))
  collection('users').docs.push({ _id: userId, email: 'ana@example.test', createdAt: new Date() })
  collection('avatars').docs.push({
    _id: avatarId,
    userId,
    status: 'processing',
    error: null,
    selfieKey,
    avatarKey: null,
    colorAnalysis: null,
    job: { kind: 'colors', startedAt: new Date(), previewKey: null, previewCount: 0, readId: 'read-1', selfieKey },
    updatedAt: new Date(),
  })

  return { app, collection, avatarId, read: { readId: 'read-1', photoKey: selfieKey }, avatar: () => collection('avatars').findOne({ _id: avatarId }) }
}

describe('the scored read', () => {
  it('measures with fixed settings, in English whatever their language, at high detail', async () => {
    const { app, avatarId, read } = firstRead()
    await withLocale('pt-BR', () => runColorsJob(app, avatarId, read))

    const measure = ai.calls.find((call) => call.schema === 'color_measure')!
    assert.equal(measure.body.model, env.COLOR_MEASURE_MODEL)
    assert.deepEqual(measure.body.reasoning, { effort: 'none' })
    assert.equal(measure.body.temperature, 0)
    assert.doesNotMatch(measure.body.instructions as string, /Portuguese/)
    assert.doesNotMatch(measure.body.instructions as string, /season/i)
    assert.equal(imageOf(measure).detail, 'high')
  })

  it('writes the palette for the season decided, in their language, at low detail', async () => {
    const { app, avatarId, avatar, read } = firstRead()
    await withLocale('pt-BR', () => runColorsJob(app, avatarId, read))

    const palette = ai.calls.find((call) => call.schema === 'color_palette')!
    assert.match(palette.body.instructions as string, /The season is decided: Deep Autumn\. Do not judge it again\./)
    assert.match(palette.body.instructions as string, /Brazilian Portuguese/)
    assert.equal(palette.body.temperature, undefined)
    assert.deepEqual(palette.body.reasoning, { effort: env.AI_TEXT_REASONING_EFFORT })
    assert.equal(imageOf(palette).detail, 'low')
    assert.match(contentOf(palette)[0]!.text!, /Season: Deep Autumn \(warm undertone, high contrast\)/)

    const analysis = (await avatar())?.colorAnalysis as ColorAnalysis
    assert.equal(analysis.season, 'Deep Autumn')
    assert.equal(analysis.undertone, 'warm')
    assert.equal(analysis.metals, 'gold')
    // Good light: no photo note. A color to avoid that's also one to wear goes.
    assert.equal(analysis.photoNote, null)
    assert.deepEqual(analysis.avoidColors.map((swatch) => swatch.hex), ['#F4C6D7'])
  })

  it('measures a close call exactly once more, and averages the two', async () => {
    // Warm Autumn 2.25 against Deep Autumn 2: a margin under 1.
    ai.state.scores = { warmth: 2, depth: 1, chroma: 0, contrast: 1 }
    const { app, avatarId, avatar, read } = firstRead()
    await runColorsJob(app, avatarId, read)

    assert.deepEqual(schemas(), ['color_measure', 'color_measure', 'color_palette'])
    const entry = ((await avatar())?.colorReads as ColorReadLog[])[0]!
    assert.equal(entry.outcome, 'first')
    assert.equal(entry.season, 'Warm Autumn')

    ai.calls.length = 0
    ai.state.scores = { warmth: 2, depth: 4, chroma: -1, contrast: 2 }
    const clear = firstRead()
    await runColorsJob(clear.app, clear.avatarId, clear.read)
    assert.deepEqual(schemas(), ['color_measure', 'color_palette'])
  })

  for (const [name, refusal] of [
    ['a setting', failure.unsupported],
    ['a value (reasoning none)', failure.unsupportedValue],
  ] as const) {
    it(`reads the classic way when the model refuses ${name}, instead of failing`, async () => {
      ai.state.reply = (call) => (call.schema === 'color_measure' ? refusal() : classicReply('Soft Autumn'))
      const { app, collection, avatarId, avatar, read } = firstRead()
      await runColorsJob(app, avatarId, read)

      assert.deepEqual(schemas(), ['color_measure', 'color_analysis'])
      const done = await avatar()
      assert.equal(done?.status, 'ready')
      assert.equal((done?.colorAnalysis as ColorAnalysis).season, 'Soft Autumn')
      assert.equal((done?.colorReads as ColorReadLog[])[0]!.method, 'classic')
      const fallback = await collection('analyticsEvents').findOne({ name: 'colors_measure_fallback' })
      assert.deepEqual(fallback?.props, { model: env.COLOR_MEASURE_MODEL, status: 400 })
    })
  }

  it('fails an image the AI refuses, without reading it the classic way', async () => {
    ai.state.reply = () => failure.rejected()
    const { app, avatarId, avatar, read } = firstRead()
    await runColorsJob(app, avatarId, read)

    assert.deepEqual(schemas(), ['color_measure'])
    assert.equal((await avatar())?.status, 'failed')
  })
})
