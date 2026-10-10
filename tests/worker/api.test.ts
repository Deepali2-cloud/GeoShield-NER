// @vitest-environment node
import { DEMO_ZONES } from '../../src/data/demoZones'
import { assessZone } from '../../src/risk/zoneRisk'
import { INPUT_KEYS } from '../../src/types/api'
import type { ApiZone } from '../../src/types/api'
import { handleRequest } from '../../worker/index'
import { DatabaseError, StoredDataError, rowToApiZone } from '../../worker/zones'
import { LEAKY_MESSAGE, api, brokenEnv, createTestDb } from './helpers'

/** Phase 3 results for the six demo inputs. Any change here means the risk engine's behaviour changed. */
const GOLDEN: Record<string, [number, string]> = {
  guwahati: [23.3, 'LOW'],
  itanagar: [34.5, 'MODERATE'],
  kohima: [44.8, 'MODERATE'],
  shillong: [57.1, 'HIGH'],
  aizawl: [63.3, 'HIGH'],
  gangtok: [78.8, 'CRITICAL'],
}

const zonesOf = (body: Record<string, any>): ApiZone[] => body.data.zones // eslint-disable-line @typescript-eslint/no-explicit-any
const LEAK = /sqlite|no such table|\/srv\/|secret|token|abc123|stack|\bat \w+.*\(|SELECT|FROM zones/i

describe('GET /api/health', () => {
  it('confirms the Worker and database are up', async () => {
    const { res, body } = await api(createTestDb().env, '/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(body).toEqual({ data: { status: 'ok', service: 'geoshield-ner-api', database: 'ok' } })
  })

  it('reports degraded (503) when the database is unreachable, without leaking details', async () => {
    const { res, text, body } = await api(brokenEnv, '/api/health')
    expect(res.status).toBe(503)
    expect(body.data).toEqual({ status: 'degraded', service: 'geoshield-ner-api', database: 'unavailable' })
    expect(text).not.toMatch(LEAK)
  })

  it('reports degraded when migrations have not been applied', async () => {
    const { res, body } = await api(createTestDb({ migrate: false }).env, '/api/health')
    expect(res.status).toBe(503)
    expect(body.data.database).toBe('unavailable')
  })

  it('reports degraded when the DB binding is missing entirely', async () => {
    const { res } = await api({} as never, '/api/health')
    expect(res.status).toBe(503)
  })
})

describe('GET /api/zones: seeded data', () => {
  it('returns the six seeded zones in dashboard order', async () => {
    const { res, body } = await api(createTestDb().env, '/api/zones')
    expect(res.status).toBe(200)
    expect(zonesOf(body)).toHaveLength(6)
    expect(zonesOf(body).map((z) => z.id)).toEqual(DEMO_ZONES.map((z) => z.id))
    expect(body.meta.count).toBe(6)
  })

  it('has ids, names, states and coordinates identical to src/data/demoZones.ts', async () => {
    const { body } = await api(createTestDb().env, '/api/zones')
    for (const demo of DEMO_ZONES) {
      const z = zonesOf(body).find((x) => x.id === demo.id)!
      expect(z).toBeDefined()
      expect(z.name).toBe(demo.name)
      expect(z.state).toBe(demo.state)
      expect(z.latitude).toBe(demo.latitude)
      expect(z.longitude).toBe(demo.longitude)
    }
  })

  it('preserves every raw input value and marks it as demo', async () => {
    const { body } = await api(createTestDb().env, '/api/zones')
    for (const demo of DEMO_ZONES) {
      const z = zonesOf(body).find((x) => x.id === demo.id)!
      for (const key of INPUT_KEYS) expect(z.inputs[key]).toEqual({ value: demo.inputs[key].value, source: 'demo' })
      expect(z.origin).toBe('demo_seed')
    }
  })

  it('matches the Phase 3 golden scores and levels', async () => {
    const { body } = await api(createTestDb().env, '/api/zones')
    for (const z of zonesOf(body)) {
      expect(z.assessment.ok).toBe(true)
      if (!z.assessment.ok) continue
      expect([z.assessment.result.score, z.assessment.result.level]).toEqual(GOLDEN[z.id])
    }
  })

  it('returns exactly what the shared engine returns (no second implementation)', async () => {
    const { body } = await api(createTestDb().env, '/api/zones')
    for (const demo of DEMO_ZONES) {
      const direct = assessZone(demo)
      const viaApi = zonesOf(body).find((x) => x.id === demo.id)!.assessment
      expect(direct.ok && viaApi.ok).toBe(true)
      if (direct.ok && viaApi.ok) expect(viaApi.result).toEqual(JSON.parse(JSON.stringify(direct.result)))
    }
  })

  it('carries demo/provenance metadata', async () => {
    const { body } = await api(createTestDb().env, '/api/zones')
    expect(body.meta.demoData).toBe(true)
    expect(body.meta.modelVersion).toBe('weighted-v1')
    expect(body.meta.notice).toMatch(/illustrative demo data/i)
    expect(body.meta.notice).toMatch(/not live weather/i)
  })

  it('stores no calculated risk value: only raw inputs, the engine computes the rest', () => {
    const { raw } = createTestDb()
    const cols = (raw.prepare('PRAGMA table_info(zones)').all() as { name: string }[]).map((c) => c.name)
    expect(cols.filter((c) => /^(score|level|risk\w*|\w*_level|\w*_risk)$/i.test(c))).toEqual([])
    expect(cols).toContain('soil_score') // a raw 0-100 input, not a calculated result
  })

  it('ignores the query string (no request data reaches SQL)', async () => {
    const t = createTestDb()
    const { res, body } = await api(t.env, `/api/zones?id=${encodeURIComponent("x'; DROP TABLE zones; --")}&limit=1`)
    expect(res.status).toBe(200)
    expect(zonesOf(body)).toHaveLength(6)
    expect((t.raw.prepare('SELECT COUNT(*) AS n FROM zones').get() as { n: number }).n).toBe(6)
  })

  it('tolerates a trailing slash', async () => {
    const { res } = await api(createTestDb().env, '/api/zones/')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/zones: invalid or missing inputs never produce invented scores', () => {
  const run = async (sql: string) => {
    const t = createTestDb()
    t.raw.exec(sql)
    const { res, body } = await api(t.env, '/api/zones')
    return { res, zones: zonesOf(body) }
  }
  const guwahati = (zs: ApiZone[]) => zs.find((z) => z.id === 'guwahati')!

  it('NULL input -> assessment not ok, no score, other zones unaffected', async () => {
    const { res, zones } = await run("UPDATE zones SET rainfall_72h_mm = NULL WHERE id = 'guwahati'")
    expect(res.status).toBe(200)
    const a = guwahati(zones).assessment
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.errors.join(' ')).toMatch(/Rainfall \(past 72 h\): missing/)
    expect(a).not.toHaveProperty('result')
    expect(guwahati(zones).inputs.rainfall72hMm.value).toBeNull()
    expect(zones.filter((z) => z.assessment.ok)).toHaveLength(5)
  })

  it('out-of-range input is reported, never clamped', async () => {
    const { zones } = await run("UPDATE zones SET slope_deg = 120 WHERE id = 'guwahati'")
    const a = guwahati(zones).assessment
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.errors.join(' ')).toMatch(/Slope angle: must be between 0 and 90/)
  })

  it('negative input is rejected', async () => {
    const { zones } = await run("UPDATE zones SET elevation_m = -5 WHERE id = 'guwahati'")
    expect(guwahati(zones).assessment.ok).toBe(false)
  })

  it('non-numeric stored text is rejected', async () => {
    const { zones } = await run("UPDATE zones SET soil_score = 'abc' WHERE id = 'guwahati'")
    const a = guwahati(zones).assessment
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.errors.join(' ')).toMatch(/Soil score: must be a finite number/)
    expect(guwahati(zones).inputs.soilScore.value).toBeNull()
  })

  it('unknown source is flagged and blocks scoring', async () => {
    const t = createTestDb({ migrate: true, seed: true })
    // The CHECK constraint prevents this in D1, so exercise the mapper directly with a corrupt row.
    const row = t.raw.prepare("SELECT * FROM zones WHERE id = 'guwahati'").get() as Record<string, unknown>
    const z = rowToApiZone({ ...row, slope_deg_source: 'guess' })
    expect(z.assessment.ok).toBe(false)
    if (!z.assessment.ok) expect(z.assessment.errors.join(' ')).toMatch(/Slope angle: unknown data source/)
    expect(z.inputs.slopeDeg.source).toBeNull()
  })
})

describe('GET /api/zones: empty and failing database', () => {
  it('empty table -> 200 with an explicit empty list', async () => {
    const t = createTestDb()
    t.raw.exec('DELETE FROM zones')
    const { res, body } = await api(t.env, '/api/zones')
    expect(res.status).toBe(200)
    expect(body.data.zones).toEqual([])
    expect(body.meta.count).toBe(0)
  })

  it('database failure -> 503 with a fixed message and no substituted data', async () => {
    const { res, text, body } = await api(brokenEnv, '/api/zones')
    expect(res.status).toBe(503)
    expect(body).toEqual({ error: { code: 'database_unavailable', message: 'The database is currently unavailable.' } })
    expect(text).not.toMatch(LEAK)
    expect(text).not.toMatch(/guwahati|score/i) // never falls back to DEMO_ZONES
  })

  it('unmigrated database -> 503, no SQL details', async () => {
    const { res, text } = await api(createTestDb({ migrate: false }).env, '/api/zones')
    expect(res.status).toBe(503)
    expect(text).not.toMatch(LEAK)
  })

  it('missing DB binding -> 503', async () => {
    const { res, body } = await api({} as never, '/api/zones')
    expect(res.status).toBe(503)
    expect(body.error.code).toBe('database_unavailable')
  })

  it('a corrupt row identity -> 500 invalid_stored_data, not a guessed zone', async () => {
    const env = { DB: { prepare: () => ({ bind() { return this }, all: async () => ({ results: [{ id: 'bad', name: 'Bad', state: 'X', latitude: null, longitude: 1, record_origin: 'user' }] }), first: async () => null }) } }
    const { res, text, body } = await api(env as never, '/api/zones')
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('invalid_stored_data')
    expect(text).not.toMatch(/latitude|bad/i)
  })

  it('rowToApiZone / loadZones raise typed internal errors', async () => {
    expect(() => rowToApiZone({ id: '', name: 'n', state: 's', latitude: 1, longitude: 1, record_origin: 'user' })).toThrow(StoredDataError)
    expect(() => rowToApiZone({ id: 'a', name: 'n', state: 's', latitude: 91, longitude: 1, record_origin: 'user' })).toThrow(StoredDataError)
    const { loadZones } = await import('../../worker/zones')
    await expect(loadZones(brokenEnv.DB)).rejects.toThrow(DatabaseError)
  })

  it('an unexpected exception -> generic 500 with no internals', async () => {
    const env = { DB: { prepare: () => { throw new Error(LEAKY_MESSAGE) } } }
    const bomb = new Request('http://localhost/api/zones')
    Object.defineProperty(bomb, 'url', { get: () => { throw new Error(LEAKY_MESSAGE) } })
    const res = await handleRequest(bomb, env as never)
    const text = await res.text()
    expect(res.status).toBe(500)
    expect(JSON.parse(text)).toEqual({ error: { code: 'internal_error', message: 'An unexpected error occurred.' } })
    expect(text).not.toMatch(LEAK)
  })
})

describe('routing, methods and error shape', () => {
  const env = () => createTestDb().env

  it.each(['/', '/api', '/api/', '/api/nope', '/api/zones/guwahati', '/health', '/api/health/extra', '/api/__proto__', '/api/constructor'])(
    'unknown route %s -> 404 JSON',
    async (p) => {
      const { res, body } = await api(env(), p)
      expect(res.status).toBe(404)
      expect(body).toEqual({ error: { code: 'not_found', message: 'Route not found.' } })
    },
  )

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('%s on a known route -> 405 with Allow header', async (method) => {
    for (const p of ['/api/zones', '/api/health']) {
      const { res, body } = await api(env(), p, { method })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('GET, HEAD')
      expect(body.error.code).toBe('method_not_allowed')
    }
  })

  it('a rejected write does not change data', async () => {
    const t = createTestDb()
    await api(t.env, '/api/zones', { method: 'POST', body: JSON.stringify({ id: 'x' }) })
    await api(t.env, '/api/zones', { method: 'DELETE' })
    expect((t.raw.prepare('SELECT COUNT(*) AS n FROM zones').get() as { n: number }).n).toBe(6)
  })

  it('unknown route with a write method is still 404 (route is checked first)', async () => {
    const { res } = await api(env(), '/api/nope', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('HEAD returns headers and status with no body', async () => {
    const { res, text } = await api(env(), '/api/zones', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(text).toBe('')
    expect(res.headers.get('content-type')).toMatch(/json/)
  })

  it('every error body has exactly the { error: { code, message } } shape and no leaks', async () => {
    const cases = [
      await api(env(), '/api/nope'),
      await api(env(), '/api/zones', { method: 'POST' }),
      await api(brokenEnv, '/api/zones'),
    ]
    for (const { res, text, body } of cases) {
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(Object.keys(body)).toEqual(['error'])
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message'])
      expect(text).not.toMatch(LEAK)
    }
  })

  it('sets safe headers and does not add CORS headers (same-origin via the Vite proxy)', async () => {
    const { res } = await api(env(), '/api/zones', { headers: { origin: 'https://evil.example' } })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
