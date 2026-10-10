import type { D1Like } from './db'
import type { ApiZone } from '../src/types/api'

export async function recordHistoryAndAlerts(db: D1Like, zones: ApiZone[]): Promise<void> {
  const now = new Date().toISOString()
  for (const zone of zones) {
    if (!zone.assessment.ok) continue

    const { score, level } = zone.assessment.result
    const inputProvenance = zone.inputs.rainfall72hMm.source === 'demo' ? 'demo' : 'live' // Simplification based on existing demo check

    // Get the last recorded prediction for this zone
    let lastPrediction: { risk_score: number, risk_level: string } | null
    try {
      lastPrediction = await db.prepare(
        'SELECT risk_score, risk_level FROM prediction_history WHERE zone_id = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(zone.id).first<{ risk_score: number, risk_level: string }>()
    } catch (err) {
      console.error(`[history] failed to fetch last prediction for zone ${zone.id}:`, err)
      continue // Skip on DB error
    }

    // Deduplication rule: Only record if score or level changed, or if there is no previous prediction
    if (!lastPrediction || lastPrediction.risk_score !== score || lastPrediction.risk_level !== level) {
      const predId = crypto.randomUUID()
      try {
        await db.prepare(
          'INSERT INTO prediction_history (id, zone_id, risk_score, risk_level, created_at, input_provenance) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(predId, zone.id, score, level, now, inputProvenance).run()
      } catch (err) {
        console.error(`[history] failed to insert prediction for zone ${zone.id}:`, err)
      }

      // Check alert conditions
      const previousLevel = lastPrediction ? lastPrediction.risk_level : 'LOW'
      const previousScore = lastPrediction ? lastPrediction.risk_score : 0

      let shouldAlert = false
      if (score >= 50 && previousScore < 50) {
        shouldAlert = true
      } else if (level === 'CRITICAL' && previousLevel !== 'CRITICAL') {
        shouldAlert = true
      } else if (!lastPrediction && score >= 50) {
        // Initial High/Critical alert generation
        shouldAlert = true
      }

      if (shouldAlert) {
        const alertId = crypto.randomUUID()
        const message = `Risk level for ${zone.name} is now ${level} (Score: ${score}).`
        try {
          await db.prepare(
            'INSERT INTO alerts (id, zone_id, risk_score, risk_level, created_at, is_read, message, input_provenance) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
          ).bind(alertId, zone.id, score, level, now, message, inputProvenance).run()
        } catch (err) {
          console.error(`[history] failed to insert alert for zone ${zone.id}:`, err)
        }
      }
    }
  }
}
