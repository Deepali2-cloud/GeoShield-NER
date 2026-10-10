import { DEMO_ZONES } from '../../src/data/demoZones'
import { MODEL_VERSION } from '../../src/risk/config'
import { assessZone } from '../../src/risk/zoneRisk'
import type { Zone } from '../../src/types'
import { INPUT_KEYS } from '../../src/types/api'
import type { ApiZone, ZonesResponse } from '../../src/types/api'
import type { WeatherMeta, WeatherResponse, WeatherStatus, ZoneWeather } from '../../src/types/weather'

/** Builds the JSON `GET /api/zones` would return for the given zones, using the shared Phase 3 engine. */
export function apiZone(zone: Zone): ApiZone {
  const a = assessZone(zone)
  return {
    id: zone.id,
    name: zone.name,
    state: zone.state,
    latitude: zone.latitude,
    longitude: zone.longitude,
    origin: 'demo_seed',
    inputs: Object.fromEntries(
      INPUT_KEYS.map((k) => [k, { value: Number.isFinite(zone.inputs[k].value) ? zone.inputs[k].value : null, source: zone.inputs[k].source }]),
    ) as ApiZone['inputs'],
    assessment: a.ok ? { ok: true, result: a.result } : { ok: false, errors: a.errors },
  }
}

export function zonesPayload(zones: Zone[] = DEMO_ZONES): ZonesResponse {
  return {
    data: { zones: zones.map(apiZone) },
    meta: {
      count: zones.length,
      demoData: true,
      modelVersion: MODEL_VERSION,
      notice: 'All inputs are illustrative demo data. Not measured, not live weather, not a validated prediction.',
    },
  }
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ---- weather fixtures -------------------------------------------------------------------------------------------

const H = 3_600_000
/** A fixed "retrieval hour" so windows in tests are deterministic. */
export const WEATHER_FLOOR_MS = Date.UTC(2026, 9, 10, 3, 0, 0)

/** Distinct, recognisable numbers per zone so a mix-up between zones (or past/forecast) cannot go unnoticed. */
export const WEATHER_VALUES: Record<string, { past: number; forecast: number }> = {
  guwahati: { past: 11.1, forecast: 1.1 },
  itanagar: { past: 22.2, forecast: 2.2 },
  kohima: { past: 33.3, forecast: 3.3 },
  shillong: { past: 44.4, forecast: 4.4 },
  aizawl: { past: 55.5, forecast: 5.5 },
  gangtok: { past: 66.6, forecast: 6.6 },
}

export function zoneWeather(zone: Zone, status: WeatherStatus = 'live'): ZoneWeather {
  const v = WEATHER_VALUES[zone.id]
  return {
    id: zone.id,
    name: zone.name,
    latitude: zone.latitude,
    longitude: zone.longitude,
    status,
    past: {
      kind: 'model_derived_recent',
      status: 'available',
      totalMm: v.past,
      unit: 'mm',
      window: { start: new Date(WEATHER_FLOOR_MS - 72 * H).toISOString(), end: new Date(WEATHER_FLOOR_MS).toISOString(), hours: 72 },
    },
    forecast: {
      kind: 'forecast',
      status: 'available',
      totalMm: v.forecast,
      unit: 'mm',
      window: { start: new Date(WEATHER_FLOOR_MS).toISOString(), end: new Date(WEATHER_FLOOR_MS + 24 * H).toISOString(), hours: 24 },
    },
  }
}

export const unavailableZoneWeather = (zone: Zone): ZoneWeather => ({
  id: zone.id,
  name: zone.name,
  latitude: zone.latitude,
  longitude: zone.longitude,
  status: 'unavailable',
  past: { kind: 'model_derived_recent', status: 'unavailable', totalMm: null, unit: 'mm', window: null },
  forecast: { kind: 'forecast', status: 'unavailable', totalMm: null, unit: 'mm', window: null },
})

export function weatherPayload(status: WeatherStatus = 'live', zones: Zone[] = DEMO_ZONES, metaOverrides: Partial<WeatherMeta> = {}): WeatherResponse {
  const unavailable = status === 'unavailable'
  const list = zones.map((z) => (unavailable ? unavailableZoneWeather(z) : zoneWeather(z, status)))
  return {
    data: { zones: list },
    meta: {
      status,
      partial: false,
      count: list.length,
      provider: { name: 'Open-Meteo', endpoint: 'forecast', model: 'best_match', status: status === 'live' ? 'ok' : 'timeout' },
      retrievedAt: unavailable ? null : new Date(WEATHER_FLOOR_MS).toISOString(),
      ageSeconds: unavailable ? null : status === 'stale' ? 7200 : 120,
      cache: unavailable ? 'none' : status === 'stale' ? 'cache_stale' : 'refreshed',
      freshSeconds: 1800,
      maxStaleSeconds: 21600,
      unit: 'mm',
      notice: 'Past-72h values are model-derived recent precipitation from Open-Meteo, not rain-gauge observations.',
      ...metaOverrides,
    },
  }
}

export const isWeatherUrl = (url: string) => url.endsWith('/api/weather')
export const isAlertsUrl = (url: string) => url.includes('/api/alerts')
export const isPredsUrl = (url: string) => url.includes('/api/predictions')
export const isReportsUrl = (url: string) => url.includes('/api/reports')

/** Returns stub responses for the Phase 6 and 7 endpoints so existing tests that call mockImplementation don't break. */
export const stubApiResponse = (url: string) => {
  if (isAlertsUrl(url)) return jsonResponse({ data: { alerts: [] } })
  if (isPredsUrl(url)) return jsonResponse({ data: { predictions: [] } })
  if (isReportsUrl(url)) return jsonResponse({ data: { reports: [] } })
  return null
}

/**
 * Replaces global fetch for one test. Pair with `vi.unstubAllGlobals()` in afterEach.
 * `GET /api/weather` is answered by `options.weather` (default: a valid live payload) so the Phase 4 zone tests,
 * whose handlers only know about zones, are not disturbed by the Phase 5 weather request.
 */
export function stubFetch(
  handler: (url: string) => Promise<Response> | Response,
  options: {
    weather?: () => Promise<Response> | Response
    reports?: () => Promise<Response> | Response
  } = {},
) {
  const weather = options.weather ?? (() => jsonResponse(weatherPayload()))
  const reports = options.reports ?? (() => jsonResponse({ data: { reports: [] } }))
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST') return Promise.resolve(handler(url))
    if (isWeatherUrl(url)) return Promise.resolve(weather())
    if (url.includes('/api/alerts')) return Promise.resolve(jsonResponse({ data: { alerts: [] } }))
    if (url.includes('/api/predictions')) return Promise.resolve(jsonResponse({ data: { predictions: [] } }))
    if (url.includes('/api/reports')) return Promise.resolve(reports())
    if (url.includes('/api/admin/session')) return Promise.resolve(jsonResponse({ error: { code: 'unauthorized', message: 'Not authenticated' } }, 401))
    if (url.includes('/api/admin/reports')) return Promise.resolve(jsonResponse({ data: { reports: [] } }))
    return Promise.resolve(handler(url))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

export const stubZonesApi = () => stubFetch(() => jsonResponse(zonesPayload()))
