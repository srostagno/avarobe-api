import { env } from '../config/env.js'

// The images a person can share: what Avarobe generated for them (renders,
// looks and their pieces, haircuts, makeup, drape tests, report boards and a
// teaser's picture once it's hers: me/routes checks that), and the photo of
// a Hair Score, Look Score or Face Age read as the "before" of her own
// before/after (Oct 18, 2026). Never her selfie, body photo or try-on
// references, and never an unfinished preview or a teaser's blurred copy.
const SHAREABLE =
  /^users\/([a-f0-9]{24})\/(?:(?:avatar-\d+|avatar-hair-\d+|board-[a-z0-9_-]+-\d+|check-[a-f0-9]{24}-\d+|drape-\d+|drape-preview-\d+|hairstyle-[a-f0-9]{24}-\d+|look-[a-f0-9]{24}-\d+|look-[a-f0-9]{24}-piece-[A-Za-z0-9_-]+|makeup-[a-f0-9]{24}-\d+|teaser-[a-f0-9]{24}-\d+)\.webp|(?:hairscore|lookscore|face)-[a-f0-9]{24}\.jpg)$/

export const isTeaserKey = (key: string) => /\/teaser-[a-f0-9]{24}-\d+\.webp$/.test(key)

// The storage key behind one of our signed image URLs (local media route or
// S3, virtual-hosted or path-style), if it's one of this person's shareable
// images. The signature isn't checked: ownership is, from the key.
export function shareableKey(src: string, userId: string): string | null {
  let url: URL

  try {
    url = new URL(src)
  } catch {
    return null
  }

  let path: string

  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return null
  }

  path = path.replace(/^api\/v1\/media\//, '')

  if (env.S3_BUCKET && path.startsWith(`${env.S3_BUCKET}/`)) {
    path = path.slice(env.S3_BUCKET.length + 1)
  }

  const match = SHAREABLE.exec(path)

  return match && match[1] === userId ? path : null
}
