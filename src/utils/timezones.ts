import type { UserLocation } from '../types/mongo.js'

// Someone's local time, for emails that should land in her daytime (the
// cross-sell emails go out between 9:00 and 20:00 where she is). It comes
// from the country and state she signed up from (users.location), one zone
// per state or country: the one most people there live in. Anyone else, or
// with no location, gets New York's, where most buyers are.
const DEFAULT_ZONE = 'America/New_York'

const EASTERN = 'America/New_York'
const CENTRAL = 'America/Chicago'
const MOUNTAIN = 'America/Denver'
const PACIFIC = 'America/Los_Angeles'

// By state code, as the web's host reports it ("US-TX" → TX). States split
// between two zones go by their larger part (Texas, Florida, Tennessee…).
const US_ZONES: Record<string, string> = {
  ...Object.fromEntries(
    ['CT', 'DC', 'DE', 'FL', 'GA', 'IN', 'KY', 'MA', 'MD', 'ME', 'MI', 'NC', 'NH', 'NJ', 'NY', 'OH', 'PA', 'RI', 'SC', 'VA', 'VT', 'WV'].map(
      (state) => [state, EASTERN],
    ),
  ),
  ...Object.fromEntries(
    ['AL', 'AR', 'IA', 'IL', 'KS', 'LA', 'MN', 'MO', 'MS', 'ND', 'NE', 'OK', 'SD', 'TN', 'TX', 'WI'].map((state) => [state, CENTRAL]),
  ),
  ...Object.fromEntries(['CO', 'ID', 'MT', 'NM', 'UT', 'WY'].map((state) => [state, MOUNTAIN])),
  ...Object.fromEntries(['CA', 'NV', 'OR', 'WA'].map((state) => [state, PACIFIC])),
  // No daylight saving time in Arizona.
  AZ: 'America/Phoenix',
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
  PR: 'America/Puerto_Rico',
}

const CA_ZONES: Record<string, string> = {
  AB: 'America/Edmonton',
  BC: 'America/Vancouver',
  MB: 'America/Winnipeg',
  NB: 'America/Moncton',
  NL: 'America/St_Johns',
  NS: 'America/Halifax',
  NT: 'America/Yellowknife',
  NU: 'America/Iqaluit',
  ON: 'America/Toronto',
  PE: 'America/Halifax',
  QC: 'America/Toronto',
  SK: 'America/Regina',
  YT: 'America/Whitehorse',
}

const AU_ZONES: Record<string, string> = {
  ACT: 'Australia/Sydney',
  NSW: 'Australia/Sydney',
  NT: 'Australia/Darwin',
  QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide',
  TAS: 'Australia/Hobart',
  VIC: 'Australia/Melbourne',
  WA: 'Australia/Perth',
}

// Countries by state, with the zone for an unknown state.
const BY_STATE: Record<string, { zones: Record<string, string>; fallback: string }> = {
  US: { zones: US_ZONES, fallback: EASTERN },
  CA: { zones: CA_ZONES, fallback: 'America/Toronto' },
  AU: { zones: AU_ZONES, fallback: 'Australia/Sydney' },
}

const COUNTRY_ZONES: Record<string, string> = {
  BR: 'America/Sao_Paulo',
  MX: 'America/Mexico_City',
  CO: 'America/Bogota',
  CL: 'America/Santiago',
  AR: 'America/Argentina/Buenos_Aires',
  PE: 'America/Lima',
  EC: 'America/Guayaquil',
  VE: 'America/Caracas',
  UY: 'America/Montevideo',
  PY: 'America/Asuncion',
  BO: 'America/La_Paz',
  CR: 'America/Costa_Rica',
  PA: 'America/Panama',
  GT: 'America/Guatemala',
  DO: 'America/Santo_Domingo',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  IT: 'Europe/Rome',
  NZ: 'Pacific/Auckland',
}

export function timeZoneFor(location: Pick<UserLocation, 'country' | 'region'> | null | undefined): string {
  const country = location?.country?.toUpperCase() ?? ''
  const byState = BY_STATE[country]

  if (byState) {
    return byState.zones[location?.region?.toUpperCase() ?? ''] ?? byState.fallback
  }

  return COUNTRY_ZONES[country] ?? DEFAULT_ZONE
}

const hourFormats = new Map<string, Intl.DateTimeFormat>()

// The hour on her clock now, 0 to 23.
export function localHour(location: Pick<UserLocation, 'country' | 'region'> | null | undefined, now: Date): number {
  const timeZone = timeZoneFor(location)
  let format = hourFormats.get(timeZone)

  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    hourFormats.set(timeZone, format)
  }

  return Number(format.format(now)) % 24
}
