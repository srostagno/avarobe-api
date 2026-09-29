import type { FastifyRequest } from 'fastify'

import type { UserLocation } from '../../types/mongo.js'

// Where a visitor is, as the web's host (Vercel) reads it from their IP:
// "US-TX", or just the country ("CL") when it has no state. The web's
// middleware puts it in a cookie for the whole avarobe.com domain, so the API
// learns the state without ever looking the IP up itself.
export const GEO_COOKIE = 'avarobe_geo'

const GEO_PATTERN = /^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/

export type Geo = { country: string; region: string | null }

export function parseGeo(value: string | null | undefined): Geo | null {
  const match = value ? GEO_PATTERN.exec(value.trim().toUpperCase()) : null

  return match ? { country: match[1]!, region: match[2] ?? null } : null
}

export function requestGeo(request: FastifyRequest) {
  return parseGeo(request.cookies[GEO_COOKIE])
}

export function geoCode(geo: Geo | null | undefined) {
  return geo ? (geo.region ? `${geo.country}-${geo.region}` : geo.country) : null
}

// Saved on the user at sign-up: country and state only, never the IP.
export function signupLocation(request: FastifyRequest, now: Date): UserLocation | null {
  const geo = requestGeo(request)

  return geo ? { ...geo, source: 'edge', at: now } : null
}
