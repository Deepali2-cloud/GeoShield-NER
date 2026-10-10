import { useCallback, useEffect, useState } from 'react'
import { fetchPredictions } from '../api/alertsApi'
import { ApiError } from '../api/zonesApi'
import type { ApiPrediction } from '../types/api'

export type ApiState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: T }

export function usePredictions(zoneId: string | null) {
  const [state, setState] = useState<ApiState<ApiPrediction[]>>({ status: 'idle' })
  
  const load = useCallback(async (id: string) => {
    setState({ status: 'loading' })
    try {
      const data = await fetchPredictions(id)
      setState({ status: 'success', data })
    } catch (err) {
      if (err instanceof ApiError) {
        setState({ status: 'error', error: err.message })
      } else {
        setState({ status: 'error', error: 'An unexpected error occurred while fetching history.' })
      }
    }
  }, [])

  useEffect(() => {
    if (zoneId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load(zoneId)
    } else {
      setState({ status: 'idle' })
    }
  }, [zoneId, load])

  return { state, load }
}
