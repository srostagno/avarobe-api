import type { ColorAnalysis, ColorChangeDirection, ColorLighting, ColorScores } from '../../types/mongo.js'
import { COLOR_SEASONS } from './prompts.js'

// Same person, same season: the season follows from a photo's measured
// traits by a fixed table, never from the model's pick. Pure code.
//
// Each season is one strong trait (its main trait, on one side) plus a
// secondary one. fit(s) = main + 0.5 × secondary, with x = (w)armth,
// (d)epth, (c)hroma; for Warm and Cool the 0.25 already includes the 0.5.
// The best fit wins: the strongest trait, except that near ties warmth,
// the trait a photo's light shifts most, counts last. Checked against the
// evidence of 11-Oct-2026: her (2,4,-1) ×4 and (3,4,-1), (2,3,-1) Deep
// Autumn; his (2,2,0) ×4 Deep Autumn and (2,1,0) Warm Autumn.

export type Season = (typeof COLOR_SEASONS)[number]
export type Trait = 'depth' | 'chroma' | 'warmth'
type Family = 'Deep' | 'Light' | 'Bright' | 'Soft' | 'Warm' | 'Cool'
type Traits = Pick<ColorScores, 'warmth' | 'depth' | 'chroma'>

const SEASON_RULES: Record<Season, { family: Family; main: Trait; pole: 1 | -1; fit: (x: Traits) => number }> = {
  'Light Spring': { family: 'Light', main: 'depth', pole: -1, fit: ({ warmth: w, depth: d }) => -d + 0.5 * w },
  'Light Summer': { family: 'Light', main: 'depth', pole: -1, fit: ({ warmth: w, depth: d }) => -d - 0.5 * w },
  'Deep Autumn': { family: 'Deep', main: 'depth', pole: 1, fit: ({ warmth: w, depth: d }) => d + 0.5 * w },
  'Deep Winter': { family: 'Deep', main: 'depth', pole: 1, fit: ({ warmth: w, depth: d }) => d - 0.5 * w },
  'Bright Spring': { family: 'Bright', main: 'chroma', pole: 1, fit: ({ warmth: w, chroma: c }) => c + 0.5 * w },
  'Bright Winter': { family: 'Bright', main: 'chroma', pole: 1, fit: ({ warmth: w, chroma: c }) => c - 0.5 * w },
  'Soft Autumn': { family: 'Soft', main: 'chroma', pole: -1, fit: ({ warmth: w, chroma: c }) => -c + 0.5 * w },
  'Soft Summer': { family: 'Soft', main: 'chroma', pole: -1, fit: ({ warmth: w, chroma: c }) => -c - 0.5 * w },
  'Warm Spring': { family: 'Warm', main: 'warmth', pole: 1, fit: ({ warmth: w, depth: d, chroma: c }) => w + 0.25 * (c - d) },
  'Warm Autumn': { family: 'Warm', main: 'warmth', pole: 1, fit: ({ warmth: w, depth: d, chroma: c }) => w + 0.25 * (d - c) },
  'Cool Summer': { family: 'Cool', main: 'warmth', pole: -1, fit: ({ warmth: w, depth: d, chroma: c }) => -w - 0.25 * (c + d) },
  'Cool Winter': { family: 'Cool', main: 'warmth', pole: -1, fit: ({ warmth: w, depth: d, chroma: c }) => -w + 0.25 * (c + d) },
}

const TIE = 1e-9
const TRAIT_ORDER: Trait[] = ['depth', 'chroma', 'warmth']

export function isSeason(value: string | null | undefined): value is Season {
  return Boolean(value) && (COLOR_SEASONS as readonly string[]).includes(value as string)
}

export function seasonFit(season: Season, scores: Traits) {
  return SEASON_RULES[season].fit(scores)
}

// Within one family, an exact tie (the secondary trait at 0) goes by the
// third trait.
function byThirdTrait(family: Family, { depth: d, chroma: c }: Traits): Season {
  switch (family) {
    case 'Deep':
      return c <= 0 ? 'Deep Autumn' : 'Deep Winter'
    case 'Light':
      return c > 0 ? 'Light Spring' : 'Light Summer'
    case 'Bright':
      return d <= 0 ? 'Bright Spring' : 'Bright Winter'
    case 'Soft':
      return d > 0 ? 'Soft Autumn' : 'Soft Summer'
    case 'Warm':
      return d > 0 ? 'Warm Autumn' : 'Warm Spring'
    case 'Cool':
      return d > 0 ? 'Cool Winter' : 'Cool Summer'
  }
}

// Exact ties: the person's current season; then the season whose main trait
// is depth, then chroma, then warmth (a main trait at exactly 0 takes its
// positive side: Deep, Bright, Warm); then the third trait.
function breakTie(tied: Season[], scores: Traits, current: string | null): Season {
  if (current && (tied as string[]).includes(current)) {
    return current as Season
  }

  for (const trait of TRAIT_ORDER) {
    const group = tied.filter((season) => SEASON_RULES[season].main === trait)

    if (group.length === 0) {
      continue
    }

    const pole = scores[trait] >= 0 ? 1 : -1
    const side = group.filter((season) => SEASON_RULES[season].pole === pole)
    const pool = side.length > 0 ? side : group

    return pool.length === 1 ? pool[0]! : byThirdTrait(SEASON_RULES[pool[0]!].family, scores)
  }

  return tied[0]!
}

export type SeasonRanking = {
  season: Season
  // fit(top1) - fit(top2), after the tie-break.
  margin: number
  fits: Record<Season, number>
}

export function rankSeasons(scores: Traits, current: string | null = null): SeasonRanking {
  const fits = Object.fromEntries(COLOR_SEASONS.map((season) => [season, seasonFit(season, scores)])) as Record<Season, number>
  const best = Math.max(...Object.values(fits))
  const tied = COLOR_SEASONS.filter((season) => best - fits[season] < TIE)
  const season = tied.length === 1 ? tied[0]! : breakTie([...tied], scores, current)
  const runnerUp = Math.max(...COLOR_SEASONS.filter((other) => other !== season).map((other) => fits[other]))

  return { season, margin: fits[season] - runnerUp, fits }
}

// Two measurements of the same photo, averaged (a close call).
export function averageScores(a: ColorScores, b: ColorScores): ColorScores {
  const mean = (x: number, y: number) => (x + y) / 2

  return {
    warmth: mean(a.warmth, b.warmth),
    depth: mean(a.depth, b.depth),
    chroma: mean(a.chroma, b.chroma),
    contrast: mean(a.contrast, b.contrast),
  }
}

// ---------------------------------------------------------------- the rest of the read, in code

export function undertoneOf(scores: Pick<ColorScores, 'warmth'>, olive: boolean): ColorAnalysis['undertone'] {
  const w = scores.warmth

  if (olive && Math.abs(w) <= 2) {
    return 'olive'
  }

  return w >= 2 ? 'warm' : w <= -2 ? 'cool' : 'neutral'
}

export function contrastOf(scores: Pick<ColorScores, 'contrast'>): ColorAnalysis['contrast'] {
  return scores.contrast >= 2 ? 'high' : scores.contrast <= -2 ? 'low' : 'medium'
}

export function metalsOf(scores: Pick<ColorScores, 'warmth'>): ColorAnalysis['metals'] {
  return scores.warmth >= 2 ? 'gold' : scores.warmth <= -2 ? 'silver' : 'both'
}

export function confidenceOf(lighting: ColorLighting, margin: number): ColorAnalysis['confidence'] {
  if (lighting === 'poor') {
    return 'low'
  }

  return margin >= 2 ? 'high' : margin >= 1 ? 'medium' : 'low'
}

// Which way a season moved, for what the person is told. Within one family
// (Deep Winter to Deep Autumn), the side of the new season's secondary
// trait; across families, the new season's main trait.
export function changeDirection(from: Season, to: Season): ColorChangeDirection {
  const next = SEASON_RULES[to]

  if (SEASON_RULES[from].family === next.family) {
    switch (to) {
      case 'Warm Autumn':
      case 'Cool Summer':
        return 'softer'
      case 'Warm Spring':
      case 'Cool Winter':
        return 'brighter'
      default:
        return /Spring|Autumn/.test(to) ? 'warmer' : 'cooler'
    }
  }

  const words: Record<Family, ColorChangeDirection> = {
    Deep: 'deeper',
    Light: 'lighter',
    Bright: 'brighter',
    Soft: 'softer',
    Warm: 'warmer',
    Cool: 'cooler',
  }

  return words[next.family]
}
