// The score, computed in code from the measured criteria (each 0–4): never
// the model's own number, so it is the same for the same ratings and every
// point traces back to a criterion. `offset` moves every score, `floor` is
// the lowest shown (honest, never cruel); 99 at most.

export type ScoreSettings = { offset: number; floor: number }

export function scoreFrom(criteria: Record<string, number>, ids: string[], settings: ScoreSettings) {
  const sum = ids.reduce((total, id) => total + (criteria[id] ?? 0), 0)
  const raw = (sum / (4 * ids.length)) * 100 + settings.offset

  return Math.max(settings.floor, Math.min(99, Math.round(raw)))
}

const clampRating = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(4, value)) : 0)

// Several measurements of one photo, criterion by criterion (one decimal).
export function averageCriteria(samples: Record<string, number>[], ids: string[]) {
  return Object.fromEntries(
    ids.map((id) => {
      const values = samples.map((sample) => clampRating(sample[id]))
      const mean = values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)

      return [id, Math.round(mean * 10) / 10]
    }),
  ) as Record<string, number>
}

// The criteria from lowest to highest (ties keep the rubric's order).
export function weakestFirst(criteria: Record<string, number>, ids: string[]) {
  return [...ids].sort((a, b) => (criteria[a] ?? 0) - (criteria[b] ?? 0) || ids.indexOf(a) - ids.indexOf(b))
}

const RECENT_DAYS = 30
const RECENT_MAX = 5

// Her score now: the median of her latest photos (up to 5, within 30 days of
// the newest), so one photo in bad light doesn't swing it. `photos`: ready
// ones, any order.
export function currentScore(photos: { takenAt: Date; score: number }[]) {
  if (photos.length === 0) {
    return null
  }

  const sorted = [...photos].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
  const newest = sorted[0]!.takenAt.getTime()
  const recent = sorted.filter((photo) => newest - photo.takenAt.getTime() <= RECENT_DAYS * 24 * 60 * 60 * 1000).slice(0, RECENT_MAX)
  const scores = recent.map((photo) => photo.score).sort((a, b) => a - b)
  const middle = Math.floor(scores.length / 2)

  return scores.length % 2 ? scores[middle]! : Math.round((scores[middle - 1]! + scores[middle]!) / 2)
}
