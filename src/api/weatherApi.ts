import { ApiError, API_BASE_URL } from './zonesApi'
import { PAST_KIND, FORECAST_KIND, WEATHER_UNIT } from '../types/weather'
import type {
  ForecastPrecipitation,
  PastPrecipitation,
  ProviderStatus,
  WeatherCacheState,
  WeatherMeta,
  WeatherResponse,
  WeatherStatus,
  WeatherWindow,
  ZoneWeather,
} from '../types/weather'

/** The browser gives up on a slow weather request after this long. Zones and the map never wait for it. */
export const WEATHER_CLIENT_TIMEOUT_MS = 15_000

const STATUSES: readonly string[] = ['live', 'stale', 'unavailable']
const PROVIDER_STATUSES: readonly string[] = ['ok', 'timeout', 'rate_limited', 'http_error', 'network_error', 'invalid_response', 'not_attempted']
const CACHE_STATES: readonly string[] = ['refreshed', 'cache_fresh', 'cache_stale', 'none']

const invalid = (why: string) => new ApiError('invalid-response', `The server returned weather data in an unexpected format (${why}).`)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isIso = (v: unknown): v is string => isStr(v) && Number.isFinite(Date.parse(v))

function parseWindow(v: unknown, hours: number, what: string): WeatherWindow {
  if (!isRecord(v) || !isIso(v.start) || !isIso(v.end) || v.hours !== hours) throw invalid(`${what} window`)
  if (Date.parse(v.end) <= Date.parse(v.start)) throw invalid(`${what} window order`)
  return { start: v.start, end: v.end, hours }
}

/** A part is either fully available (finite non-negative mm + window) or fully unavailable (no mm, no window). */
function parsePart<K extends typeof PAST_KIND | typeof FORECAST_KIND>(
  v: unknown,
  kind: K,
  hours: number,
  what: string,
): { kind: K; status: 'available' | 'unavailable'; totalMm: number | null; unit: typeof WEATHER_UNIT; window: WeatherWindow | null } {
  if (!isRecord(v) || v.kind !== kind || v.unit !== WEATHER_UNIT) throw invalid(`${what} kind or unit`)
  if (v.status === 'available') {
    if (!isNum(v.totalMm) || v.totalMm < 0) throw invalid(`${what} total`)
    return { kind, status: 'available', totalMm: v.totalMm, unit: WEATHER_UNIT, window: parseWindow(v.window, hours, what) }
  }
  if (v.status === 'unavailable') {
    if (v.totalMm !== null || v.window !== null) throw invalid(`${what} unavailable but has values`)
    return { kind, status: 'unavailable', totalMm: null, unit: WEATHER_UNIT, window: null }
  }
  throw invalid(`${what} status`)
}

function parseZone(v: unknown): ZoneWeather {
  if (!isRecord(v) || !isStr(v.id) || !isStr(v.name) || !isNum(v.latitude) || !isNum(v.longitude)) throw invalid('zone identity')
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status)) throw invalid(`${v.id}: status`)
  const past = parsePart(v.past, PAST_KIND, 72, `${v.id}.past`) as PastPrecipitation
  const forecast = parsePart(v.forecast, FORECAST_KIND, 24, `${v.id}.forecast`) as ForecastPrecipitation
  const usable = past.status === 'available' || forecast.status === 'available'
  // A zone cannot claim live/stale data while having none, nor be "unavailable" while holding values.
  if (usable === (v.status === 'unavailable')) throw invalid(`${v.id}: status contradicts values`)
  return { id: v.id, name: v.name, latitude: v.latitude, longitude: v.longitude, status: v.status as WeatherStatus, past, forecast }
}

function parseMeta(v: unknown): WeatherMeta {
  if (!isRecord(v)) throw invalid('missing meta')
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status)) throw invalid('meta.status')
  if (typeof v.partial !== 'boolean' || !isNum(v.count)) throw invalid('meta fields')
  if (!isRecord(v.provider) || v.provider.name !== 'Open-Meteo' || v.provider.endpoint !== 'forecast' || v.provider.model !== 'best_match') {
    throw invalid('meta.provider')
  }
  if (typeof v.provider.status !== 'string' || !PROVIDER_STATUSES.includes(v.provider.status)) throw invalid('meta.provider.status')
  if (typeof v.cache !== 'string' || !CACHE_STATES.includes(v.cache)) throw invalid('meta.cache')
  if (!isNum(v.freshSeconds) || !isNum(v.maxStaleSeconds) || v.unit !== WEATHER_UNIT || typeof v.notice !== 'string') throw invalid('meta fields')
  const hasData = v.status !== 'unavailable'
  if (hasData && (!isIso(v.retrievedAt) || !isNum(v.ageSeconds) || v.ageSeconds < 0)) throw invalid('meta retrieval time')
  if (!hasData && (v.retrievedAt !== null || v.ageSeconds !== null)) throw invalid('unavailable weather has a retrieval time')
  return {
    status: v.status as WeatherStatus,
    partial: v.partial,
    count: v.count,
    provider: { name: 'Open-Meteo', endpoint: 'forecast', model: 'best_match', status: v.provider.status as ProviderStatus },
    retrievedAt: hasData ? (v.retrievedAt as string) : null,
    ageSeconds: hasData ? (v.ageSeconds as number) : null,
    cache: v.cache as WeatherCacheState,
    freshSeconds: v.freshSeconds,
    maxStaleSeconds: v.maxStaleSeconds,
    unit: WEATHER_UNIT,
    notice: v.notice,
  }
}

/** Validates an untrusted JSON body from `GET /api/weather`. Throws `ApiError('invalid-response')`. */
export function parseWeatherResponse(json: unknown): WeatherResponse {
  if (!isRecord(json) || !isRecord(json.data) || !Array.isArray(json.data.zones)) throw invalid('missing data.zones')
  const meta = parseMeta(json.meta)
  const zones: ZoneWeather[] = []
  const seen = new Set<string>()
  for (const item of json.data.zones) {
    const z = parseZone(item)
    if (seen.has(z.id)) throw invalid(`duplicate zone id ${z.id}`)
    seen.add(z.id)
    zones.push(z)
  }
  if (meta.count !== zones.length) throw invalid('meta.count does not match zones')
  const anyUsable = zones.some((z) => z.status !== 'unavailable')
  if (meta.status === 'unavailable' ? anyUsable : !anyUsable) throw invalid('meta.status contradicts zones')
  if (meta.status !== 'unavailable' && zones.some((z) => z.status !== 'unavailable' && z.status !== meta.status)) throw invalid('zone status differs from meta')
  return { data: { zones }, meta }
}

/** Fetches weather from the Worker. Never substitutes values on failure. Aborts itself after `timeoutMs`. */
export async function fetchWeather(
  signal?: AbortSignal,
  baseUrl: string = API_BASE_URL,
  timeoutMs: number = WEATHER_CLIENT_TIMEOUT_MS,
): Promise<WeatherResponse> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      res = await fetch(`${baseUrl}/api/weather`, { signal: controller.signal, headers: { accept: 'application/json' } })
    } catch (err) {
      if (signal?.aborted) throw err
      if (timedOut) throw new ApiError('network', 'The weather request took too long. Try again.')
      throw new ApiError('network', 'Could not reach the weather service. Check your connection.')
    }
    if (!res.ok) {
      let message = `The weather endpoint responded with an error (HTTP ${res.status}).`
      try {
        const body: unknown = await res.json()
        const e = isRecord(body) && isRecord(body.error) ? body.error.message : undefined
        if (typeof e === 'string' && e.length > 0 && e.length < 200) message = `${e} (HTTP ${res.status})`
      } catch {
        /* body was not JSON; keep the generic message */
      }
      throw new ApiError('http', message, res.status)
    }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      if (timedOut) throw new ApiError('network', 'The weather request took too long. Try again.')
      throw invalid('response was not JSON')
    }
    return parseWeatherResponse(json)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
