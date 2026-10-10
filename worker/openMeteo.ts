import type { ProviderStatus } from '../src/types/weather'
import { WEATHER_FORECAST_HOURS, WEATHER_PAST_HOURS, WEATHER_UNIT } from '../src/types/weather'

/**
 * Open-Meteo client: one batched request for all zones, strict parsing, no invented values.
 *
 * Endpoint (official docs, https://open-meteo.com/en/docs): GET https://api.open-meteo.com/v1/forecast
 *   latitude=a,b,...  longitude=a,b,...   comma-separated: one request, JSON becomes a list in request order
 *   hourly=precipitation                  mm, SUM OF THE PRECEDING HOUR, stamped at the end of that hour
 *   past_hours / forecast_hours           hours counted from the current hour
 *   timeformat=unixtime                   timestamps are UTC epoch seconds, so no timezone parsing is needed
 *
 * Why not the Historical Weather API (archive-api.open-meteo.com)? Its ERA5 data lags by about 5 days, so it cannot
 * cover the last 72 hours. The forecast endpoint's `past_hours` is the supported way to get recent hours, but it is
 * MODEL-DERIVED (archived model analysis / short-range forecasts), not rain-gauge observation. It is labelled so.
 */

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const HOUR_MS = 3_600_000
/** Requested one hour beyond the 24 needed; windows are cut by timestamp, never by array position or count. */
const REQUEST_FORECAST_HOURS = WEATHER_FORECAST_HOURS + 1
/** Grid cells are snapped by the provider; anything further from the requested point is not "this zone". */
const MAX_GRID_OFFSET_DEG = 0.5
/** Physical sanity cap for ONE hour of precipitation (mm). Larger values are treated as missing, not clamped. */
const MAX_HOURLY_MM = 500
const MAX_BODY_CHARS = 2_000_000

export interface ZoneLocation {
  id: string
  name: string
  latitude: number
  longitude: number
}

export interface WindowSum {
  totalMm: number
  /** Window covers (startMs, endMs] in UTC epoch milliseconds. */
  startMs: number
  endMs: number
}

export interface ZoneSnapshot {
  past: WindowSum | null
  forecast: WindowSum | null
}

export interface WeatherSnapshot {
  /** When the Worker started the provider request (UTC epoch ms). */
  fetchedAtMs: number
  zones: Record<string, ZoneSnapshot>
}

export type ProviderFailure = Exclude<ProviderStatus, 'ok' | 'not_attempted'>

/** A provider problem. `kind` is safe to expose; `message` is for the server log only. */
export class ProviderError extends Error {
  readonly kind: ProviderFailure
  constructor(kind: ProviderFailure, message: string) {
    super(message)
    this.kind = kind
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function buildRequestUrl(locations: readonly ZoneLocation[]): string {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.latitude).join(','),
    longitude: locations.map((l) => l.longitude).join(','),
    hourly: 'precipitation',
    past_hours: String(WEATHER_PAST_HOURS),
    forecast_hours: String(REQUEST_FORECAST_HOURS),
    timezone: 'UTC',
    timeformat: 'unixtime',
    precipitation_unit: 'mm',
  })
  // URLSearchParams encodes the commas; Open-Meteo accepts both forms, but keep the documented readable form.
  return `${OPEN_METEO_URL}?${params.toString().replace(/%2C/g, ',')}`
}

/** Start of the hour containing `ms`. */
export const floorToHour = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS

/**
 * Sums exactly `hours` hour-stamps ending at `endMs` (stamps endMs-(hours-1)h ... endMs).
 * Returns null if ANY of them is absent or invalid: a partial sum would silently understate rainfall.
 */
function sumWindow(values: Map<number, number>, endMs: number, hours: number): WindowSum | null {
  let total = 0
  for (let i = 0; i < hours; i++) {
    const v = values.get(endMs - i * HOUR_MS)
    if (v === undefined) return null
    total += v
  }
  return { totalMm: Math.round(total * 100) / 100, startMs: endMs - hours * HOUR_MS, endMs }
}

/** Reads one location object. Returns null when it cannot be trusted for this zone. */
function parseLocation(item: unknown, zone: ZoneLocation, floorMs: number): ZoneSnapshot | null {
  if (!isRecord(item)) return null
  // Mapping safeguard: results are matched to zones by position, so confirm the grid point is near the zone.
  if (!isFiniteNumber(item.latitude) || !isFiniteNumber(item.longitude)) return null
  if (Math.abs(item.latitude - zone.latitude) > MAX_GRID_OFFSET_DEG || Math.abs(item.longitude - zone.longitude) > MAX_GRID_OFFSET_DEG) return null

  const units = item.hourly_units
  if (!isRecord(units) || units.precipitation !== WEATHER_UNIT) return null // never assume the unit

  const hourly = item.hourly
  if (!isRecord(hourly) || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation)) return null
  if (hourly.time.length !== hourly.precipitation.length) return null

  const values = new Map<number, number>()
  for (let i = 0; i < hourly.time.length; i++) {
    const t: unknown = hourly.time[i]
    const p: unknown = hourly.precipitation[i]
    if (!isFiniteNumber(t) || !Number.isInteger(t)) return null // time axis must be epoch seconds
    if (!isFiniteNumber(p) || p < 0 || p > MAX_HOURLY_MM) continue // null / garbage hour: left missing
    values.set(t * 1000, p)
  }

  return {
    // 72 stamps ending at the current hour: precipitation in (floor-72h, floor].
    past: sumWindow(values, floorMs, WEATHER_PAST_HOURS),
    // 24 stamps after it: precipitation in (floor, floor+24h]. A forecast, never an observation.
    forecast: sumWindow(values, floorMs + WEATHER_FORECAST_HOURS * HOUR_MS, WEATHER_FORECAST_HOURS),
  }
}

/**
 * Validates an untrusted provider body and maps it to zones by request order.
 * Throws `ProviderError('invalid_response')` when the body cannot be mapped at all. Individual zones that
 * cannot be trusted are simply left out of the result (they become "unavailable").
 */
export function parseOpenMeteo(body: unknown, locations: readonly ZoneLocation[], fetchedAtMs: number): Record<string, ZoneSnapshot> {
  // One location -> a single object; several -> a list. Both are documented.
  const list: unknown[] = Array.isArray(body) ? body : isRecord(body) ? [body] : []
  if (list.length !== locations.length) throw new ProviderError('invalid_response', `expected ${locations.length} locations, got ${list.length}`)

  const floorMs = floorToHour(fetchedAtMs)
  const zones: Record<string, ZoneSnapshot> = {}
  locations.forEach((zone, i) => {
    const snap = parseLocation(list[i], zone, floorMs)
    if (snap && (snap.past || snap.forecast)) zones[zone.id] = snap
  })
  return zones
}

/**
 * One bounded request for every zone. `fetchFn` and `nowMs` are injected so tests never touch the network.
 * Throws `ProviderError` for every failure; callers decide what to serve instead.
 */
export async function fetchOpenMeteo(
  locations: readonly ZoneLocation[],
  fetchFn: typeof fetch,
  nowMs: number,
  timeoutMs: number,
): Promise<WeatherSnapshot> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let res: Response
    try {
      res = await fetchFn(buildRequestUrl(locations), { signal: controller.signal, headers: { accept: 'application/json' } })
    } catch (err) {
      if (controller.signal.aborted) throw new ProviderError('timeout', `no response within ${timeoutMs} ms`)
      throw new ProviderError('network_error', err instanceof Error ? err.message : 'fetch failed')
    }
    if (res.status === 429) throw new ProviderError('rate_limited', 'HTTP 429')
    if (!res.ok) throw new ProviderError('http_error', `HTTP ${res.status}`)

    let text: string
    try {
      text = await res.text()
    } catch {
      if (controller.signal.aborted) throw new ProviderError('timeout', 'body read timed out')
      throw new ProviderError('network_error', 'body read failed')
    }
    if (text.length > MAX_BODY_CHARS) throw new ProviderError('invalid_response', 'response too large')
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new ProviderError('invalid_response', 'not JSON')
    }
    // Open-Meteo reports some errors as {"error": true, "reason": "..."}.
    if (isRecord(body) && body.error === true) throw new ProviderError('http_error', 'provider reported an error')
    return { fetchedAtMs: nowMs, zones: parseOpenMeteo(body, locations, nowMs) }
  } finally {
    clearTimeout(timer)
  }
}
