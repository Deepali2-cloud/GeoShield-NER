// @vitest-environment node
import { DEMO_ZONES } from '../../src/data/demoZones'
import { INPUT_KEYS } from '../../src/types/api'
import { createTestDb, readMigrations, readSeedSql } from './helpers'

type Row = Record<string, unknown>
const all = (t: ReturnType<typeof createTestDb>, sql: string) => t.raw.prepare(sql).all() as Row[]
const count = (t: ReturnType<typeof createTestDb>) => (t.raw.prepare('SELECT COUNT(*) AS n FROM zones').get() as { n: number }).n

describe('migrations', () => {
  it('are versioned, ordered SQL files', () => {
    const names = readMigrations().map((m) => m.name)
    expect(names).toEqual([
      '0001_create_zones.sql',
      '0002_create_weather_cache.sql',
      '0003_prediction_history_alerts.sql',
      '0004_citizen_reports.sql',
      '0005_admin_sessions_audit.sql',
    ])
    expect(names.every((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))).toBe(true)
  })

  it('creates the admin_sessions and moderation_audit tables with indexes', () => {
    const t = createTestDb({ seed: false })
    const sessionCols = all(t, 'PRAGMA table_info(admin_sessions)').map((c) => c.name)
    for (const c of ['session_id_hash', 'admin_id', 'created_at', 'expires_at', 'revoked_at']) {
      expect(sessionCols).toContain(c)
    }
    const sessionIdx = all(t, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'admin_sessions'").map((i) => i.name)
    expect(sessionIdx).toContain('idx_admin_sessions_expires')
    expect(sessionIdx).toContain('idx_admin_sessions_revoked')

    const auditCols = all(t, 'PRAGMA table_info(moderation_audit)').map((c) => c.name)
    for (const c of ['id', 'report_id', 'previous_status', 'new_status', 'admin_id', 'created_at']) {
      expect(auditCols).toContain(c)
    }
    const auditIdx = all(t, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'moderation_audit'").map((i) => i.name)
    expect(auditIdx).toContain('idx_moderation_audit_report')
    expect(auditIdx).toContain('idx_moderation_audit_created')
  })

  it('create the reports table with indexes and constraints', () => {
    const t = createTestDb({ seed: false })
    const cols = all(t, 'PRAGMA table_info(reports)').map((c) => c.name)
    for (const c of ['id', 'zone_id', 'category', 'title', 'description', 'latitude', 'longitude', 'status', 'created_at', 'updated_at']) {
      expect(cols).toContain(c)
    }
    const idx = all(t, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reports'").map((i) => i.name)
    expect(idx).toContain('idx_reports_zone_created')
    expect(idx).toContain('idx_reports_status_created')
    expect(idx).toContain('idx_reports_category_created')
    expect(idx).toContain('idx_reports_created')
  })

  it('create the zones table with indexes and timestamp columns', () => {
    const t = createTestDb({ seed: false })
    const cols = all(t, 'PRAGMA table_info(zones)').map((c) => c.name)
    for (const c of ['id', 'name', 'state', 'latitude', 'longitude', 'rainfall_72h_mm', 'slope_deg', 'elevation_m', 'soil_score', 'historical_score', 'created_at', 'updated_at', 'record_origin']) {
      expect(cols).toContain(c)
    }
    const idx = all(t, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'zones'").map((i) => i.name)
    expect(idx).toContain('idx_zones_sort_order')
    expect(idx).toContain('idx_zones_record_origin')
    expect(count(t)).toBe(0)
  })

  it('enforce constraints', () => {
    const t = createTestDb({ seed: false })
    const insert = (cols: string, vals: string) => () => t.raw.exec(`INSERT INTO zones (${cols}) VALUES (${vals})`)
    const base = 'id, name, state, latitude, longitude'
    expect(insert(base, "'z', 'Z', 'S', 10, 20")).not.toThrow()
    expect(insert(base, "'z', 'Z', 'S', 10, 20")).toThrow() // duplicate primary key
    expect(insert(base, "'a', 'A', 'S', 91, 0")).toThrow() // latitude out of range
    expect(insert(base, "'a', 'A', 'S', 0, 181")).toThrow() // longitude out of range
    expect(insert(base, "'', 'A', 'S', 0, 0")).toThrow() // empty id
    expect(insert(base + ', slope_deg_source', "'b', 'B', 'S', 0, 0, 'guess'")).toThrow() // unknown source
    expect(insert(base + ', record_origin', "'c', 'C', 'S', 0, 0, 'hacker'")).toThrow() // unknown origin
  })

  it('default new rows to origin "user" and source "demo", with timestamps', () => {
    const t = createTestDb({ seed: false })
    t.raw.exec("INSERT INTO zones (id, name, state, latitude, longitude) VALUES ('n', 'N', 'S', 1, 2)")
    const r = all(t, "SELECT * FROM zones WHERE id = 'n'")[0]
    expect(r.record_origin).toBe('user')
    expect(r.slope_deg_source).toBe('demo')
    expect(String(r.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.updated_at).toBe(r.created_at)
  })
})

describe('demo seed', () => {
  it('inserts exactly the six demo zones, consistent with src/data/demoZones.ts', () => {
    const t = createTestDb()
    expect(count(t)).toBe(6)
    const rows = all(t, 'SELECT * FROM zones ORDER BY sort_order, id')
    expect(rows.map((r) => r.id)).toEqual(DEMO_ZONES.map((z) => z.id))
    const col: Record<string, [string, string]> = {
      rainfall72hMm: ['rainfall_72h_mm', 'rainfall_72h_mm_source'],
      slopeDeg: ['slope_deg', 'slope_deg_source'],
      elevationM: ['elevation_m', 'elevation_m_source'],
      soilScore: ['soil_score', 'soil_score_source'],
      historicalScore: ['historical_score', 'historical_score_source'],
    }
    DEMO_ZONES.forEach((demo, i) => {
      const r = rows[i]
      expect([r.id, r.name, r.state, r.latitude, r.longitude]).toEqual([demo.id, demo.name, demo.state, demo.latitude, demo.longitude])
      for (const key of INPUT_KEYS) {
        expect(r[col[key][0]]).toBe(demo.inputs[key].value)
        expect(r[col[key][1]]).toBe('demo')
      }
      expect(r.record_origin).toBe('demo_seed')
    })
  })

  it('is idempotent: running it repeatedly creates no duplicates and keeps created_at', () => {
    const t = createTestDb()
    const before = all(t, 'SELECT id, created_at FROM zones ORDER BY id')
    for (let i = 0; i < 3; i++) t.raw.exec(readSeedSql())
    expect(count(t)).toBe(6)
    expect(all(t, 'SELECT id, created_at FROM zones ORDER BY id')).toEqual(before)
  })

  it('repairs drifted demo rows back to the demo values', () => {
    const t = createTestDb()
    t.raw.exec("UPDATE zones SET slope_deg = 1, name = 'Changed' WHERE id = 'kohima'")
    t.raw.exec(readSeedSql())
    const r = all(t, "SELECT name, slope_deg FROM zones WHERE id = 'kohima'")[0]
    expect(r).toEqual({ name: 'Kohima', slope_deg: 27 })
  })

  it('never overwrites a non-demo row, even one that shares a demo id', () => {
    const t = createTestDb({ seed: false })
    t.raw.exec("INSERT INTO zones (id, name, state, latitude, longitude, slope_deg, record_origin) VALUES ('guwahati', 'My Guwahati', 'Assam', 26.2, 91.8, 5, 'user')")
    t.raw.exec("INSERT INTO zones (id, name, state, latitude, longitude, record_origin) VALUES ('custom', 'Custom', 'Assam', 26, 91, 'user')")
    t.raw.exec(readSeedSql())
    expect(count(t)).toBe(7) // 5 new demo zones + the 2 user rows
    expect(all(t, "SELECT name, slope_deg, latitude, record_origin FROM zones WHERE id = 'guwahati'")[0]).toEqual({
      name: 'My Guwahati', slope_deg: 5, latitude: 26.2, record_origin: 'user',
    })
    expect(all(t, "SELECT name FROM zones WHERE id = 'custom'")[0]).toEqual({ name: 'Custom' })
  })

  it('marks every seeded input as demo and states it is illustrative', () => {
    const t = createTestDb()
    const sources = all(t, "SELECT rainfall_72h_mm_source a, slope_deg_source b, elevation_m_source c, soil_score_source d, historical_score_source e FROM zones")
    expect(sources.flatMap((r) => Object.values(r))).toEqual(Array(30).fill('demo'))
    expect(readSeedSql()).toMatch(/ILLUSTRATIVE DEMO/)
  })

  it('stays inside the SQL it promises: only inserts into zones, with no destructive statements', () => {
    const sql = readSeedSql().replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER)\b/i)
    expect((sql.match(/INSERT INTO/gi) ?? []).length).toBe(1)
  })
})
