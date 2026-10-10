import type { RiskResult } from '../risk/engine'
import type { DataSource } from './index'

/**
 * HTTP API contract shared by the Worker (producer) and the frontend (consumer).
 * Types only: no runtime code, so it is safe to import from either side.
 */

/** Raw input names, identical to the keys of `ZoneInputs`. */
export const INPUT_KEYS = ['rainfall72hMm', 'slopeDeg', 'elevationM', 'soilScore', 'historicalScore'] as const
export type InputKey = (typeof INPUT_KEYS)[number]

/** Where a stored row came from. `demo_seed` rows are owned by the seed script; `user` rows are never overwritten by it. */
export type RecordOrigin = 'demo_seed' | 'user'

/**
 * One input as stored. `value` / `source` are null when the stored value is missing or not a finite
 * number / known source; in that case the zone's `assessment.ok` is false and no score exists.
 */
export interface ApiInputValue {
  value: number | null
  source: DataSource | null
}

/** Same shape as the frontend's `ZoneAssessment`: a score is present only when `ok` is true. */
export type ApiAssessment = { ok: true; result: RiskResult } | { ok: false; errors: string[] }

export interface ApiZone {
  id: string
  name: string
  state: string
  latitude: number
  longitude: number
  origin: RecordOrigin
  inputs: Record<InputKey, ApiInputValue>
  assessment: ApiAssessment
}

export interface ZonesMeta {
  /** Number of zones in `data.zones`. */
  count: number
  /** True only when every input of every returned zone has source `demo`. */
  demoData: boolean
  /** Version of the Phase 3 rule-based model that produced the scores. */
  modelVersion: string
  notice: string
}

export interface ZonesResponse {
  data: { zones: ApiZone[] }
  meta: ZonesMeta
}

export interface HealthResponse {
  data: {
    status: 'ok' | 'degraded'
    service: 'geoshield-ner-api'
    database: 'ok' | 'unavailable'
  }
}

export type ApiErrorCode =
  | 'not_found'
  | 'method_not_allowed'
  | 'database_unavailable'
  | 'invalid_stored_data'
  | 'internal_error'
  | 'bad_request'
  | 'unsupported_media_type'
  | 'unauthorized'
  | 'forbidden'

/** Every non-2xx response from the Worker has exactly this shape. Messages are fixed strings, never internal details. */
export interface ErrorResponse {
  error: { code: ApiErrorCode; message: string }
}

export interface ApiPrediction {
  id: string
  zoneId: string
  riskScore: number
  riskLevel: import('./index').RiskLevel
  createdAt: string
  inputProvenance: string
}

export interface PredictionsResponse {
  data: { predictions: ApiPrediction[] }
}

export interface ApiAlert {
  id: string
  zoneId: string
  riskScore: number
  riskLevel: import('./index').RiskLevel
  createdAt: string
  isRead: boolean
  message: string
  inputProvenance: string
}

export interface AlertsResponse {
  data: { alerts: ApiAlert[] }
}

export const REPORT_CATEGORIES = [
  'Landslide',
  'Cracks in ground or road',
  'Rockfall',
  'Blocked road',
  'Heavy rainfall or waterlogging',
  'Other hazard',
] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export const REPORT_STATUSES = ['pending', 'reviewed', 'resolved', 'rejected'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export interface ApiReport {
  id: string
  zoneId: string
  category: ReportCategory
  title: string
  description: string
  latitude: number | null
  longitude: number | null
  status: ReportStatus
  createdAt: string
  updatedAt: string
}

export interface CreateReportInput {
  zoneId: string
  category: string
  title: string
  description: string
  latitude?: number | null
  longitude?: number | null
}

export interface ReportsResponse {
  data: { reports: ApiReport[] }
}

export interface CreateReportResponse {
  data: { report: ApiReport }
}

export interface AdminSessionData {
  authenticated: boolean
  adminId: string
}

export interface AdminSessionResponse {
  data: AdminSessionData
}

export const MODERATION_STATUSES = ['reviewed', 'resolved', 'rejected'] as const
export type ModerationStatus = (typeof MODERATION_STATUSES)[number]

export interface UpdateReportStatusInput {
  status: ModerationStatus
}

export interface ModerationAuditRecord {
  id: string
  reportId: string
  previousStatus: ReportStatus
  newStatus: ReportStatus
  adminId: string
  createdAt: string
}

export interface UpdateReportStatusResponse {
  data: {
    report: ApiReport
    audit: ModerationAuditRecord
  }
}
