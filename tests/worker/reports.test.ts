// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { api, brokenEnv, createTestDb } from './helpers'
import type { ApiReport } from '../../src/types/api'

describe('Worker Reports API — POST /api/reports', () => {
  it('creates a report successfully with valid required fields and sets pending status', async () => {
    const { env } = createTestDb()
    const payload = {
      zoneId: 'gangtok',
      category: 'Landslide',
      title: 'Minor mudflow near highway',
      description: 'Mud and rocks fell onto the side of the NH10 near kilometre 24.',
    }

    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(res.status).toBe(201)
    expect(body.data).toBeDefined()
    const report: ApiReport = body.data.report
    expect(report.id).toBeDefined()
    expect(typeof report.id).toBe('string')
    expect(report.zoneId).toBe('gangtok')
    expect(report.category).toBe('Landslide')
    expect(report.title).toBe('Minor mudflow near highway')
    expect(report.description).toBe('Mud and rocks fell onto the side of the NH10 near kilometre 24.')
    expect(report.latitude).toBeNull()
    expect(report.longitude).toBeNull()
    expect(report.status).toBe('pending')
    expect(report.createdAt).toBeDefined()
    expect(report.updatedAt).toBeDefined()
    expect(new Date(report.createdAt).toISOString()).toBe(report.createdAt)
  })

  it('creates a report with valid optional coordinates', async () => {
    const { env } = createTestDb()
    const payload = {
      zoneId: 'guwahati',
      category: 'Heavy rainfall or waterlogging',
      title: 'Waterlogging under flyover',
      description: 'Water standing at 0.5m depth under the Ulubari flyover.',
      latitude: 26.175,
      longitude: 91.755,
    }

    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(res.status).toBe(201)
    const report: ApiReport = body.data.report
    expect(report.latitude).toBe(26.175)
    expect(report.longitude).toBe(91.755)
  })

  it('rejects unsupported content-type with 415', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'plain text data',
    })

    expect(res.status).toBe(415)
    expect(body.error.code).toBe('unsupported_media_type')
  })

  it('rejects missing content-type with 415', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      body: JSON.stringify({ zoneId: 'guwahati', category: 'Rockfall', title: 'T', description: 'D' }),
    })

    expect(res.status).toBe(415)
    expect(body.error.code).toBe('unsupported_media_type')
  })

  it('rejects malformed JSON body with 400 bad_request', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects non-object JSON body (e.g. array or primitive)', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['array', 'payload']),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects payload exceeding size limit (10KB)', async () => {
    const { env } = createTestDb()
    const hugeDesc = 'A'.repeat(11000)
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'guwahati', category: 'Rockfall', title: 'T', description: hugeDesc }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects missing or empty zoneId', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: '   ', category: 'Landslide', title: 'Title', description: 'Desc' }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects unknown zone that does not exist in DB', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'non-existent-zone', category: 'Landslide', title: 'Title', description: 'Desc' }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toMatch(/zone/i)
  })

  it('rejects invalid hazard category', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Alien Invasion', title: 'Title', description: 'Desc' }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toMatch(/category/i)
  })

  it('rejects missing or oversized title (>120 chars)', async () => {
    const { env } = createTestDb()
    const longTitle = 'T'.repeat(121)
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: longTitle, description: 'Desc' }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects missing or oversized description (>2000 chars)', async () => {
    const { env } = createTestDb()
    const longDesc = 'D'.repeat(2001)
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: 'Valid title', description: longDesc }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects half-specified coordinates (latitude without longitude)', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: 'T', description: 'D', latitude: 27.3 }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
    expect(body.error.message).toMatch(/both/i)
  })

  it('rejects non-numeric coordinates', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: 'T', description: 'D', latitude: 'north', longitude: 91 }),
    })

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects out-of-range coordinates', async () => {
    const { env } = createTestDb()
    const res1 = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: 'T', description: 'D', latitude: 91, longitude: 91 }),
    })
    expect(res1.res.status).toBe(400)

    const res2 = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: 'T', description: 'D', latitude: 25, longitude: 181 }),
    })
    expect(res2.res.status).toBe(400)
  })

  it('always enforces server-generated status pending regardless of client input', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        zoneId: 'gangtok',
        category: 'Rockfall',
        title: 'Title',
        description: 'Desc',
        status: 'resolved',
      }),
    })

    expect(res.status).toBe(201)
    expect(body.data.report.status).toBe('pending')
  })

  it('returns 503 on database unavailability during insert', async () => {
    const { res, body } = await api(brokenEnv, '/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zoneId: 'gangtok', category: 'Rockfall', title: 'T', description: 'D' }),
    })

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('database_unavailable')
  })
})

describe('Worker Reports API — GET /api/reports', () => {
  it('returns empty list when no reports exist', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports')

    expect(res.status).toBe(200)
    expect(body.data.reports).toEqual([])
  })

  it('lists reports sorted newest first with deterministic tie breaking', async () => {
    const { env, raw } = createTestDb()
    raw.exec(`
      INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
      VALUES
        ('r1', 'gangtok', 'Rockfall', 'First report', 'Desc 1', 'pending', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('r2', 'shillong', 'Landslide', 'Second report', 'Desc 2', 'pending', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z'),
        ('r3', 'guwahati', 'Blocked road', 'Third report', 'Desc 3', 'pending', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z');
    `)

    const { res, body } = await api(env, '/api/reports')
    expect(res.status).toBe(200)
    const ids = body.data.reports.map((r: ApiReport) => r.id)
    // r3 and r2 have same created_at, ordered by id DESC -> r3, r2, r1
    expect(ids).toEqual(['r3', 'r2', 'r1'])
  })

  it('filters by zoneId', async () => {
    const { env, raw } = createTestDb()
    raw.exec(`
      INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
      VALUES
        ('r1', 'gangtok', 'Rockfall', 'Gtk', 'D', 'pending', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('r2', 'shillong', 'Landslide', 'Shl', 'D', 'pending', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z');
    `)

    const { res, body } = await api(env, '/api/reports?zoneId=gangtok')
    expect(res.status).toBe(200)
    expect(body.data.reports).toHaveLength(1)
    expect(body.data.reports[0].id).toBe('r1')
  })

  it('filters by category', async () => {
    const { env, raw } = createTestDb()
    raw.exec(`
      INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
      VALUES
        ('r1', 'gangtok', 'Rockfall', 'Gtk', 'D', 'pending', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('r2', 'shillong', 'Landslide', 'Shl', 'D', 'pending', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z');
    `)

    const { res, body } = await api(env, '/api/reports?category=Landslide')
    expect(res.status).toBe(200)
    expect(body.data.reports).toHaveLength(1)
    expect(body.data.reports[0].id).toBe('r2')
  })

  it('filters by status', async () => {
    const { env, raw } = createTestDb()
    raw.exec(`
      INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
      VALUES
        ('r1', 'gangtok', 'Rockfall', 'Gtk', 'D', 'pending', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('r2', 'shillong', 'Landslide', 'Shl', 'D', 'reviewed', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z');
    `)

    const { res, body } = await api(env, '/api/reports?status=reviewed')
    expect(res.status).toBe(200)
    expect(body.data.reports).toHaveLength(1)
    expect(body.data.reports[0].id).toBe('r2')
  })

  it('rejects invalid category filter with 400', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports?category=InvalidCat')
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('rejects invalid status filter with 400', async () => {
    const { env } = createTestDb()
    const { res, body } = await api(env, '/api/reports?status=bogus_status')
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('bad_request')
  })

  it('applies bounded limit parameter', async () => {
    const { env, raw } = createTestDb()
    raw.exec(`
      INSERT INTO reports (id, zone_id, category, title, description, status, created_at, updated_at)
      VALUES
        ('r1', 'gangtok', 'Rockfall', '1', 'D', 'pending', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z'),
        ('r2', 'shillong', 'Landslide', '2', 'D', 'pending', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z'),
        ('r3', 'guwahati', 'Rockfall', '3', 'D', 'pending', '2026-10-03T10:00:00.000Z', '2026-10-03T10:00:00.000Z');
    `)

    const { res, body } = await api(env, '/api/reports?limit=2')
    expect(res.status).toBe(200)
    expect(body.data.reports).toHaveLength(2)
  })

  it('rejects invalid limit parameter with 400', async () => {
    const { env } = createTestDb()
    const res1 = await api(env, '/api/reports?limit=0')
    expect(res1.res.status).toBe(400)

    const res2 = await api(env, '/api/reports?limit=105')
    expect(res2.res.status).toBe(400)

    const res3 = await api(env, '/api/reports?limit=abc')
    expect(res3.res.status).toBe(400)
  })

  it('rejects unsupported HTTP methods with 405 Method Not Allowed', async () => {
    const { env } = createTestDb()
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const { res, body } = await api(env, '/api/reports', { method })
      expect(res.status).toBe(405)
      expect(body.error.code).toBe('method_not_allowed')
      expect(res.headers.get('allow')).toBe('GET, POST, HEAD')
    }
  })

  it('returns 503 on database unavailability during list', async () => {
    const { res, body } = await api(brokenEnv, '/api/reports')
    expect(res.status).toBe(503)
    expect(body.error.code).toBe('database_unavailable')
  })
})
