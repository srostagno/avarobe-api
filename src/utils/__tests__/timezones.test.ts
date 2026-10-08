import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { localHour, timeZoneFor } from '../timezones.js'

const at = (country: string, region: string | null = null) => ({ country, region })

describe('local time', () => {
  it('goes by state in the US, Canada and Australia', () => {
    assert.equal(timeZoneFor(at('US', 'NY')), 'America/New_York')
    assert.equal(timeZoneFor(at('US', 'TX')), 'America/Chicago')
    assert.equal(timeZoneFor(at('US', 'CO')), 'America/Denver')
    assert.equal(timeZoneFor(at('US', 'CA')), 'America/Los_Angeles')
    assert.equal(timeZoneFor(at('US', 'AZ')), 'America/Phoenix')
    assert.equal(timeZoneFor(at('US', 'AK')), 'America/Anchorage')
    assert.equal(timeZoneFor(at('US', 'HI')), 'Pacific/Honolulu')
    assert.equal(timeZoneFor(at('CA', 'BC')), 'America/Vancouver')
    assert.equal(timeZoneFor(at('CA', 'QC')), 'America/Toronto')
    assert.equal(timeZoneFor(at('AU', 'WA')), 'Australia/Perth')
    // An unknown state: the country's main zone.
    assert.equal(timeZoneFor(at('US')), 'America/New_York')
    assert.equal(timeZoneFor(at('AU', 'XX')), 'Australia/Sydney')
  })

  it('goes by country elsewhere, and New York without a location', () => {
    assert.equal(timeZoneFor(at('BR', 'SP')), 'America/Sao_Paulo')
    assert.equal(timeZoneFor(at('MX')), 'America/Mexico_City')
    assert.equal(timeZoneFor(at('CL')), 'America/Santiago')
    assert.equal(timeZoneFor(at('AR')), 'America/Argentina/Buenos_Aires')
    assert.equal(timeZoneFor(at('IE')), 'Europe/Dublin')
    assert.equal(timeZoneFor(at('NZ')), 'Pacific/Auckland')
    assert.equal(timeZoneFor(at('JP')), 'America/New_York')
    assert.equal(timeZoneFor(null), 'America/New_York')
    assert.equal(timeZoneFor(undefined), 'America/New_York')
  })

  it('reads the hour on their clock, midnight as 0', () => {
    // 15:00 UTC on 8 Oct 2026: daylight saving time in the US, not in Brazil.
    const now = new Date('2026-10-08T15:00:00Z')
    assert.equal(localHour(at('US', 'NY'), now), 11)
    assert.equal(localHour(at('US', 'CA'), now), 8)
    assert.equal(localHour(at('US', 'AZ'), now), 8)
    assert.equal(localHour(at('BR'), now), 12)
    assert.equal(localHour(at('MX'), now), 9)
    assert.equal(localHour(at('ES'), now), 17)
    assert.equal(localHour(at('NZ'), now), 4)
    assert.equal(localHour(null, new Date('2026-10-08T04:00:00Z')), 0)
  })
})
