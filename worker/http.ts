import type { ApiErrorCode, ErrorResponse } from '../src/types/api'

/** Fixed, public-safe messages. Internal details (SQL, stack traces, paths, config) never reach a response. */
const MESSAGES: Record<ApiErrorCode, string> = {
  not_found: 'Route not found.',
  method_not_allowed: 'Method not allowed.',
  database_unavailable: 'The database is currently unavailable.',
  invalid_stored_data: 'Stored data failed validation.',
  internal_error: 'An unexpected error occurred.',
  bad_request: 'Bad request.',
  unsupported_media_type: 'Unsupported media type.',
  unauthorized: 'Authentication required.',
  forbidden: 'Access forbidden.',
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extraHeaders } })
}

export function errorResponse(status: number, code: ApiErrorCode, extraHeaders: Record<string, string> = {}, customMessage?: string): Response {
  const body: ErrorResponse = { error: { code, message: customMessage ?? MESSAGES[code] } }
  return json(body, status, extraHeaders)
}
