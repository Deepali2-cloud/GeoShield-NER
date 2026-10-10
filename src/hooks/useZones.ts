import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchZones } from '../api/zonesApi'
import type { ZonesData } from '../api/zonesApi'

export type ZonesState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; data: ZonesData }

/** Loads zones from the API. `reload` is the retry action for the error state. */
export function useZones(): { state: ZonesState; reload: () => void } {
  const [state, setState] = useState<ZonesState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchZones(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', error: err instanceof ApiError ? err : new ApiError('network', 'Could not load zones.') })
      })
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((a) => a + 1)
  }, [])

  return { state, reload }
}
