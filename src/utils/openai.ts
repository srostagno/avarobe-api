import { env } from '../config/env.js'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

type ResponsesPayload = {
  status?: string
  output_text?: unknown
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string; refusal?: string }>
  }>
  incomplete_details?: { reason?: string }
  error?: { message?: string }
}

type ImagesPayload = {
  data?: Array<{ b64_json?: string }>
  usage?: Record<string, unknown>
  error?: { message?: string }
}

export class OpenAiRequestError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'OpenAiRequestError'
    this.statusCode = statusCode
  }
}

function requireKey() {
  if (!env.OPENAI_API_KEY) {
    throw new OpenAiRequestError('OPENAI_API_KEY is missing on avarobe-api.', 503)
  }

  return env.OPENAI_API_KEY
}

async function postOpenAi<T extends { error?: { message?: string } }>(
  path: string,
  body: BodyInit,
  options: { json: boolean; timeoutMs: number },
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  const headers: Record<string, string> = { Authorization: `Bearer ${requireKey()}` }

  if (options.json) {
    headers['Content-Type'] = 'application/json'
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as T

    if (!response.ok) {
      throw new OpenAiRequestError(
        payload.error?.message ?? `OpenAI responded with HTTP ${response.status}.`,
        response.status,
      )
    }

    return payload
  } catch (error) {
    if (error instanceof OpenAiRequestError) {
      throw error
    }

    const aborted = error instanceof Error && error.name === 'AbortError'

    throw new OpenAiRequestError(
      aborted ? 'OpenAI request timed out.' : 'OpenAI request failed.',
      aborted ? 504 : 502,
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
}): Promise<T> {
  const payload = await postOpenAi<ResponsesPayload>(
    '/responses',
    JSON.stringify({
      model: env.AI_TEXT_MODEL,
      reasoning: { effort: env.AI_TEXT_REASONING_EFFORT },
      instructions: input.instructions,
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
    throw new OpenAiRequestError(
      `OpenAI response incomplete: ${payload.incomplete_details?.reason ?? 'unknown'}.`,
      502,
    )
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
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  timeoutMs?: number
}): Promise<Buffer> {
  const form = new FormData()

  form.append('model', env.AI_IMAGE_MODEL)
  form.append('prompt', input.prompt)
  form.append('size', input.size ?? '1024x1536')
  form.append('quality', env.AI_IMAGE_QUALITY)

  for (const image of input.images) {
    form.append(
      'image[]',
      new Blob([new Uint8Array(image.data)], { type: image.contentType }),
      image.filename,
    )
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

export function toDataUrl(data: Buffer, contentType: string) {
  return `data:${contentType};base64,${data.toString('base64')}`
}
