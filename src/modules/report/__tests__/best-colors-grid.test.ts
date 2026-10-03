import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import sharp from 'sharp'

import { lockBestPanels } from '../../../utils/images.js'
import { buildDrapeGridPreviewPrompt } from '../prompts.js'

const swatch = (name: string, hex: string) => ({ name, hex })

// A 2x2 test card: a different flat color per quadrant, with a white dot in
// the middle of each so a blur shows.
async function card() {
  const size = 200
  const half = size / 2
  const quadrant = (r: number, g: number, b: number) =>
    sharp({ create: { width: half, height: half, channels: 3, background: { r, g, b } } })
      .composite([{ input: Buffer.from(`<svg width="${half}" height="${half}"><circle cx="50" cy="50" r="12" fill="white"/></svg>`) }])
      .png()
      .toBuffer()
  const [a, b, c, d] = await Promise.all([quadrant(200, 40, 40), quadrant(40, 200, 40), quadrant(40, 40, 200), quadrant(220, 180, 20)])

  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: a, left: 0, top: 0 },
      { input: b, left: half, top: 0 },
      { input: c, left: 0, top: half },
      { input: d, left: half, top: half },
    ])
    .png()
    .toBuffer()
}

async function pixel(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  const index = (y * info.width + x) * info.channels
  return [data[index]!, data[index + 1]!, data[index + 2]!]
}

describe('the best-colors grid preview', () => {
  it('asks for their three best colors and their worst, worst at the bottom right', () => {
    const prompt = buildDrapeGridPreviewPrompt([swatch('Teal', '#00807F'), swatch('Rust', '#B7410E'), swatch('Navy', '#1F2A44')], swatch('Icy pink', '#F5D6E6'), true)
    assert.match(prompt, /^Image 1 is a selfie of this person\./)
    assert.match(prompt, /2 by 2 grid/)
    assert.match(prompt, /top-left Teal.*top-right Rust.*bottom-left Navy.*bottom-right Icy pink/)
    assert.doesNotMatch(prompt, /Image 2/)
    assert.match(buildDrapeGridPreviewPrompt([swatch('Teal', '#00807F'), swatch('Rust', '#B7410E'), swatch('Navy', '#1F2A44')], swatch('Black', '#000000'), false), /Image 2 is a close-up/)
  })

  it('blurs the three best panels and leaves the worst one as it is', async () => {
    const image = await card()
    const locked = await lockBestPanels(image)
    // The dot in the worst panel (bottom right) is still sharp and white.
    const worst = await pixel(locked, 150, 150)
    assert.ok(worst.every((channel) => channel > 235), `worst panel should be untouched, got ${worst.join(",")}`)
    // The dots in the best panels are blurred away (and nearly grey).
    for (const [x, y] of [
      [50, 50],
      [150, 50],
      [50, 150],
    ] as const) {
      const [r, g, b] = await pixel(locked, x, y)
      assert.ok(r < 240 || g < 240 || b < 240, `panel at ${x},${y} should be blurred`)
    }
  })
})
