import type { ColorChangeDirection, ColorLighting, ColorScores } from '../../types/mongo.js'
import { changeDirection, isSeason, rankSeasons, seasonFit } from './seasons.js'

// Same person, same season: what a new photo does to a season they already
// have. Pure code.
//
// A new photo changes the season only when its own scores put the new
// season at least SWITCH_MARGIN ahead of the current one and the light is
// not poor (light shifts every photo a little). For a buyer, a clear
// difference becomes a candidate she chooses about, never a change. In
// 'classic' (no scores) an existing season never changes by itself.

export const SWITCH_MARGIN = 2
// Under this margin between the best two seasons, one more measurement of
// the same photo is averaged in (measure.ts).
export const CLOSE_GAP = 1

export type ColorOutcome = 'first' | 'confirmed' | 'anchored' | 'changed' | 'candidate'

// A scored read: the photo's measurement (one, or two averaged).
export type ScoredMeasure = {
  method: 'scored'
  scores: ColorScores
  lighting: ColorLighting
  samples: 1 | 2
}

// A classic read: the model's own season.
export type ClassicMeasure = { method: 'classic'; season: string }

export type ColorDecision = {
  outcome: ColorOutcome
  // What this photo read as.
  read: string
  // The season the person has after the read (a candidate keeps the paid one).
  shown: string
  from: string | null
  direction: ColorChangeDirection | null
  margin: number | null
  lead: number | null
  // Whether the palette for `read` has to be written (first, changed, candidate).
  palette: boolean
}

export function decideColors(input: { current: string | null; locked: boolean; measure: ScoredMeasure | ClassicMeasure }): ColorDecision {
  const { current, locked, measure } = input

  if (measure.method === 'classic') {
    if (!current) {
      return { outcome: 'first', read: measure.season, shown: measure.season, from: null, direction: null, margin: null, lead: null, palette: true }
    }

    return {
      outcome: measure.season === current ? 'confirmed' : 'anchored',
      read: measure.season,
      shown: current,
      from: null,
      direction: null,
      margin: null,
      lead: null,
      palette: false,
    }
  }

  const ranking = rankSeasons(measure.scores, current)
  const next = ranking.season
  const base = { read: next, margin: ranking.margin }

  if (!current) {
    return { ...base, outcome: 'first', shown: next, from: null, direction: null, lead: null, palette: true }
  }

  if (next === current) {
    return { ...base, outcome: 'confirmed', shown: current, from: null, direction: null, lead: 0, palette: false }
  }

  // A season from before the 12 (never written by the read): any clear
  // read replaces it, through a choice for a buyer.
  const lead = isSeason(current) ? ranking.fits[next] - seasonFit(current, measure.scores) : Number.POSITIVE_INFINITY

  if (measure.lighting === 'poor' || lead < SWITCH_MARGIN) {
    return { ...base, outcome: 'anchored', shown: current, from: null, direction: null, lead: finite(lead), palette: false }
  }

  return {
    ...base,
    outcome: locked ? 'candidate' : 'changed',
    shown: locked ? current : next,
    from: current,
    direction: isSeason(current) ? changeDirection(current, next) : null,
    lead: finite(lead),
    palette: true,
  }
}

const finite = (value: number) => (Number.isFinite(value) ? value : null)
