import type { Env } from './db'
import { errorResponse, json } from './http'
import { REPORT_CATEGORIES, REPORT_STATUSES } from '../src/types/api'
import type { ApiReport, ReportCategory, ReportStatus } from '../src/types/api'

const MAX_BODY_BYTES = 10240
const MAX_TITLE_LENGTH = 120
const MAX_DESC_LENGTH = 2000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export async function createReport(env: Env, request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return errorResponse(415, 'unsupported_media_type', {}, 'Content-Type must be application/json.')
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return errorResponse(400, 'bad_request', {}, 'Request payload exceeds 10KB limit.')
  }

  let text: string
  try {
    text = await request.text()
  } catch (err) {
    console.error('[api] reports: failed to read request text:', err)
    return errorResponse(400, 'bad_request', {}, 'Could not read request body.')
  }

  if (text.length > MAX_BODY_BYTES) {
    return errorResponse(400, 'bad_request', {}, 'Request payload exceeds 10KB limit.')
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return errorResponse(400, 'bad_request', {}, 'Invalid JSON body.')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse(400, 'bad_request', {}, 'Request body must be a JSON object.')
  }

  const payload = body as Record<string, unknown>

  // Zone validation
  if (typeof payload.zoneId !== 'string' || !payload.zoneId.trim()) {
    return errorResponse(400, 'bad_request', {}, 'zoneId is required.')
  }
  const zoneId = payload.zoneId.trim()

  try {
    const zoneExists = await env.DB.prepare('SELECT id FROM zones WHERE id = ?').bind(zoneId).first()
    if (!zoneExists) {
      return errorResponse(400, 'bad_request', {}, 'Zone does not exist.')
    }
  } catch (err) {
    console.error('[api] reports: database error verifying zone:', err)
    return errorResponse(503, 'database_unavailable')
  }

  // Category validation
  if (typeof payload.category !== 'string' || !REPORT_CATEGORIES.includes(payload.category as ReportCategory)) {
    return errorResponse(400, 'bad_request', {}, 'Invalid report category.')
  }
  const category = payload.category as ReportCategory

  // Title validation
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    return errorResponse(400, 'bad_request', {}, 'Title is required.')
  }
  const title = payload.title.trim()
  if (title.length > MAX_TITLE_LENGTH) {
    return errorResponse(400, 'bad_request', {}, `Title cannot exceed ${MAX_TITLE_LENGTH} characters.`)
  }

  // Description validation
  if (typeof payload.description !== 'string' || !payload.description.trim()) {
    return errorResponse(400, 'bad_request', {}, 'Description is required.')
  }
  const description = payload.description.trim()
  if (description.length > MAX_DESC_LENGTH) {
    return errorResponse(400, 'bad_request', {}, `Description cannot exceed ${MAX_DESC_LENGTH} characters.`)
  }

  // Coordinates validation
  const latRaw = payload.latitude
  const lngRaw = payload.longitude

  const latProvided = latRaw !== undefined && latRaw !== null
  const lngProvided = lngRaw !== undefined && lngRaw !== null

  let latitude: number | null = null
  let longitude: number | null = null

  if (latProvided !== lngProvided) {
    return errorResponse(400, 'bad_request', {}, 'Latitude and longitude must both be provided or both omitted.')
  }

  if (latProvided && lngProvided) {
    if (typeof latRaw !== 'number' || !Number.isFinite(latRaw) || typeof lngRaw !== 'number' || !Number.isFinite(lngRaw)) {
      return errorResponse(400, 'bad_request', {}, 'Coordinates must be valid finite numbers.')
    }
    if (latRaw < -90 || latRaw > 90) {
      return errorResponse(400, 'bad_request', {}, 'Latitude must be between -90 and 90 degrees.')
    }
    if (lngRaw < -180 || lngRaw > 180) {
      return errorResponse(400, 'bad_request', {}, 'Longitude must be between -180 and 180 degrees.')
    }
    latitude = latRaw
    longitude = lngRaw
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const status: ReportStatus = 'pending'

  try {
    await env.DB.prepare(
      `INSERT INTO reports (id, zone_id, category, title, description, latitude, longitude, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, zoneId, category, title, description, latitude, longitude, status, now, now).run()

    const report: ApiReport = {
      id,
      zoneId,
      category,
      title,
      description,
      latitude,
      longitude,
      status,
      createdAt: now,
      updatedAt: now,
    }
    return json({ data: { report } }, 201)
  } catch (err) {
    console.error('[api] reports: database error inserting report:', err)
    return errorResponse(503, 'database_unavailable')
  }
}

export async function listReports(env: Env, request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const zoneId = url.searchParams.get('zoneId')
    const statusParam = url.searchParams.get('status')
    const categoryParam = url.searchParams.get('category')
    const limitParam = url.searchParams.get('limit')

    if (statusParam && !REPORT_STATUSES.includes(statusParam as ReportStatus)) {
      return errorResponse(400, 'bad_request', {}, 'Invalid status filter.')
    }

    if (categoryParam && !REPORT_CATEGORIES.includes(categoryParam as ReportCategory)) {
      return errorResponse(400, 'bad_request', {}, 'Invalid category filter.')
    }

    let limit = DEFAULT_LIMIT
    if (limitParam !== null) {
      if (!/^\d+$/.test(limitParam)) {
        return errorResponse(400, 'bad_request', {}, `Limit must be a positive integer between 1 and ${MAX_LIMIT}.`)
      }
      const parsed = parseInt(limitParam, 10)
      if (parsed < 1 || parsed > MAX_LIMIT) {
        return errorResponse(400, 'bad_request', {}, `Limit must be a positive integer between 1 and ${MAX_LIMIT}.`)
      }
      limit = parsed
    }

    let query = `
      SELECT
        id,
        zone_id as zoneId,
        category,
        title,
        description,
        latitude,
        longitude,
        status,
        created_at as createdAt,
        updated_at as updatedAt
      FROM reports
    `

    const whereClauses: string[] = []
    const binds: unknown[] = []

    if (zoneId) {
      whereClauses.push('zone_id = ?')
      binds.push(zoneId)
    }

    if (statusParam) {
      whereClauses.push('status = ?')
      binds.push(statusParam)
    }

    if (categoryParam) {
      whereClauses.push('category = ?')
      binds.push(categoryParam)
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ')
    }

    query += ' ORDER BY created_at DESC, id DESC LIMIT ?'
    binds.push(limit)

    const res = await env.DB.prepare(query).bind(...binds).all<ApiReport>()
    return json({ data: { reports: res.results } })
  } catch (err) {
    console.error('[api] reports: database error listing reports:', err)
    return errorResponse(503, 'database_unavailable')
  }
}
