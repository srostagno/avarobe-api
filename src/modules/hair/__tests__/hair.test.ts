import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AvatarVersion } from '../../../types/mongo.js'
import { currentHair, orphanHairKeys } from '../../avatar/hair.js'
import { buildHairstylePrompt, cleanRecommendations, RECOMMENDATION_COUNT } from '../prompts.js'

const cut = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  length: 'medium' as const,
  why: 'It balances your jaw.',
  maintenance: 'low' as const,
  stylingMinutes: 10,
  stylistBrief: 'Collarbone length with long layers.',
  render: 'Collarbone-length hair with long face-framing layers.',
  ...overrides,
})

const version = (id: string, hair: AvatarVersion['hair'] = null): AvatarVersion => ({
  id,
  key: `users/u/avatar-${id}.webp`,
  source: hair ? 'hair' : 'create',
  createdAt: new Date('2026-09-29T00:00:00Z'),
  hair,
})

const shag = { hairstyleId: 'h1', name: 'Soft shag', render: 'A soft shag.', refKey: 'users/u/avatar-hair-1.webp' }

describe('hair recommendations', () => {
  it('keeps at most six cuts with stable ids, dropping empty ones and clamping styling time', () => {
    const cleaned = cleanRecommendations([
      cut('Soft shag', { stylingMinutes: 90 }),
      cut(' ', {}),
      ...Array.from({ length: 7 }, (_, index) => cut(`Cut ${index}`)),
    ])

    assert.equal(cleaned.length, RECOMMENDATION_COUNT)
    assert.deepEqual(
      cleaned.map((item) => item.id),
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
    )
    assert.equal(cleaned[0]?.name, 'Soft shag')
    assert.equal(cleaned[0]?.stylingMinutes, 45)
  })

  it('takes only the haircut from a photo, never the face or hair color', () => {
    const prompt = buildHairstylePrompt({ name: 'Blunt bob', render: 'A chin-length blunt bob.', hasReference: true })

    assert.match(prompt, /Image 3 is a photo of a haircut/)
    assert.match(prompt, /never take the face, features, skin tone, expression or hair color from image 3/)
    assert.doesNotMatch(buildHairstylePrompt({ name: 'Blunt bob', render: 'x', hasReference: false }), /Image 3/)
  })
})

describe('the avatar’s haircut', () => {
  it('follows the version in use', () => {
    const versions = [version('b', shag), version('a')]

    assert.equal(currentHair({ avatarKey: versions[0]?.key ?? null, versions })?.name, 'Soft shag')
    assert.equal(currentHair({ avatarKey: versions[1]?.key ?? null, versions }), null)
    assert.equal(currentHair({ avatarKey: null, versions }), null)
  })

  it('only removes a close-up no remaining version wears', () => {
    // A refinement keeps the haircut, so two versions share its close-up.
    const refined = version('c', shag)
    const applied = version('b', shag)

    assert.deepEqual(orphanHairKeys([applied], [refined, version('a')]), [])
    assert.deepEqual(orphanHairKeys([applied, refined], [version('a')]), [shag.refKey])
    assert.deepEqual(orphanHairKeys([version('a')], [applied]), [])
  })
})
