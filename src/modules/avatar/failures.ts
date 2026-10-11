import type { AiFailure } from '../../utils/openai.js'

// Failed color reads: what the person is told, and when the server tries
// again by itself.

// The AI provider's fault (busy, down, out of credits, a bad key): the
// photo is fine, so the read can be done later and emailed.
export const PROVIDER_CODES: AiFailure[] = ['no_credits', 'account', 'rate_limited', 'provider']

// What the web says about a failure, in its own words: "lots of people are
// reading their colors" (busy), "try another photo" (photo), or a plain
// error. Never OpenAI's message.
export function publicReason(code?: AiFailure | null): 'busy' | 'photo' | 'error' {
  if (code && PROVIDER_CODES.includes(code)) {
    return 'busy'
  }

  return code === 'rejected' ? 'photo' : 'error'
}

// Up to 3 attempts per read, only when it can pass by itself (a rate limit,
// OpenAI down or slow), 3 s then 10 s apart (or what OpenAI asks for, at
// most 10 s), and none once a minute has gone: the color tour and the
// progress bar are waiting.
export const READ_RETRY = { attempts: 3, waitsMs: [3_000, 10_000], maxWaitMs: 10_000, budgetMs: 60_000 } as const

// How long to wait before attempt `attempt + 1`, or null to give up now.
// `attempt` is how many have been made, `elapsedMs` since the job started.
export function retryDelay(code: AiFailure, attempt: number, elapsedMs: number, retryAfterMs: number | null): number | null {
  if ((code !== 'rate_limited' && code !== 'provider') || attempt < 1 || attempt >= READ_RETRY.attempts) {
    return null
  }

  const delay = Math.min(retryAfterMs ?? READ_RETRY.waitsMs[attempt - 1] ?? READ_RETRY.maxWaitMs, READ_RETRY.maxWaitMs)

  return elapsedMs + delay > READ_RETRY.budgetMs ? null : delay
}
