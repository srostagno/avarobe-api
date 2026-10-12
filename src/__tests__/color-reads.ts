// What the color read tests share: the avatar routes on a real Fastify with
// in-memory collections (fake-app.ts), the files in memory, OpenAI stubbed by
// the schema each call asks for, and photos made on the spot (plain colored
// squares, never a face).
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyPluginAsync } from 'fastify'
import type { ObjectId } from 'mongodb'
import sharp from 'sharp'

import { env } from '../config/env.js'
import type { ColorScores } from '../types/mongo.js'
import { registerRequestLocale } from '../utils/request-locale.js'
import { storage } from '../utils/storage.js'
import { registerMessageTranslation } from '../utils/translate-message.js'
import { fakeApp, type Doc } from './fake-app.js'

// ---------------------------------------------------------------- files

export function memoryStorage() {
  const saved = {
    put: storage.put.bind(storage),
    read: storage.read.bind(storage),
    remove: storage.remove.bind(storage),
    removeFolder: storage.removeFolder.bind(storage),
    signedUrl: storage.signedUrl.bind(storage),
  }
  const files = new Map<string, Buffer>()
  const removed: string[] = []

  storage.put = async (key, body) => {
    files.set(key, body)
  }
  storage.read = async (key) => {
    const file = files.get(key)

    if (!file) {
      throw new Error(`ENOENT: no such file, open '${key}'`)
    }

    return file
  }
  storage.remove = async (key) => {
    removed.push(key)
    files.delete(key)
  }
  storage.removeFolder = async (userId) => {
    const folder = [...files.keys()].filter((key) => key.startsWith(`users/${userId}/`))

    for (const key of folder) {
      removed.push(key)
      files.delete(key)
    }

    return folder.length
  }
  storage.signedUrl = async (key) => `https://media.test/${key}`

  return {
    files,
    removed,
    restore: () => Object.assign(storage, saved),
  }
}

// A plain square photo of one color: the same color gives the same bytes.
export function photo(rgb: [number, number, number]) {
  return sharp({ create: { width: 400, height: 400, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toBuffer()
}

// ---------------------------------------------------------------- OpenAI

export type AiCall = { schema: string; body: Record<string, unknown> }
type Reply = (call: AiCall) => Response

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const swatch = (name: string, hex: string) => ({ name, hex })

export const measureReply = (scores: ColorScores, extra: { lighting?: 'good' | 'tinted' | 'poor'; olive?: boolean } = {}) =>
  json(200, {
    output_text: JSON.stringify({
      coloring: { skin: 'golden medium', hair: 'dark brown', eyes: 'brown', lighting: 'daylight' },
      lightingQuality: extra.lighting ?? 'good',
      olive: extra.olive ?? false,
      scores,
    }),
  })

export const paletteReply = (tag = 'A') =>
  json(200, {
    output_text: JSON.stringify({
      summary: `Palette ${tag}.`,
      bestColors: [swatch(`Rust ${tag}`, '#A0482A'), swatch('Olive', '#5B5A2C'), swatch('Teal', '#1F5C5B')],
      neutrals: [swatch('Camel', '#C19A6B')],
      avoidColors: [swatch('Icy pink', '#F4C6D7'), swatch('Rust again', '#A0482A')],
      photoNote: 'Try daylight.',
    }),
  })

export const classicReply = (season: string) =>
  json(200, {
    output_text: JSON.stringify({
      season,
      undertone: 'warm',
      contrast: 'medium',
      summary: 'Warm and soft.',
      bestColors: [swatch('Olive', '#5B5A2C')],
      neutrals: [swatch('Camel', '#C19A6B')],
      avoidColors: [],
      metals: 'gold',
      confidence: 'high',
      photoNote: null,
    }),
  })

export const failure = {
  noCredits: () => json(429, { error: { message: 'No credits.', code: 'credit_balance_exhausted', type: 'insufficient_quota' } }),
  busy: () => json(500, { error: { message: 'The server had an error.', type: 'server_error' } }, { 'retry-after-ms': '1' }),
  rejected: () => json(400, { error: { message: 'Invalid image.', code: 'invalid_image', type: 'invalid_request_error' } }),
  unsupported: () =>
    json(400, { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", code: 'unsupported_parameter', type: 'invalid_request_error' } }),
  unsupportedValue: () =>
    json(400, {
      error: {
        message: "Unsupported value: 'reasoning.effort' does not support 'none' with this model. Supported values are: 'low', 'medium', and 'high'.",
        code: 'unsupported_value',
        type: 'invalid_request_error',
      },
    }),
}

// Every /responses call, answered by `reply` (by default: what its schema
// asks for, with these scores). Image edits draw `image` as many times as
// `images` allows (an avatar render), then fail (the free preview is not
// part of these tests).
export function stubOpenAi() {
  const saved = { fetch: globalThis.fetch, key: env.OPENAI_API_KEY, fault: env.AI_FAULT, method: env.COLOR_READ_METHOD }
  const calls: AiCall[] = []
  const state: { scores: ColorScores; reply: Reply | null; season: string; images: number; image: Buffer | null } = {
    scores: { warmth: 2, depth: 4, chroma: -1, contrast: 2 },
    reply: null,
    season: 'Soft Autumn',
    images: 0,
    image: null,
  }

  env.OPENAI_API_KEY = 'sk-test-not-a-key'
  env.AI_FAULT = undefined
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const target = url instanceof Request ? url.url : url.toString()

    if (target.endsWith('/images/edits') && state.images > 0 && state.image) {
      state.images -= 1
      const event = JSON.stringify({ type: 'image_edit.completed', b64_json: state.image.toString('base64') })

      return new Response(`data: ${event}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    if (!target.endsWith('/responses')) {
      return json(500, { error: { message: 'no' } })
    }

    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    const call = { schema: (body.text as { format: { name: string } }).format.name, body }
    calls.push(call)

    if (state.reply) {
      return state.reply(call)
    }

    return call.schema === 'color_measure' ? measureReply(state.scores) : call.schema === 'color_palette' ? paletteReply() : classicReply(state.season)
  }

  return {
    calls,
    state,
    restore: () => {
      globalThis.fetch = saved.fetch
      env.OPENAI_API_KEY = saved.key
      env.AI_FAULT = saved.fault
      env.COLOR_READ_METHOD = saved.method
    },
  }
}

// ---------------------------------------------------------------- routes

// `languages`: the page's language and the replies' messages in it, as
// app.ts sets them up.
export async function routeApp(routes: Record<string, FastifyPluginAsync>, seed: Record<string, Doc[]> = {}, options: { languages?: boolean } = {}) {
  const fake = fakeApp(seed)
  const app = Fastify({ logger: process.env.ROUTES_LOG === '1' ? { level: 'error' } : false })

  if (options.languages) {
    registerRequestLocale(app)
    registerMessageTranslation(app)
  }

  await app.register(cookie)
  await app.register(jwt, { secret: 'test-secret-that-is-long-enough-for-hs256' })
  await app.register(multipart)
  app.decorate('collections', fake.app.collections)

  for (const [prefix, plugin] of Object.entries(routes)) {
    await app.register(plugin, { prefix })
  }

  await app.ready()

  return {
    app,
    collection: fake.collection,
    auth: (userId: ObjectId) => ({ authorization: `Bearer ${app.jwt.sign({ sub: userId.toString(), email: 'test@example.test' })}` }),
  }
}

// A multipart body, as the web sends it.
export async function form(fields: Record<string, string>, files: Record<string, Buffer> = {}, headers: Record<string, string> = {}) {
  const data = new FormData()

  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value)
  }

  for (const [name, file] of Object.entries(files)) {
    data.append(name, new Blob([new Uint8Array(file)], { type: 'image/png' }), `${name}.png`)
  }

  const request = new Request('http://test.local', { method: 'POST', body: data })

  return { payload: Buffer.from(await request.arrayBuffer()), headers: { ...headers, 'content-type': request.headers.get('content-type')! } }
}

// Until a background job is done (or a second has gone).
export async function until(check: () => Promise<boolean>, timeoutMs = 2_000) {
  const started = Date.now()

  while (!(await check())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for the background job.')
    }

    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
