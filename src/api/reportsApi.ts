import type { ApiReport, CreateReportInput, CreateReportResponse, ReportsResponse } from '../types/api'
import { ApiError } from './zonesApi'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { accept: 'application/json', ...init?.headers } })
  } catch {
    throw new ApiError('network', 'Could not reach the API. Check that the Worker is running.')
  }
  if (!res.ok) {
    let message = `The API responded with an error (HTTP ${res.status}).`
    try {
      const body: unknown = await res.json()
      const e = isRecord(body) && isRecord(body.error) ? body.error?.message : undefined
      if (typeof e === 'string' && e.length > 0 && e.length < 200) message = `${e}`
    } catch {
      /* ignore */
    }
    throw new ApiError('http', message, res.status)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('invalid-response', 'Response was not valid JSON.')
  }
}

export interface ReportFilters {
  zoneId?: string
  status?: string
  category?: string
  limit?: number
}

export async function fetchReports(filters?: ReportFilters, signal?: AbortSignal): Promise<ApiReport[]> {
  const params = new URLSearchParams()
  if (filters?.zoneId) params.set('zoneId', filters.zoneId)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.category) params.set('category', filters.category)
  if (filters?.limit) params.set('limit', String(filters.limit))

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/reports${queryString ? `?${queryString}` : ''}`
  const data = await fetchJson<ReportsResponse>(url, { signal })
  return data.data.reports
}

export async function createReport(input: CreateReportInput): Promise<ApiReport> {
  const data = await fetchJson<CreateReportResponse>(`${API_BASE_URL}/api/reports`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return data.data.report
}
