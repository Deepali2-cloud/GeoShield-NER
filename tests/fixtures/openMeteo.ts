import type { ZoneLocation } from '../../worker/openMeteo'

export const HOUR = 3_600_000
/** 03:00 UTC on 2026-10-10: the current hour used by every weather test. */
export const FLOOR_MS = Date.UTC(2026, 9, 10, 3, 0, 0)
/** 03:17 UTC: "now" is deliberately NOT on the hour, to prove windows are cut at the hour. */
export const NOW_MS = FLOOR_MS + 17 * 60_000

export const pastHourly = (zoneIndex: number) => (zoneIndex + 1) * 0.1
export const forecastHourly = (zoneIndex: number) => (zoneIndex + 1) * 0.05
/** A value that must never be counted: it sits just outside both windows. */
export const TRAP_MM = 9

/** Expected totals for zone index i (0-based). 72 past hours, 24 forecast hours. */
export const expectedPast = (i: number) => Math.round(72 * pastHourly(i) * 100) / 100
export const expectedForecast = (i: number) => Math.round(24 * forecastHourly(i) * 100) / 100

export interface ProviderOptions {
  /** Called per hour-stamp (epoch ms) and zone index; return undefined to use the default value. Return null for a missing hour. */
  override?: (zoneIndex: number, stampMs: number) => number | null | undefined
  /** Replace the per-location object entirely. */
  mutate?: (zoneIndex: number, loc: Record<string, unknown>) => Record<string, unknown> | undefined
}

/**
 * What Open-Meteo returns for `hourly=precipitation&past_hours=72&forecast_hours=25&timeformat=unixtime`:
 * a LIST with one object per requested location, in request order, hourly time as epoch SECONDS.
 * It carries one stamp before and one after the real windows (trap values) to prove the boundaries.
 */
export function providerBody(locations: readonly ZoneLocation[], opts: ProviderOptions = {}): Record<string, unknown>[] {
  return locations.map((loc, i) => {
    const time: number[] = []
    const precipitation: (number | null)[] = []
    for (let h = -72; h <= 25; h++) {
      const stamp = FLOOR_MS + h * HOUR
      let v: number | null
      if (h === -72 || h === 25) v = TRAP_MM
      else if (h <= 0) v = pastHourly(i)
      else v = forecastHourly(i)
      const o = opts.override?.(i, stamp)
      if (o !== undefined) v = o
      time.push(stamp / 1000)
      precipitation.push(v)
    }
    const base: Record<string, unknown> = {
      // Providers snap to a grid: slightly different coordinates than requested are normal.
      latitude: loc.latitude + 0.03,
      longitude: loc.longitude - 0.02,
      generationtime_ms: 0.4,
      utc_offset_seconds: 0,
      timezone: 'UTC',
      timezone_abbreviation: 'GMT',
      elevation: 100,
      hourly_units: { time: 'unixtime', precipitation: 'mm' },
      hourly: { time, precipitation },
    }
    return opts.mutate?.(i, base) ?? base
  })
}

export const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
