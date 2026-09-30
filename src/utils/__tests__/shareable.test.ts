import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shareableKey } from '../shareable.js'

const me = '6abd325607acfd9cf9651380'
const other = '6abc35461fe439a9a6161755'
const look = '6abd3897fc1acfb419e2aac9'
const local = (key: string) => `http://localhost:4100/api/v1/media/${key}?exp=1&sig=abc`
const s3 = (key: string) => `https://avarobe-media-prod.s3.us-west-1.amazonaws.com/${encodeURI(key)}?X-Amz-Signature=abc`

describe('shareableKey', () => {
  it('finds the key behind our image URLs, local or S3', () => {
    assert.equal(shareableKey(local(`users/${me}/avatar-1790000000000.webp`), me), `users/${me}/avatar-1790000000000.webp`)
    assert.equal(shareableKey(s3(`users/${me}/drape-preview-1790000000000.webp`), me), `users/${me}/drape-preview-1790000000000.webp`)
  })

  it('shares what Avarobe generated: looks, pieces, haircuts, boards', () => {
    for (const name of [
      `look-${look}-1790000000000.webp`,
      `look-${look}-piece-top.webp`,
      `hairstyle-${look}-1790000000000.webp`,
      'board-neutrals-1790000000000.webp',
      'drape-1790000000000.webp',
      'avatar-hair-1790000000000.webp',
    ]) {
      assert.ok(shareableKey(local(`users/${me}/${name}`), me), name)
    }
  })

  it('never shares what they uploaded, an unfinished preview, or someone else’s image', () => {
    for (const name of [
      'selfie-1790000000000.jpg',
      'body-1790000000000.jpg',
      `look-${look}-reference.jpg`,
      `look-${look}-preview.webp`,
      `avatar-preview-${look}.webp`,
    ]) {
      assert.equal(shareableKey(local(`users/${me}/${name}`), me), null, name)
    }
    assert.equal(shareableKey(local(`users/${other}/avatar-1790000000000.webp`), me), null)
    assert.equal(shareableKey(local(`users/${me}/../${other}/avatar-1.webp`), me), null)
    assert.equal(shareableKey('not a url', me), null)
  })
})
