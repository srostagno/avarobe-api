import type { ColorAnalysis, ColorSwatch } from '../../types/mongo.js'

import type { CheckReading } from './prompts.js'

// "Should I buy it?" (part 1): the color someone tapped on a garment photo,
// judged against their saved palette with plain color math. No AI, no
// randomness: the same hex and palette always give the same answer.
//
// Distance is CIEDE2000 (ΔE00). CIE76 (straight Lab distance) overstates
// differences between saturated colors and understates them in blues and
// near-greys, which is exactly where palettes live (navy vs. cobalt, ivory
// vs. pure white). ΔE00 corrects lightness, chroma and hue weighting, and
// its hue term is scaled by chroma, so a grey, black or white tap lands on
// the palette's neutrals (charcoal, ivory) by lightness instead of by a
// meaningless hue angle. It's ~40 lines and runs in microseconds.

// ΔE00 thresholds. ~1 is the limit of perception, 2-5 reads as "the same
// color" side by side, ~10 is "same family, different shade" (coral vs.
// salmon), past ~20 colors look clearly unrelated.
export const TAP_MATCH = 5
export const TAP_NEAR = 10
export const TAP_MODERATE = 20

export type TapList = 'best' | 'neutral' | 'avoid'
export type TapVerdict = Exclude<CheckReading['verdict'], 'unclear'>
// The web translates these; the API sends no prose.
export type TapReason = 'in_palette' | 'close_to_palette' | 'neutral_base' | 'near_palette' | 'near_neutral' | 'near_avoid' | 'far_from_palette'

export type TapResult = {
  hex: string
  verdict: TapVerdict
  reasonKey: TapReason
  nearest: ColorSwatch & { list: TapList; deltaE: number }
  alternatives: ColorSwatch[]
}

type Lab = [number, number, number]

export const TAP_HEX = /^#[0-9a-fA-F]{6}$/

// #RRGGBB (or a saved #RGB) to CIE Lab, sRGB with a D65 white. Null when
// it isn't a hex color.
export function hexToLab(hex: string): Lab | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim())
  const value = short ? `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}` : hex.trim()

  if (!TAP_HEX.test(value)) {
    return null
  }

  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(value.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => {
  const d = (r * 180) / Math.PI
  return d < 0 ? d + 360 : d
}

// CIEDE2000 (Sharma, Wu & Dalal 2005), kL = kC = kH = 1.
export function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)))
  const ap1 = a1 * (1 + g)
  const ap2 = a2 * (1 + g)
  const c1 = Math.hypot(ap1, b1)
  const c2 = Math.hypot(ap2, b2)
  const h1 = ap1 === 0 && b1 === 0 ? 0 : deg(Math.atan2(b1, ap1))
  const h2 = ap2 === 0 && b2 === 0 ? 0 : deg(Math.atan2(b2, ap2))

  let dh = 0
  if (c1 * c2 !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }

  const dL = l2 - l1
  const dC = c2 - c1
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2))
  const lBar = (l1 + l2) / 2
  const cpBar = (c1 + c2) / 2

  let hBar = h1 + h2
  if (c1 * c2 !== 0) {
    hBar = Math.abs(h1 - h2) <= 180 ? hBar / 2 : hBar < 360 ? (hBar + 360) / 2 : (hBar - 360) / 2
  }

  const t =
    1 - 0.17 * Math.cos(rad(hBar - 30)) + 0.24 * Math.cos(rad(2 * hBar)) + 0.32 * Math.cos(rad(3 * hBar + 6)) - 0.2 * Math.cos(rad(4 * hBar - 63))
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2)
  const sC = 1 + 0.045 * cpBar
  const sH = 1 + 0.015 * cpBar * t
  const rT = -2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7)) * Math.sin(rad(60 * Math.exp(-(((hBar - 275) / 25) ** 2))))

  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH))
}

type Scored = ColorSwatch & { list: TapList; deltaE: number }

// The verdict for a tapped hex. Null when the hex is invalid or the palette
// has no readable swatch.
export function tapVerdict(hex: string, analysis: Pick<ColorAnalysis, 'bestColors' | 'neutrals' | 'avoidColors'>): TapResult | null {
  const tapped = TAP_HEX.test(hex) ? hexToLab(hex) : null

  if (!tapped) {
    return null
  }

  const lists: [TapList, ColorSwatch[] | undefined][] = [['best', analysis.bestColors], ['neutral', analysis.neutrals], ['avoid', analysis.avoidColors]]
  const scored: Scored[] = []

  for (const [list, swatches] of lists) {
    for (const swatch of swatches ?? []) {
      const lab = hexToLab(swatch.hex)
      if (lab) {
        scored.push({ name: swatch.name, hex: swatch.hex, list, deltaE: deltaE2000(tapped, lab) })
      }
    }
  }

  // Stable sort: ties keep palette order (best, neutral, avoid).
  scored.sort((a, b) => a.deltaE - b.deltaE)
  const nearest = scored[0]

  if (!nearest) {
    return null
  }

  const good = scored.find((swatch) => swatch.list !== 'avoid')
  const avoid = scored.find((swatch) => swatch.list === 'avoid')
  let verdict: TapVerdict
  let reasonKey: TapReason

  // A best or neutral color only wins when it's strictly closer than every
  // avoid color (a tie goes to avoid: the cautious answer).
  if (!good || good.deltaE > TAP_MODERATE || (avoid && avoid.deltaE <= good.deltaE)) {
    verdict = 'avoid'
    reasonKey = nearest.list === 'avoid' && nearest.deltaE <= TAP_MODERATE ? 'near_avoid' : 'far_from_palette'
  } else if (good.deltaE <= TAP_MATCH) {
    verdict = 'wear'
    reasonKey = 'in_palette'
  } else if (good.deltaE <= TAP_NEAR) {
    verdict = 'wear'
    reasonKey = good.list === 'neutral' ? 'neutral_base' : 'close_to_palette'
  } else {
    verdict = 'away'
    reasonKey = good.list === 'neutral' ? 'near_neutral' : 'near_palette'
  }

  // In the wear and away branches the best/neutral match is strictly closer
  // than any avoid color, so it is the nearest swatch overall.
  const seen = new Set([nearest.hex.toUpperCase()])
  const alternatives: ColorSwatch[] = []

  for (const swatch of scored) {
    if (alternatives.length === 3) break
    if (swatch.list !== 'best' || seen.has(swatch.hex.toUpperCase())) continue
    seen.add(swatch.hex.toUpperCase())
    alternatives.push({ name: swatch.name, hex: swatch.hex })
  }

  return {
    hex: hex.toUpperCase(),
    verdict,
    reasonKey,
    nearest: { name: nearest.name, hex: nearest.hex, list: nearest.list, deltaE: Math.round(nearest.deltaE * 10) / 10 },
    alternatives,
  }
}
