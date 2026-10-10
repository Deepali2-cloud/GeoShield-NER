import type {
  ForecastPrecipitation,
  PastPrecipitation,
  ProviderStatus,
  WeatherCacheState,
  WeatherResponse,
  WeatherStatus,
  WeatherWindow,
  ZoneWeather,
} from '../src/types/weather'
import { FORECAST_KIND, PAST_KIND, WEATHER_FORECAST_HOURS, WEATHER_PAST_HOURS, WEATHER_UNIT } from '../src/types/weather'
import type { D1Like, Env } from './db'
import { ProviderError, fetchOpenMeteo } from './openMeteo'
import type { WeatherSnapshot, WindowSum, ZoneLocation, ZoneSnapshot } from './openMeteo'
import { loadZoneLocations } from './zones'

/**
 * Weather service: cache policy + response building. The provider client is in ./openMeteo.ts.
 *
 * Cache policy (all explicit, all constants below):
 *   age <= FRESH_SECONDS        served from cache, labelled `live`; the provider is not called
 *   age >  FRESH_SECONDS        one refresh attempt (bounded by PROVIDER_TIMEOUT_MS)
 *     refresh succeeds          new snapshot stored and served as `live`
 *     refresh fails             the old snapshot is served ONLY IF age <= MAX_STALE_SECONDS, labelled `stale`
 *                               with its real age; otherwise the response is `unavailable` with no values
 *   after a failed refresh the provider is not retried for FAILURE_COOLDOWN_MS (per isolate), so a retry button or
 *   a provider outage cannot turn into a stream of upstream calls.
 *
 * Storage is the existing D1 binding (table `weather_cache`, migration 0002): no new infrastructure. It is shared by
 * all Worker instances and survives restarts, so a stale snapshot keeps a known age and provenance. A cache read or
 * write failure is logged and treated as a miss; it never fails the request.
 *
 * Known limit: concurrent requests that all find an expired cache may each call the provider once. In-flight
 * promise sharing is deliberately not used because a Worker must not await another request's I/O.
 */

export const FRESH_SECONDS = 30 * 60
export const MAX_STALE_SECONDS = 6 * 60 * 60
export const FAILURE_COOLDOWN_MS = 60_000
export const PROVIDER_TIMEOUT_MS = 8_000
/** A snapshot stamped further than this into the future is treated as corrupt. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000

const CACHE_KEY_PREFIX = 'open-meteo:forecast:precip-72p-24f:v1'

export const WEATHER_NOTICE =
  'Past-72h values are model-derived recent precipitation from Open-Meteo, not rain-gauge observations. ' +
  'Forecast values are predictions for the next 24 hours, not measurements. Neither is used in the risk score yet.'

export interface WeatherDeps {
  fetch: typeof fetch
  now: () => number
  timeoutMs: number
}

export const defaultWeatherDeps = (): WeatherDeps => ({
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => Date.now(),
  timeoutMs: PROVIDER_TIMEOUT_MS,
})

// ---- per-isolate failure memory (plain data only; safe to share between requests) --------------------------------

interface FailureMemory {
  key: string
  atMs: number
  status: ProviderStatus
}
let lastFailure: FailureMemory | null = null

/** Tests only: forget the failure cooldown. */
export function resetWeatherRuntime(): void {
  lastFailure = null
}

// ---- cache store --------------------------------------------------------------------------------------------------

export function cacheKey(locations: readonly ZoneLocation[]): string {
  return `${CACHE_KEY_PREFIX}|${locations.map((l) => `${l.id}:${l.latitude},${l.longitude}`).join('|')}`
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isWindowSum(v: unknown): v is WindowSum {
  return isRecord(v) && isNum(v.totalMm) && v.totalMm >= 0 && isNum(v.startMs) && isNum(v.endMs) && v.endMs > v.startMs
}

function parseSnapshot(raw: unknown): WeatherSnapshot | null {
  if (!isRecord(raw) || !isNum(raw.fetchedAtMs) || !isRecord(raw.zones)) return null
  const zones: Record<string, ZoneSnapshot> = {}
  for (const [id, z] of Object.entries(raw.zones)) {
    if (!isRecord(z)) return null
    const past = z.past === null ? null : isWindowSum(z.past) ? z.past : undefined
    const forecast = z.forecast === null ? null : isWindowSum(z.forecast) ? z.forecast : undefined
    if (past === undefined || forecast === undefined) return null
    zones[id] = { past, forecast }
  }
  return { fetchedAtMs: raw.fetchedAtMs, zones }
}

async function readCache(db: D1Like, key: string): Promise<WeatherSnapshot | null> {
  try {
    const row = await db.prepare('SELECT payload FROM weather_cache WHERE cache_key = ?').bind(key).first<{ payload: unknown }>()
    if (!row || typeof row.payload !== 'string') return null
    return parseSnapshot(JSON.parse(row.payload))
  } catch (err) {
    console.error('[api] weather: cache read failed:', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

async function writeCache(db: D1Like, key: string, snapshot: WeatherSnapshot): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO weather_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .bind(key, JSON.stringify(snapshot), new Date(snapshot.fetchedAtMs).toISOString())
      .run()
  } catch (err) {
    console.error('[api] weather: cache write failed:', err instanceof Error ? err.message : 'unknown')
  }
}

// ---- response building --------------------------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString()

function toWindow(w: WindowSum, hours: number): WeatherWindow {
  return { start: iso(w.startMs), end: iso(w.endMs), hours }
}

function pastOf(w: WindowSum | null): PastPrecipitation {
  return w
    ? { kind: PAST_KIND, status: 'available', totalMm: w.totalMm, unit: WEATHER_UNIT, window: toWindow(w, WEATHER_PAST_HOURS) }
    : { kind: PAST_KIND, status: 'unavailable', totalMm: null, unit: WEATHER_UNIT, window: null }
}

function forecastOf(w: WindowSum | null): ForecastPrecipitation {
  return w
    ? { kind: FORECAST_KIND, status: 'available', totalMm: w.totalMm, unit: WEATHER_UNIT, window: toWindow(w, WEATHER_FORECAST_HOURS) }
    : { kind: FORECAST_KIND, status: 'unavailable', totalMm: null, unit: WEATHER_UNIT, window: null }
}

function buildResponse(
  locations: readonly ZoneLocation[],
  snapshot: WeatherSnapshot | null,
  nowMs: number,
  cache: WeatherCacheState,
  provider: ProviderStatus,
): WeatherResponse {
  const ageMs = snapshot ? Math.max(0, nowMs - snapshot.fetchedAtMs) : null
  const dataStatus: WeatherStatus = ageMs === null ? 'unavailable' : ageMs <= FRESH_SECONDS * 1000 ? 'live' : 'stale'

  const zones: ZoneWeather[] = locations.map((loc) => {
    const snap = snapshot?.zones[loc.id]
    const past = pastOf(snap?.past ?? null)
    const forecast = forecastOf(snap?.forecast ?? null)
    const usable = past.status === 'available' || forecast.status === 'available'
    return {
      id: loc.id,
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      status: usable ? dataStatus : 'unavailable',
      past,
      forecast,
    }
  })

  const anyUsable = zones.some((z) => z.status !== 'unavailable')
  const complete = zones.every((z) => z.past.status === 'available' && z.forecast.status === 'available')
  const status: WeatherStatus = anyUsable ? dataStatus : 'unavailable'

  return {
    data: { zones },
    meta: {
      status,
      partial: anyUsable && !complete,
      count: zones.length,
      provider: { name: 'Open-Meteo', endpoint: 'forecast', model: 'best_match', status: provider },
      retrievedAt: anyUsable && snapshot ? iso(snapshot.fetchedAtMs) : null,
      ageSeconds: anyUsable && ageMs !== null ? Math.round(ageMs / 1000) : null,
      cache: anyUsable ? cache : 'none',
      freshSeconds: FRESH_SECONDS,
      maxStaleSeconds: MAX_STALE_SECONDS,
      unit: WEATHER_UNIT,
      notice: WEATHER_NOTICE,
    },
  }
}

// ---- orchestration ------------------------------------------------------------------------------------------------

/**
 * Returns weather for every zone in D1. Provider trouble never throws: it yields `stale` or `unavailable` data.
 * Only a database failure while reading the zones themselves propagates (DatabaseError / StoredDataError).
 */
export async function getWeather(env: Env, deps: WeatherDeps): Promise<WeatherResponse> {
  const locations = await loadZoneLocations(env.DB)
  const nowMs = deps.now()
  if (locations.length === 0) return buildResponse(locations, null, nowMs, 'none', 'not_attempted')

  const key = cacheKey(locations)
  let cached = await readCache(env.DB, key)
  if (cached && cached.fetchedAtMs - nowMs > MAX_CLOCK_SKEW_MS) cached = null // stamped in the future: do not trust

  const ageMs = cached ? Math.max(0, nowMs - cached.fetchedAtMs) : null
  if (cached && ageMs !== null && ageMs <= FRESH_SECONDS * 1000) {
    return buildResponse(locations, cached, nowMs, 'cache_fresh', 'not_attempted')
  }

  let providerStatus: ProviderStatus
  if (lastFailure && lastFailure.key === key && nowMs - lastFailure.atMs >= 0 && nowMs - lastFailure.atMs < FAILURE_COOLDOWN_MS) {
    providerStatus = lastFailure.status // recently failed: do not call the provider again yet
  } else {
    try {
      const fresh = await fetchOpenMeteo(locations, deps.fetch, nowMs, deps.timeoutMs)
      if (Object.keys(fresh.zones).length === 0) throw new ProviderError('invalid_response', 'no usable zone in response')
      lastFailure = null
      await writeCache(env.DB, key, fresh)
      return buildResponse(locations, fresh, nowMs, 'refreshed', 'ok')
    } catch (err) {
      providerStatus = err instanceof ProviderError ? err.kind : 'network_error'
      console.error('[api] weather: provider failed:', providerStatus, err instanceof Error ? err.message : 'unknown')
      lastFailure = { key, atMs: nowMs, status: providerStatus }
    }
  }

  if (cached && ageMs !== null && ageMs <= MAX_STALE_SECONDS * 1000) {
    return buildResponse(locations, cached, nowMs, 'cache_stale', providerStatus)
  }
  return buildResponse(locations, null, nowMs, 'none', providerStatus)
}
