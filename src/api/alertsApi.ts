import type { ApiAlert, ApiPrediction, AlertsResponse, PredictionsResponse } from '../types/api'
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
      if (typeof e === 'string' && e.length > 0 && e.length < 200) message = `${e} (HTTP ${res.status})`
    } catch {
      /* ignore */
    }
    throw new ApiError('http', message, res.status)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('invalid-response', 'response was not JSON')
  }
}

export async function fetchAlerts(unreadOnly: boolean = false): Promise<ApiAlert[]> {
  const data = await fetchJson<AlertsResponse>(`${API_BASE_URL}/api/alerts?unreadOnly=${unreadOnly}`)
  return data.data.alerts
}

export async function markAlertRead(id: string): Promise<void> {
  await fetchJson<{ success: boolean }>(`${API_BASE_URL}/api/alerts/${id}/read`, { method: 'PATCH' })
}

export async function fetchPredictions(zoneId?: string, limit: number = 50): Promise<ApiPrediction[]> {
  let url = `${API_BASE_URL}/api/predictions?limit=${limit}`
  if (zoneId) {
    url += `&zoneId=${zoneId}`
  }
  const data = await fetchJson<PredictionsResponse>(url)
  return data.data.predictions
}
