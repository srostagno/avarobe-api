// Days as the admin counts them: Pacific time, the ad account's day.

// "2026-10-07" in Pacific time.
export function pacificDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date)
}

// When a Pacific day starts: midnight is 07:00 UTC in daylight time and
// 08:00 UTC in standard time.
export function pacificStart(day: string) {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const daylight = new Date(Date.UTC(year, month - 1, date, 7))

  return pacificDay(daylight) === day ? daylight : new Date(Date.UTC(year, month - 1, date, 8))
}

export function addDays(day: string, count: number) {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]

  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10)
}

// Days in a range, both ends included.
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}
