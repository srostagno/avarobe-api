import type { z } from 'zod'

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown) {
  const parsed = schema.safeParse(body ?? {})

  if (parsed.success) {
    return { ok: true as const, data: parsed.data as z.output<S> }
  }

  const issue = parsed.error.issues[0]
  const path = issue?.path.join('.') ?? ''
  const message = issue
    ? `${path ? `${path}: ` : ''}${issue.message}`
    : 'Invalid request body.'

  return { ok: false as const, message }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
