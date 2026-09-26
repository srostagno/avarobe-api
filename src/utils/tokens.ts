import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const DURATION_PATTERN =
  /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i

export function generateSecureToken(size = 64) {
  return randomBytes(size).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function hmacSign(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function hmacVerify(secret: string, value: string, signature: string) {
  const expected = Buffer.from(hmacSign(secret, value))
  const received = Buffer.from(signature)

  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function durationToSeconds(duration: string) {
  const match = DURATION_PATTERN.exec(duration.trim())

  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid duration format: "${duration}". Use formats like 15m, 1h, 30s, 7d.`,
    )
  }

  const value = Number.parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  if (unit.startsWith('s')) {
    return value
  }

  if (unit.startsWith('m')) {
    return value * 60
  }

  if (unit.startsWith('h')) {
    return value * 60 * 60
  }

  return value * 60 * 60 * 24
}

export function extractBearerToken(header?: string) {
  if (!header) {
    return null
  }

  const [scheme, token] = header.split(' ')

  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null
  }

  return token
}
