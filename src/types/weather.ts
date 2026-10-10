/**
 * HTTP contract for `GET /api/weather`, shared by the Worker (producer) and the frontend (consumer).
 * Types and constants only, so it is safe to import from either side.
 *
 * Temporal meaning (also documented in the README):
 * - `past`     : precipitation in the 72 hours up to the retrieval hour, as returned by Open-Meteo's forecast
 *                endpoint (`past_hours`). This is MODEL-DERIVED data (archived model analysis/short-range
 *                forecasts), NOT a rain-gauge observation. It is kept separate from `forecast`.
 * - `forecast` : precipitation forecast for the 24 hours AFTER the retrieval hour. A forecast, never an observation.
 */

export const WEATHER_PAST_HOURS = 72
export const WEATHER_FORECAST_HOURS = 24
export const WEATHER_UNIT = 'mm'

/** Freshness of data, as measured by the Worker's clock against the time the provider was queried. */
export type WeatherStatus = 'live' | 'stale' | 'unavailable'

/** Outcome of the most recent attempt to reach the provider. */
export type ProviderStatus =
  | 'ok'
  | 'timeout'
  | 'rate_limited'
  | 'http_error'
  | 'network_error'
  | 'invalid_response'
  | 'not_attempted'

/** Where the answer in this response came from. */
export type WeatherCacheState = 'refreshed' | 'cache_fresh' | 'cache_stale' | 'none'

export const PAST_KIND = 'model_derived_recent' as const
export const FORECAST_KIND = 'forecast' as const

export interface WeatherWindow {
  /** ISO-8601 UTC. Precipitation at hour-stamp T is the sum over (T-1h, T], so the window covers (start, end]. */
  start: string
  end: string
  hours: number
}

export interface PastPrecipitation {
  kind: typeof PAST_KIND
  status: 'available' | 'unavailable'
  /** Sum over the window, mm. null whenever any hour of the window is missing: partial sums are never reported. */
  totalMm: number | null
  unit: typeof WEATHER_UNIT
  window: WeatherWindow | null
}

export interface ForecastPrecipitation {
  kind: typeof FORECAST_KIND
  status: 'available' | 'unavailable'
  totalMm: number | null
  unit: typeof WEATHER_UNIT
  window: WeatherWindow | null
}

export interface ZoneWeather {
  id: string
  name: string
  latitude: number
  longitude: number
  /** `unavailable` when neither part could be used. */
  status: WeatherStatus
  past: PastPrecipitation
  forecast: ForecastPrecipitation
}

export interface WeatherMeta {
  /** Overall status. `live` = refreshed within the freshness window. `stale` = older, shown with its age. */
  status: WeatherStatus
  /** True when some, but not all, zones (or parts) have usable data. */
  partial: boolean
  count: number
  provider: {
    name: 'Open-Meteo'
    endpoint: 'forecast'
    /** Open-Meteo "best match" model selection (the API default). */
    model: 'best_match'
    /** Result of the latest attempt to reach the provider (not necessarily this response's data). */
    status: ProviderStatus
  }
  /** When the Worker queried the provider for the data in this response (ISO UTC). null when unavailable. */
  retrievedAt: string | null
  /** Age of the data at response time, seconds. null when unavailable. */
  ageSeconds: number | null
  cache: WeatherCacheState
  freshSeconds: number
  maxStaleSeconds: number
  unit: typeof WEATHER_UNIT
  notice: string
}

export interface WeatherResponse {
  data: { zones: ZoneWeather[] }
  meta: WeatherMeta
}
