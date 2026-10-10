import { useCallback, useEffect, useState } from 'react'
import { fetchAlerts, markAlertRead } from '../api/alertsApi'
import { ApiError } from '../api/zonesApi'
import type { ApiAlert } from '../types/api'

export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: T }

export function useAlerts() {
  const [state, setState] = useState<ApiState<ApiAlert[]>>({ status: 'loading' })
  
  const reload = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const data = await fetchAlerts()
      setState({ status: 'success', data })
    } catch (err) {
      if (err instanceof ApiError) {
        setState({ status: 'error', error: err.message })
      } else {
        setState({ status: 'error', error: 'An unexpected error occurred while fetching alerts.' })
      }
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [reload])
  
  const markRead = async (id: string) => {
    try {
      await markAlertRead(id)
      if (state.status === 'success') {
        setState({
          status: 'success',
          data: state.data.map((alert) => (alert.id === id ? { ...alert, isRead: true } : alert)),
        })
      }
    } catch (err) {
      console.error('Failed to mark alert as read', err)
    }
  }

  return { state, reload, markRead }
}
