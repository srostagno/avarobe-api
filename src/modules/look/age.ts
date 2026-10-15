import { env } from '../../config/env.js'

// The age she sees. Face-age models miss older women by 3.5–4.4 years on
// average and lean old (NIST IR 8525, 2024), and one person's estimate
// moves 2+ years between photos with the light and the expression. So:
// - the model's lean comes off (LOOK_AGE_OFFSET, to re-measure from real
//   ages: on average people look their age, so a steady gap is the model's);
// - next to her real age it never reads more than OLDEST years over it
//   (Silvio, Oct 15: honest, but not cruel), nor more than YOUNGEST under;
// - "today" is the median of her last photos within a month, not one photo.

const OLDEST = 6
const YOUNGEST = 15
const RECENT_DAYS = 30
const RECENT_PHOTOS = 5
const DAY_MS = 24 * 60 * 60 * 1000

const BIRTH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// A real 'YYYY-MM-DD' day (not Feb 30), or null.
export function parseBirthDate(value: string): Date | null {
  const match = BIRTH_DATE.exec(value)

  if (!match) {
    return null
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))

  return date.toISOString().slice(0, 10) === value ? date : null
}

// Whole years between her birth date and a day.
export function ageOn(birthDate: string, day: Date): number | null {
  const birth = parseBirthDate(birthDate)

  if (!birth) {
    return null
  }

  let years = day.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthday =
    day.getUTCMonth() < birth.getUTCMonth() || (day.getUTCMonth() === birth.getUTCMonth() && day.getUTCDate() < birth.getUTCDate())

  if (beforeBirthday) {
    years -= 1
  }

  return years
}

// The model's estimate, calibrated, next to her real age at the photo's date.
export function shownAge(apparentAge: number, realAge: number | null): number {
  const calibrated = apparentAge + env.LOOK_AGE_OFFSET

  if (realAge === null) {
    return Math.round(calibrated)
  }

  return Math.round(Math.min(realAge + OLDEST, Math.max(realAge - YOUNGEST, calibrated)))
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

// The photos "today" is read from: her last ones taken within a month of
// the newest.
export function recentOf<T extends { takenAt: Date }>(points: T[]): T[] {
  const newest = [...points].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())

  if (newest.length === 0) {
    return []
  }

  const since = newest[0]!.takenAt.getTime() - RECENT_DAYS * DAY_MS

  return newest.filter((point) => point.takenAt.getTime() >= since).slice(0, RECENT_PHOTOS)
}

// "Your face today": their median, so one dim or flattering photo doesn't
// swing it.
export function currentAge(points: { takenAt: Date; age: number }[]): number | null {
  const recent = recentOf(points)

  return recent.length ? Math.round(median(recent.map((point) => point.age))) : null
}
