import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { AvatarDocument } from '../../../types/mongo.js'
import { colorBoardsFor } from '../boards.js'
import { buildColorReportRequest, buildDrapeBoardPrompt, buildDrapePrompt, selfieOnly } from '../prompts.js'

const swatch = (name: string, hex: string) => ({ name, hex, verdict: 'wear' as const })

describe('the color report before the avatar', () => {
  it('draws the portraits from the selfie alone', () => {
    const board = selfieOnly(buildDrapeBoardPrompt([swatch('Teal', '#00807F'), swatch('Rust', '#B7410E'), swatch('Navy', '#1F2A44'), swatch('Ivory', '#FFFFF0')]))
    assert.match(board, /^Image 1 is a selfie of this person\./)
    assert.doesNotMatch(board, /Image 2/)
    const drape = selfieOnly(buildDrapePrompt({ wear: [swatch('Teal', '#00807F'), swatch('Rust', '#B7410E')], avoid: [swatch('Icy pink', '#F5D6E6'), swatch('Black', '#000000')] }))
    assert.match(drape, /^Image 1 is a selfie of this person\./)
  })

  it('leaves the outfits board for the avatar', () => {
    assert.deepEqual([...colorBoardsFor({ avatarKey: null })], ['neutrals', 'whites', 'metals', 'face', 'hair'])
    assert.equal(colorBoardsFor({ avatarKey: 'users/1/avatar.webp' }).includes('palette'), true)
  })

  it('writes the request with how they shop, without a body', () => {
    const avatar = { body: null, colorAnalysis: null } as unknown as AvatarDocument
    const request = buildColorReportRequest(avatar, 'menswear')
    assert.match(request, /They dress in: menswear\.\n/)
    assert.match(request, /Face test: shirt colors/)
  })
})
