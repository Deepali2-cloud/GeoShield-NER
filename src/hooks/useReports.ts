import { useCallback, useEffect, useState } from 'react'
import { fetchReports } from '../api/reportsApi'
import type { ReportFilters } from '../api/reportsApi'
import { ApiError } from '../api/zonesApi'
import type { ApiReport } from '../types/api'

export type ReportsState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: ApiReport[] }

export function useReports(initialFilters: ReportFilters = {}) {
  const [filters, setFilters] = useState<ReportFilters>(initialFilters)
  const [state, setState] = useState<ReportsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchReports(filters, controller.signal)
      .then((data) => {
        setState({ status: 'success', data })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof ApiError) {
          setState({ status: 'error', error: err.message })
        } else {
          setState({ status: 'error', error: 'An unexpected error occurred while fetching reports.' })
        }
      })

    return () => {
      controller.abort()
    }
  }, [filters, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((a) => a + 1)
  }, [])

  return { state, reload, filters, setFilters }
}
