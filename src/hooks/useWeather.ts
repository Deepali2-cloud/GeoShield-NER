import { useCallback, useEffect, useState } from 'react'
import { fetchWeather } from '../api/weatherApi'
import { ApiError } from '../api/zonesApi'
import type { WeatherResponse } from '../types/weather'

export type WeatherState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; data: WeatherResponse }

/**
 * Loads weather once per mount (not per render) and again only when `reload` is called.
 * It is independent of the zones request: a weather failure never blocks the map, list or selection.
 */
export function useWeather(): { state: WeatherState; reload: () => void } {
  const [state, setState] = useState<WeatherState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchWeather(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', error: err instanceof ApiError ? err : new ApiError('network', 'Could not load weather.') })
      })
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((a) => a + 1)
  }, [])

  return { state, reload }
}
