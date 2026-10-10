// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { api, brokenEnv, createTestDb } from './helpers'
import { recordHistoryAndAlerts } from '../../worker/history'
import { loadZones } from '../../worker/zones'

describe('History and Alerts API', () => {
  test('predictions endpoint returns predictions', async () => {
    const { env } = createTestDb()
    const zones = await loadZones(env.DB)
    await recordHistoryAndAlerts(env.DB, zones)

    const { res, body } = await api(env, '/api/predictions')
    expect(res.status).toBe(200)
    expect(body.data.predictions.length).toBe(6) // 6 seed zones

    // Limit works
    const limitRes = await api(env, '/api/predictions?limit=2')
    expect(limitRes.body.data.predictions.length).toBe(2)

    // Filter by zoneId works
    const zoneId = zones[0].id
    const filterRes = await api(env, `/api/predictions?zoneId=${zoneId}`)
    expect(filterRes.body.data.predictions.length).toBe(1)
  })

  test('alerts endpoint returns alerts', async () => {
    const { env } = createTestDb()
    const zones = await loadZones(env.DB)
    // One of the seed zones might be High/Critical and generate an initial alert. Let's see.
    await recordHistoryAndAlerts(env.DB, zones)

    const { res, body } = await api(env, '/api/alerts')
    expect(res.status).toBe(200)
    expect(Array.isArray(body.data.alerts)).toBe(true)
  })

  test('alerts and predictions deduplication', async () => {
    const { env, raw } = createTestDb()
    const zones = await loadZones(env.DB)
    
    await recordHistoryAndAlerts(env.DB, zones)
    const initialPreds = raw.prepare('SELECT count(*) as c FROM prediction_history').get() as { c: number }
    const initialAlerts = raw.prepare('SELECT count(*) as c FROM alerts').get() as { c: number }

    // Run again with unchanged data
    await recordHistoryAndAlerts(env.DB, zones)
    
    const nextPreds = raw.prepare('SELECT count(*) as c FROM prediction_history').get() as { c: number }
    const nextAlerts = raw.prepare('SELECT count(*) as c FROM alerts').get() as { c: number }

    expect(nextPreds.c).toBe(initialPreds.c) // No duplicate predictions
    expect(nextAlerts.c).toBe(initialAlerts.c) // No duplicate alerts
  })

  test('mark alert read', async () => {
    const { env, raw } = createTestDb()
    raw.exec(`INSERT INTO alerts (id, zone_id, risk_score, risk_level, created_at, is_read, message, input_provenance) VALUES ('a1', 'gangtok', 50, 'HIGH', 'now', 0, 'msg', 'demo')`)
    
    const { res, body } = await api(env, '/api/alerts/a1/read', { method: 'PATCH' })
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)

    const readAlert = raw.prepare('SELECT is_read FROM alerts WHERE id = ?').get('a1') as { is_read: number }
    expect(readAlert.is_read).toBe(1)
  })

  test('invalid method on alerts/id/read', async () => {
    const { env } = createTestDb()
    const { res } = await api(env, '/api/alerts/a1/read', { method: 'POST' })
    expect(res.status).toBe(405)
  })

  test('unknown alert read', async () => {
    const { env } = createTestDb()
    const { res } = await api(env, '/api/alerts/unknown/read', { method: 'PATCH' })
    expect(res.status).toBe(404)
  })

  test('handles db errors gracefully', async () => {
    const { res: pRes } = await api(brokenEnv, '/api/predictions')
    expect(pRes.status).toBe(503)

    const { res: aRes } = await api(brokenEnv, '/api/alerts')
    expect(aRes.status).toBe(503)

    const { res: mRes } = await api(brokenEnv, '/api/alerts/123/read', { method: 'PATCH' })
    expect(mRes.status).toBe(503)
  })
})
