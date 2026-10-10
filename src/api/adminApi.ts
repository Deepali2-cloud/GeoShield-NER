import type {
  AdminSessionData,
  AdminSessionResponse,
  ApiReport,
  ModerationStatus,
  ReportsResponse,
  UpdateReportStatusResponse,
} from '../types/api'
import { ApiError } from './zonesApi'
import type { ReportFilters } from './reportsApi'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

async function fetchAdminJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError('network', 'Could not reach the API. Check that the Worker is running.')
  }

  if (!res.ok) {
    let message = `The API responded with an error (HTTP ${res.status}).`
    try {
      const body: unknown = await res.json()
      const e = isRecord(body) && isRecord(body.error) ? body.error?.message : undefined
      if (typeof e === 'string' && e.length > 0 && e.length < 200) message = e
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

export async function checkAdminSession(): Promise<AdminSessionData> {
  const data = await fetchAdminJson<AdminSessionResponse>(`${API_BASE_URL}/api/admin/session`)
  return data.data
}

export async function loginAdmin(password: string): Promise<AdminSessionData> {
  const data = await fetchAdminJson<AdminSessionResponse>(`${API_BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  return data.data
}

export async function logoutAdmin(): Promise<void> {
  await fetchAdminJson<{ data: { success: boolean } }>(`${API_BASE_URL}/api/admin/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

export async function fetchAdminReports(filters?: ReportFilters, signal?: AbortSignal): Promise<ApiReport[]> {
  const params = new URLSearchParams()
  if (filters?.zoneId) params.set('zoneId', filters.zoneId)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.category) params.set('category', filters.category)
  if (filters?.limit) params.set('limit', String(filters.limit))

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/admin/reports${queryString ? `?${queryString}` : ''}`
  const data = await fetchAdminJson<ReportsResponse>(url, { signal })
  return data.data.reports
}

export async function updateReportStatus(
  reportId: string,
  status: ModerationStatus
): Promise<UpdateReportStatusResponse['data']> {
  const data = await fetchAdminJson<UpdateReportStatusResponse>(
    `${API_BASE_URL}/api/admin/reports/${encodeURIComponent(reportId)}/status`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  )
  return data.data
}
