import type { Env } from './db'
import { errorResponse, json } from './http'
import {
  authenticateAdminRequest,
  buildClearSessionCookie,
  buildSessionCookie,
  checkLoginRateLimit,
  generateSessionToken,
  isAuthConfigured,
  isRequestSecure,
  parseSessionCookie,
  recordFailedLogin,
  resetLoginAttempts,
  sha256Hex,
  validateOrigin,
  verifyAdminPassword,
} from './auth'
import { MODERATION_STATUSES } from '../src/types/api'
import type { ApiReport, ModerationStatus } from '../src/types/api'
import { listReports } from './reports'

function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '127.0.0.1'
  )
}

export async function adminLogin(env: Env, request: Request): Promise<Response> {
  if (!validateOrigin(request)) {
    return errorResponse(403, 'forbidden', {}, 'Cross-origin request rejected.')
  }

  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return errorResponse(415, 'unsupported_media_type', {}, 'Content-Type must be application/json.')
  }

  if (!isAuthConfigured(env)) {
    console.error('[admin] Authentication failed: ADMIN_PASSWORD or ADMIN_PASSWORD_HASH not configured. Env keys:', Object.keys(env))
    return errorResponse(500, 'internal_error', {}, 'Admin authentication is not configured on this server.')
  }

  const ip = getClientIp(request)
  const rateLimit = checkLoginRateLimit(ip)
  if (!rateLimit.allowed) {
    return errorResponse(
      429,
      'bad_request',
      {},
      `Too many failed login attempts. Please try again in ${rateLimit.remainingSeconds ?? 60} seconds.`
    )
  }

  let body: unknown
  try {
    const text = await request.text()
    body = JSON.parse(text)
  } catch {
    return errorResponse(400, 'bad_request', {}, 'Invalid JSON body.')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'bad_request', {}, 'Request body must be a JSON object.')
  }

  const { password } = body as Record<string, unknown>
  if (typeof password !== 'string' || password.length === 0) {
    return errorResponse(400, 'bad_request', {}, 'Password is required and must be a non-empty string.')
  }

  const isValid = await verifyAdminPassword(env, password)
  if (!isValid) {
    recordFailedLogin(ip)
    return errorResponse(401, 'unauthorized', {}, 'Invalid admin credentials.')
  }

  resetLoginAttempts(ip)

  const token = generateSessionToken()
  const tokenHash = await sha256Hex(token)
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString() // 8 hours

  try {
    await env.DB.prepare(
      'INSERT INTO admin_sessions (session_id_hash, admin_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)'
    )
      .bind(tokenHash, 'admin', createdAt, expiresAt)
      .run()

    const isSecure = isRequestSecure(request)
    const cookieHeader = buildSessionCookie(token, isSecure)

    return json(
      { data: { authenticated: true, adminId: 'admin' } },
      200,
      { 'set-cookie': cookieHeader }
    )
  } catch (err) {
    console.error('[admin] database error creating session:', err)
    return errorResponse(503, 'database_unavailable')
  }
}

export async function adminSessionCheck(env: Env, request: Request): Promise<Response> {
  const admin = await authenticateAdminRequest(env, request)
  if (!admin) {
    return errorResponse(401, 'unauthorized', {}, 'Authentication required.')
  }
  return json({ data: { authenticated: true, adminId: admin.adminId } })
}

export async function adminLogout(env: Env, request: Request): Promise<Response> {
  if (!validateOrigin(request)) {
    return errorResponse(403, 'forbidden', {}, 'Cross-origin request rejected.')
  }

  const token = parseSessionCookie(request.headers.get('cookie'))
  if (token) {
    const tokenHash = await sha256Hex(token)
    const now = new Date().toISOString()
    try {
      await env.DB.prepare(
        'UPDATE admin_sessions SET revoked_at = ? WHERE session_id_hash = ? AND revoked_at IS NULL'
      )
        .bind(now, tokenHash)
        .run()
    } catch (err) {
      console.error('[admin] database error revoking session:', err)
      // Proceed to clear cookie anyway
    }
  }

  const isSecure = isRequestSecure(request)
  const clearCookieHeader = buildClearSessionCookie(isSecure)
  return json({ data: { success: true } }, 200, { 'set-cookie': clearCookieHeader })
}

export async function adminListReports(env: Env, request: Request): Promise<Response> {
  const admin = await authenticateAdminRequest(env, request)
  if (!admin) {
    return errorResponse(401, 'unauthorized', {}, 'Authentication required.')
  }
  return listReports(env, request)
}

export async function adminUpdateReportStatus(env: Env, request: Request, reportId: string): Promise<Response> {
  if (!validateOrigin(request)) {
    return errorResponse(403, 'forbidden', {}, 'Cross-origin request rejected.')
  }

  const admin = await authenticateAdminRequest(env, request)
  if (!admin) {
    return errorResponse(401, 'unauthorized', {}, 'Authentication required.')
  }

  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return errorResponse(415, 'unsupported_media_type', {}, 'Content-Type must be application/json.')
  }

  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return errorResponse(400, 'bad_request', {}, 'Invalid JSON body.')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'bad_request', {}, 'Request body must be a JSON object.')
  }

  const { status } = body as Record<string, unknown>
  if (typeof status !== 'string' || !MODERATION_STATUSES.includes(status as ModerationStatus)) {
    return errorResponse(
      400,
      'bad_request',
      {},
      'Status must be one of: reviewed, resolved, rejected. Reports cannot be returned to pending.'
    )
  }
  const newStatus = status as ModerationStatus

  try {
    const existing = await env.DB.prepare(
      `SELECT id, zone_id as zoneId, category, title, description, latitude, longitude, status, created_at as createdAt, updated_at as updatedAt
       FROM reports WHERE id = ?`
    )
      .bind(reportId)
      .first<ApiReport>()

    if (!existing) {
      return errorResponse(404, 'not_found', {}, 'Report not found.')
    }

    const previousStatus = existing.status
    const now = new Date().toISOString()
    const auditId = crypto.randomUUID()

    const updateStmt = env.DB.prepare(
      'UPDATE reports SET status = ?, updated_at = ? WHERE id = ?'
    ).bind(newStatus, now, reportId)

    const auditStmt = env.DB.prepare(
      'INSERT INTO moderation_audit (id, report_id, previous_status, new_status, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(auditId, reportId, previousStatus, newStatus, admin.adminId, now)

    // Execute atomically
    if (typeof env.DB.batch === 'function') {
      await env.DB.batch([updateStmt, auditStmt])
    } else {
      await updateStmt.run()
      await auditStmt.run()
    }

    const updatedReport: ApiReport = {
      ...existing,
      status: newStatus,
      updatedAt: now,
    }

    return json({
      data: {
        report: updatedReport,
        audit: {
          id: auditId,
          reportId,
          previousStatus,
          newStatus,
          adminId: admin.adminId,
          createdAt: now,
        },
      },
    })
  } catch (err) {
    console.error('[admin] database error updating report status:', err)
    return errorResponse(503, 'database_unavailable')
  }
}
