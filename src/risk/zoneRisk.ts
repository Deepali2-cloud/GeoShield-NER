import type { Zone } from '../types'
import { INPUT_LIMITS } from './config'
import { calculateRisk } from './engine'
import type { RiskResult } from './engine'
import { normalizeElevation, normalizeRainfall72h, normalizeSlope } from './normalize'

export type ZoneAssessment = { ok: true; result: RiskResult } | { ok: false; errors: string[] }

type LimitKey = keyof typeof INPUT_LIMITS
const NAMES: Record<LimitKey, string> = {
  rainfall72hMm: 'Rainfall (past 72 h)',
  slopeDeg: 'Slope angle',
  elevationM: 'Elevation',
  soilScore: 'Soil score',
  historicalScore: 'Historical susceptibility',
}

/** Validates RAW zone inputs against physical limits. Invalid values are reported, never replaced. */
export function validateZoneInputs(zone: Zone): string[] {
  const errors: string[] = []
  for (const key of Object.keys(INPUT_LIMITS) as LimitKey[]) {
    const { min, max, unit } = INPUT_LIMITS[key]
    const v: unknown = zone.inputs?.[key]?.value
    if (v === undefined || v === null) errors.push(`${NAMES[key]}: missing`)
    else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${NAMES[key]}: must be a finite number`)
    else if (v < min || v > max) errors.push(`${NAMES[key]}: must be between ${min} and ${max} ${unit} (got ${v})`)
  }
  return errors
}

/** Raw zone inputs -> five normalized factors -> weighted score. */
export function assessZone(zone: Zone): ZoneAssessment {
  const errors = validateZoneInputs(zone)
  if (errors.length > 0) return { ok: false, errors }
  const i = zone.inputs
  const calc = calculateRisk({
    rainfall: normalizeRainfall72h(i.rainfall72hMm.value),
    slope: normalizeSlope(i.slopeDeg.value),
    historical: i.historicalScore.value,
    soil: i.soilScore.value,
    terrain: normalizeElevation(i.elevationM.value),
  })
  return calc.ok ? { ok: true, result: calc.value } : { ok: false, errors: calc.errors }
}
