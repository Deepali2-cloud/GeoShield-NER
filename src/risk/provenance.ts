import type { DataSource, ZoneInputs } from '../types'
import type { FactorKey } from './config'

/**
 * Where a zone's score came from. Pure and separate from the scoring maths: it never changes a score, weight,
 * rounding rule or level boundary. It only describes the `source` of the raw inputs the engine was given.
 *
 *   demo          every input is illustrative demo data                          (the case for all zones today)
 *   partial-live  some inputs are live/authoritative, others are still demo      (must NEVER be shown as "live")
 *   live          every one of the five inputs is live or authoritative
 *   unavailable   no score exists (invalid inputs)
 *
 * Phase 5 retrieves Open-Meteo weather but does NOT feed it into factor R, so every zone is `demo` here.
 * The weather data on the dashboard is shown beside the score and is not part of it.
 */
export type ScoreBasis = 'demo' | 'partial-live' | 'live' | 'unavailable'

export interface ScoreProvenance {
  basis: ScoreBasis
  /** Factors whose raw input is live or authoritative. */
  liveFactors: FactorKey[]
  /** Factors whose raw input is demo data. */
  demoFactors: FactorKey[]
}

/** Which raw input feeds each factor (same mapping as `assessZone`). */
const FACTOR_INPUT: Record<FactorKey, keyof ZoneInputs> = {
  rainfall: 'rainfall72hMm',
  slope: 'slopeDeg',
  historical: 'historicalScore',
  soil: 'soilScore',
  terrain: 'elevationM',
}

const isMeasured = (s: DataSource) => s === 'live' || s === 'authoritative'

export function scoreProvenance(inputs: ZoneInputs, scored: boolean): ScoreProvenance {
  const liveFactors: FactorKey[] = []
  const demoFactors: FactorKey[] = []
  for (const factor of Object.keys(FACTOR_INPUT) as FactorKey[]) {
    ;(isMeasured(inputs[FACTOR_INPUT[factor]].source) ? liveFactors : demoFactors).push(factor)
  }
  if (!scored) return { basis: 'unavailable', liveFactors, demoFactors }
  const basis: ScoreBasis = demoFactors.length === 0 ? 'live' : liveFactors.length === 0 ? 'demo' : 'partial-live'
  return { basis, liveFactors, demoFactors }
}
