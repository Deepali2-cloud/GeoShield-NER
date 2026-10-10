import type { HealthResponse } from '../src/types/api'
import type { Env } from './db'
import { errorResponse, json } from './http'
import { DatabaseError, StoredDataError, buildZonesResponse, checkDatabase, loadZones } from './zones'
import { defaultWeatherDeps, getWeather } from './weather'
import type { WeatherDeps } from './weather'

import { recordHistoryAndAlerts } from './history'
import { createReport, listReports } from './reports'
import {
  adminListReports,
  adminLogin,
  adminLogout,
  adminSessionCheck,
  adminUpdateReportStatus,
} from './admin'

export type { Env } from './db'

const ALLOWED_METHODS = 'GET, HEAD'

type Handler = (env: Env, deps: WeatherDeps, request: Request) => Promise<Response>

const ROUTES: Record<string, Handler> = {
  '/api/health': health,
  '/api/zones': zones,
  '/api/weather': weather,
  '/api/predictions': predictions,
  '/api/alerts': alerts,
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function health(env: Env, _deps: WeatherDeps, _request: Request): Promise<Response> {
  const dbOk = await checkDatabase(env.DB)
  const body: HealthResponse = {
    data: { status: dbOk ? 'ok' : 'degraded', service: 'geoshield-ner-api', database: dbOk ? 'ok' : 'unavailable' },
  }
  return json(body, dbOk ? 200 : 503)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function zones(env: Env, _deps: WeatherDeps, _request: Request): Promise<Response> {
  try {
    const zonesData = await loadZones(env.DB)
    
    // Asynchronously record history and generate alerts (fire-and-forget for resilience)
    // We intentionally don't await this so the API responds quickly. But wait, Cloudflare workers 
    // might cancel unawaited promises. We can use env.waitUntil, but that's in the ctx.
    // For local prototype, we can await it, but ignore errors.
    await recordHistoryAndAlerts(env.DB, zonesData).catch(e => console.error('[history] failed:', e))
    
    return json(buildZonesResponse(zonesData))
  } catch (err) {
    // Details go to the server log only; the response carries a fixed message.
    if (err instanceof DatabaseError) {
      console.error('[api] zones: database error:', err.message)
      return errorResponse(503, 'database_unavailable')
    }
    if (err instanceof StoredDataError) {
      console.error('[api] zones: invalid stored data:', err.message)
      return errorResponse(500, 'invalid_stored_data')
    }
    throw err
  }
}

async function predictions(env: Env, _deps: WeatherDeps, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50
    const zoneId = url.searchParams.get('zoneId')

    let query = 'SELECT id, zone_id as zoneId, risk_score as riskScore, risk_level as riskLevel, created_at as createdAt, input_provenance as inputProvenance FROM prediction_history '
    const binds: unknown[] = []
    
    if (zoneId) {
      query += 'WHERE zone_id = ? '
      binds.push(zoneId)
    }
    
    query += 'ORDER BY created_at DESC LIMIT ?'
    binds.push(limit)

    const res = await env.DB.prepare(query).bind(...binds).all()
    return json({ data: { predictions: res.results } })
  } catch (err) {
    console.error('[api] predictions: database error:', err)
    return errorResponse(503, 'database_unavailable')
  }
}

async function alerts(env: Env, _deps: WeatherDeps, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true'
    
    let query = 'SELECT id, zone_id as zoneId, risk_score as riskScore, risk_level as riskLevel, created_at as createdAt, is_read as isRead, message, input_provenance as inputProvenance FROM alerts '
    
    if (unreadOnly) {
      query += 'WHERE is_read = 0 '
    }
    
    query += 'ORDER BY created_at DESC LIMIT 100'

    const res = await env.DB.prepare(query).all()
    const mapped = res.results.map(r => ({ ...r, isRead: r.isRead === 1 }))
    return json({ data: { alerts: mapped } })
  } catch (err) {
    console.error('[api] alerts: database error:', err)
    return errorResponse(503, 'database_unavailable')
  }
}

async function markAlertRead(env: Env, id: string): Promise<Response> {
  try {
    const res = await env.DB.prepare('UPDATE alerts SET is_read = 1 WHERE id = ? RETURNING id').bind(id).first()
    if (!res) {
      return errorResponse(404, 'not_found')
    }
    return json({ success: true })
  } catch (err) {
    console.error('[api] markAlertRead: database error:', err)
    return errorResponse(503, 'database_unavailable')
  }
}


// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function weather(env: Env, deps: WeatherDeps, _request: Request): Promise<Response> {
  try {
    // Provider failures are not errors here: they come back as `stale` / `unavailable` data (see worker/weather.ts).
    return json(await getWeather(env, deps))
  } catch (err) {
    if (err instanceof DatabaseError) {
      console.error('[api] weather: database error:', err.message)
      return errorResponse(503, 'database_unavailable')
    }
    if (err instanceof StoredDataError) {
      console.error('[api] weather: invalid stored data:', err.message)
      return errorResponse(500, 'invalid_stored_data')
    }
    throw err
  }
}

/** Trailing slashes are ignored; the query string is never read. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export async function handleRequest(request: Request, env: Env, deps: WeatherDeps = defaultWeatherDeps()): Promise<Response> {
  try {
    const path = normalizePath(new URL(request.url).pathname)
    const handler = ROUTES[path]
    
    // Check for PATCH /api/alerts/:id/read
    if (!handler && path.startsWith('/api/alerts/') && path.endsWith('/read')) {
      const parts = path.split('/')
      const id = parts[parts.length - 2]
      if (parts.length === 5 && id) {
        if (request.method.toUpperCase() === 'PATCH') {
          return await markAlertRead(env, id)
        } else {
          return errorResponse(405, 'method_not_allowed', { allow: 'PATCH' })
        }
      }
    }

    if (path === '/api/reports') {
      const method = request.method.toUpperCase()
      if (method === 'POST') {
        return await createReport(env, request)
      }
      if (method === 'GET' || method === 'HEAD') {
        const response = await listReports(env, request)
        return method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response
      }
      return errorResponse(405, 'method_not_allowed', { allow: 'GET, POST, HEAD' })
    }

    if (path === '/api/admin/login') {
      if (request.method.toUpperCase() === 'POST') {
        return await adminLogin(env, request)
      }
      return errorResponse(405, 'method_not_allowed', { allow: 'POST' })
    }

    if (path === '/api/admin/session') {
      const method = request.method.toUpperCase()
      if (method === 'GET' || method === 'HEAD') {
        const response = await adminSessionCheck(env, request)
        return method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response
      }
      return errorResponse(405, 'method_not_allowed', { allow: 'GET, HEAD' })
    }

    if (path === '/api/admin/logout') {
      if (request.method.toUpperCase() === 'POST') {
        return await adminLogout(env, request)
      }
      return errorResponse(405, 'method_not_allowed', { allow: 'POST' })
    }

    if (path === '/api/admin/reports') {
      const method = request.method.toUpperCase()
      if (method === 'GET' || method === 'HEAD') {
        const response = await adminListReports(env, request)
        return method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response
      }
      return errorResponse(405, 'method_not_allowed', { allow: 'GET, HEAD' })
    }

    if (path.startsWith('/api/admin/reports/') && path.endsWith('/status')) {
      const parts = path.split('/')
      if (parts.length === 6) {
        const reportId = parts[4]
        if (request.method.toUpperCase() === 'PATCH') {
          return await adminUpdateReportStatus(env, request, reportId)
        }
        return errorResponse(405, 'method_not_allowed', { allow: 'PATCH' })
      }
    }

    if (!handler) return errorResponse(404, 'not_found')

    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return errorResponse(405, 'method_not_allowed', { allow: ALLOWED_METHODS })

    const response = await handler(env, deps, request)
    // HEAD: same status and headers, no body.
    return method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response
  } catch (err) {
    console.error('[api] unhandled error:', err instanceof Error ? err.message : 'unknown')
    return errorResponse(500, 'internal_error')
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
}
