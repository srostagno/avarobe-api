import { env } from '../config/env.js'
import { localizeInstructions, type Locale } from './locale.js'
import { currentLocale } from './request-locale.js'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

type ResponsesPayload = {
  status?: string
  output_text?: unknown
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string; refusal?: string }>
  }>
  incomplete_details?: { reason?: string }
  error?: OpenAiErrorBody
}

type ImagesPayload = {
  data?: Array<{ b64_json?: string }>
  usage?: Record<string, unknown>
  error?: OpenAiErrorBody
}

// OpenAI's error body: `code` and `type` tell an empty credit balance
// (429 credit_balance_exhausted / insufficient_quota) from a plain rate limit.
type OpenAiErrorBody = { message?: string; code?: string | null; type?: string | null }

export class OpenAiRequestError extends Error {
  readonly statusCode: number
  readonly code: string | null
  readonly type: string | null
  // How long OpenAI asked us to wait (retry-after-ms / retry-after).
  readonly retryAfterMs: number | null

  constructor(
    message: string,
    statusCode: number,
    details: { code?: string | null; type?: string | null; retryAfterMs?: number | null } = {},
  ) {
    super(message)
    this.name = 'OpenAiRequestError'
    this.statusCode = statusCode
    this.code = details.code ?? null
    this.type = details.type ?? null
    this.retryAfterMs = details.retryAfterMs ?? null
  }
}

// What went wrong with an AI call, for what to do about it: no credits or a
// bad key need a person (an alert, no retries); a rate limit or OpenAI being
// down passes (retry with backoff); a rejected request won't change by
// retrying (a refusal, an image it can't read); anything else is ours.
export type AiFailure = 'no_credits' | 'account' | 'rate_limited' | 'provider' | 'rejected' | 'internal'

const NO_CREDIT_CODES = new Set(['credit_balance_exhausted', 'insufficient_quota', 'billing_hard_limit_reached'])
// The 400s that are about the photo itself. Every other 400 is our request
// (a setting or schema the model doesn't take, after a change): the selfie
// is normalized to JPEG before it goes, so telling people to try another
// photo would send them re-uploading for nothing.
const PHOTO_CODES = new Set([
  'invalid_image',
  'invalid_image_format',
  'image_parse_error',
  'moderation_blocked',
  'content_policy_violation',
])
// The key missing from our own config: like a refused key, it needs a
// person, at once.
const MISSING_KEY = 'missing_api_key'

export function classifyAiError(error: unknown): AiFailure {
  if (error instanceof OpenAiRequestError) {
    const status = error.statusCode

    if (error.code === MISSING_KEY) {
      return 'account'
    }

    if (status === 429) {
      return (error.code && NO_CREDIT_CODES.has(error.code)) || error.type === 'insufficient_quota' ? 'no_credits' : 'rate_limited'
    }

    if (status === 401 || status === 403 || status === 404) {
      return 'account'
    }

    // Includes our own 502 (network) and 504 (timeout).
    if (status === 408 || status === 409 || status >= 500) {
      return 'provider'
    }

    // 422: the model refused (ours, from readOutputText, or a content filter).
    if (status === 422 || (status === 400 && error.code !== null && PHOTO_CODES.has(error.code))) {
      return 'rejected'
    }

    return 'internal'
  }

  // A reply that wasn't the JSON it promised.
  return error instanceof SyntaxError ? 'provider' : 'internal'
}

// For anything stored, logged in alerts or emailed: OpenAI's 401 message
// carries part of the key.
export function redactAiMessage(message: string) {
  const clean = message.replace(/sk-[A-Za-z0-9_\-*.]+/g, 'sk-…')

  return clean.length > 300 ? `${clean.slice(0, 299)}…` : clean
}

// One listener (modules/ops/alerts.ts) hears every failed call, so an empty
// credit balance reaches the founder from any feature. It can never break
// or slow the call.
let errorListener: ((error: OpenAiRequestError) => void) | null = null

export function onOpenAiError(listener: (error: OpenAiRequestError) => void) {
  errorListener = listener
}

function reported(error: OpenAiRequestError) {
  try {
    const result = errorListener?.(error) as unknown

    if (result instanceof Promise) {
      result.catch(() => undefined)
    }
  } catch {
    // The listener's problem, not the caller's.
  }

  return error
}

function retryAfterOf(headers: Headers): number | null {
  const ms = headers.get('retry-after-ms')

  if (ms && Number.isFinite(Number(ms)) && Number(ms) >= 0) {
    return Number(ms)
  }

  const raw = headers.get('retry-after')

  if (!raw) {
    return null
  }

  if (Number.isFinite(Number(raw))) {
    return Math.max(0, Number(raw) * 1000)
  }

  const at = Date.parse(raw)

  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

function responseError(response: Response, body: OpenAiErrorBody | undefined) {
  return new OpenAiRequestError(body?.message ?? `OpenAI responded with HTTP ${response.status}.`, response.status, {
    code: body?.code,
    type: body?.type,
    retryAfterMs: retryAfterOf(response.headers),
  })
}

// Development only (AI_FAULT): every call fails the way OpenAI does, before
// reaching it, to see the busy state, the retries and the alerts. Ignored in
// production (config/env.ts, and again here).
function simulatedFault(): OpenAiRequestError | null {
  const fault = env.NODE_ENV === 'production' ? undefined : env.AI_FAULT

  switch (fault) {
    case 'no_credits':
      // The exact error of 11-Oct-2026.
      return new OpenAiRequestError('You exceeded your current quota, please check your plan and billing details.', 429, {
        code: 'credit_balance_exhausted',
        type: 'insufficient_quota',
      })
    case 'rate_limit':
      return new OpenAiRequestError('Rate limit reached for requests. Please try again in a moment.', 429, {
        code: 'rate_limit_exceeded',
        type: 'requests',
      })
    case 'server':
      return new OpenAiRequestError('The server had an error while processing your request.', 500, { type: 'server_error' })
    case 'timeout':
      return new OpenAiRequestError('OpenAI request timed out.', 504)
    case 'rejected':
      return new OpenAiRequestError('The image data you provided does not represent a valid image.', 400, {
        code: 'invalid_image',
        type: 'invalid_request_error',
      })
    default:
      return null
  }
}

// Reported like any failed call, so the founder hears of it at once.
function requireKey() {
  if (!env.OPENAI_API_KEY) {
    throw reported(new OpenAiRequestError('OPENAI_API_KEY is missing on avarobe-api.', 503, { code: MISSING_KEY }))
  }

  return env.OPENAI_API_KEY
}

async function postOpenAi<T extends { error?: OpenAiErrorBody }>(
  path: string,
  body: BodyInit,
  options: { json: boolean; timeoutMs: number },
): Promise<T> {
  const fault = simulatedFault()

  if (fault) {
    throw reported(fault)
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${requireKey()}` }

  if (options.json) {
    headers['Content-Type'] = 'application/json'
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as T

    if (!response.ok) {
      throw responseError(response, payload.error)
    }

    return payload
  } catch (error) {
    if (error instanceof OpenAiRequestError) {
      throw reported(error)
    }

    const aborted = error instanceof Error && error.name === 'AbortError'

    throw reported(
      new OpenAiRequestError(aborted ? 'OpenAI request timed out.' : 'OpenAI request failed.', aborted ? 504 : 502),
    )
  } finally {
    clearTimeout(timeout)
  }
}

function readOutputText(payload: ResponsesPayload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const parts: string[] = []

  for (const item of payload.output ?? []) {
    if (item.type !== 'message') {
      continue
    }

    for (const chunk of item.content ?? []) {
      if (chunk.type === 'refusal' && chunk.refusal) {
        throw new OpenAiRequestError(`The model refused: ${chunk.refusal}`, 422)
      }

      if (chunk.type === 'output_text' && chunk.text) {
        parts.push(chunk.text)
      }
    }
  }

  return parts.join('').trim()
}

export type ResponseInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' }

// Calls the Responses API with a strict JSON schema and returns the parsed
// object. The schema must follow structured-output rules (every property
// required, additionalProperties false).
export async function createStructuredResponse<T>(input: {
  instructions: string
  content: ResponseInputContent[]
  schemaName: string
  schema: Record<string, unknown>
  timeoutMs?: number
  // Default to AI_TEXT_MODEL / AI_TEXT_REASONING_EFFORT. 'none' (with
  // temperature 0) for a measurement that must come out the same each time.
  model?: string
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  // Sent only when set.
  temperature?: number
  // The person's language: what they read comes back in it (utils/locale).
  locale?: Locale | null
}): Promise<T> {
  const payload = await postOpenAi<ResponsesPayload>(
    '/responses',
    JSON.stringify({
      model: input.model ?? env.AI_TEXT_MODEL,
      reasoning: { effort: input.reasoningEffort ?? env.AI_TEXT_REASONING_EFFORT },
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      instructions: localizeInstructions(input.instructions, input.locale ?? currentLocale()),
      input: [{ role: 'user', content: input.content }],
      text: {
        format: {
          type: 'json_schema',
          name: input.schemaName,
          schema: input.schema,
          strict: true,
        },
      },
    }),
    { json: true, timeoutMs: input.timeoutMs ?? 90_000 },
  )

  if (payload.status === 'incomplete') {
    const reason = payload.incomplete_details?.reason ?? 'unknown'

    // Filtered: it would be again (a refusal, not OpenAI being down).
    throw new OpenAiRequestError(`OpenAI response incomplete: ${reason}.`, reason === 'content_filter' ? 422 : 502)
  }

  const text = readOutputText(payload)

  if (!text) {
    throw new OpenAiRequestError('OpenAI returned an empty response.', 502)
  }

  return JSON.parse(text) as T
}

export type ImageInput = {
  data: Buffer
  filename: string
  contentType: string
}

// Generates an image from reference images plus a prompt (Images API edits).
// Returns PNG bytes.
export async function generateImageFromReferences(input: {
  images: ImageInput[]
  prompt: string
  // Other sizes (multiples of 16) work with the gpt-image-2.5 models.
  size?: '1024x1024' | '1024x1536' | '1536x1024' | `${number}x${number}`
  // Defaults to AI_IMAGE_MODEL / AI_IMAGE_QUALITY.
  model?: string
  quality?: 'low' | 'medium' | 'high'
  timeoutMs?: number
  // Called with in-progress renders (full-size PNGs) as the model refines the
  // image, so people can watch it form. Turns on streaming.
  onPartial?: (png: Buffer, index: number) => Promise<void> | void
}): Promise<Buffer> {
  const form = new FormData()

  form.append('model', input.model ?? env.AI_IMAGE_MODEL)
  form.append('prompt', input.prompt)
  form.append('size', input.size ?? '1024x1536')
  form.append('quality', input.quality ?? env.AI_IMAGE_QUALITY)

  if (input.onPartial) {
    form.append('stream', 'true')
    form.append('partial_images', '2')
  }

  for (const image of input.images) {
    form.append(
      'image[]',
      new Blob([new Uint8Array(image.data)], { type: image.contentType }),
      image.filename,
    )
  }

  if (input.onPartial) {
    return streamImageEdit(form, input.onPartial, input.timeoutMs ?? 180_000)
  }

  const payload = await postOpenAi<ImagesPayload>('/images/edits', form, {
    json: false,
    timeoutMs: input.timeoutMs ?? 180_000,
  })
  const b64 = payload.data?.[0]?.b64_json

  if (!b64) {
    throw new OpenAiRequestError('OpenAI returned no image.', 502)
  }

  return Buffer.from(b64, 'base64')
}

// Text-to-image, for renders that don't need a reference (a flat-lay of clothes).
export async function generateImage(input: {
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  model?: string
  quality?: 'low' | 'medium' | 'high'
  timeoutMs?: number
}): Promise<Buffer> {
  const payload = await postOpenAi<ImagesPayload>(
    '/images/generations',
    JSON.stringify({
      model: input.model ?? env.AI_IMAGE_MODEL,
      prompt: input.prompt,
      size: input.size ?? '1024x1024',
      quality: input.quality ?? env.AI_IMAGE_QUALITY,
      n: 1,
    }),
    { json: true, timeoutMs: input.timeoutMs ?? 180_000 },
  )
  const b64 = payload.data?.[0]?.b64_json

  if (!b64) {
    throw new OpenAiRequestError('OpenAI returned no image.', 502)
  }

  return Buffer.from(b64, 'base64')
}

type ImageStreamEvent = {
  type?: string
  b64_json?: string
  partial_image_index?: number
  error?: OpenAiErrorBody
}

// Reads the server-sent events of a streamed image edit: partial images
// first, then the completed one.
async function streamImageEdit(
  form: FormData,
  onPartial: (png: Buffer, index: number) => Promise<void> | void,
  timeoutMs: number,
): Promise<Buffer> {
  const fault = simulatedFault()

  if (fault) {
    throw reported(fault)
  }

  const key = requireKey()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => ({}))) as ImagesPayload
      throw responseError(response, payload.error)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    let finalImage: Buffer | null = null

    const handle = async (block: string) => {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')

      if (!data) {
        return
      }

      const event = JSON.parse(data) as ImageStreamEvent

      // A 502 unless the event names what failed (a 429 with its code, a
      // 400 for the image).
      if (event.type === 'error' || event.error) {
        const code = event.error?.code ?? null
        const status = !code ? 502 : NO_CREDIT_CODES.has(code) || code === 'rate_limit_exceeded' ? 429 : PHOTO_CODES.has(code) ? 400 : 502
        throw new OpenAiRequestError(event.error?.message ?? 'OpenAI image stream failed.', status, {
          code,
          type: event.error?.type,
        })
      }

      if (!event.b64_json) {
        return
      }

      const image = Buffer.from(event.b64_json, 'base64')

      if (event.type?.endsWith('.partial_image')) {
        // A preview that fails to save must not sink the render.
        await Promise.resolve(onPartial(image, event.partial_image_index ?? 0)).catch(() => undefined)
      } else if (event.type?.endsWith('.completed')) {
        finalImage = image
      }
    }

    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffered += decoder.decode(value, { stream: true })
      let boundary = buffered.indexOf('\n\n')

      while (boundary !== -1) {
        await handle(buffered.slice(0, boundary))
        buffered = buffered.slice(boundary + 2)
        boundary = buffered.indexOf('\n\n')
      }
    }

    if (buffered.trim()) {
      await handle(buffered)
    }

    if (!finalImage) {
      throw new OpenAiRequestError('OpenAI returned no image.', 502)
    }

    return finalImage
  } catch (error) {
    if (error instanceof OpenAiRequestError) {
      throw reported(error)
    }

    const aborted = error instanceof Error && error.name === 'AbortError'

    throw reported(
      new OpenAiRequestError(aborted ? 'OpenAI request timed out.' : 'OpenAI request failed.', aborted ? 504 : 502),
    )
  } finally {
    clearTimeout(timeout)
  }
}

export function toDataUrl(data: Buffer, contentType: string) {
  return `data:${contentType};base64,${data.toString('base64')}`
}
