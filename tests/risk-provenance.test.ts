import { DEMO_ZONES } from '../src/data/demoZones'
import { scoreProvenance } from '../src/risk/provenance'
import { assessZone } from '../src/risk/zoneRisk'
import { FACTOR_KEYS, RISK_THRESHOLDS, WEIGHTS } from '../src/risk/config'
import type { DataSource, ZoneInputs } from '../src/types'
import { INPUT_KEYS } from '../src/types/api'

const inputsWith = (sources: Partial<Record<keyof ZoneInputs, DataSource>>): ZoneInputs => {
  const base = structuredClone(DEMO_ZONES[0].inputs)
  for (const k of INPUT_KEYS) if (sources[k]) base[k].source = sources[k]!
  return base
}

describe('score provenance: exactly when a score is demo, live or unavailable', () => {
  it('is demo when all five inputs are demo (every seeded zone today)', () => {
    for (const z of DEMO_ZONES) {
      const a = assessZone(z)
      const p = scoreProvenance(z.inputs, a.ok)
      expect(p.basis).toBe('demo')
      expect(p.demoFactors).toHaveLength(5)
      expect(p.liveFactors).toEqual([])
    }
  })

  it('is partial-live, never "live", when only some inputs are live (e.g. live rainfall + demo terrain)', () => {
    const p = scoreProvenance(inputsWith({ rainfall72hMm: 'live' }), true)
    expect(p.basis).toBe('partial-live')
    expect(p.liveFactors).toEqual(['rainfall'])
    expect(p.demoFactors).toEqual(['slope', 'historical', 'soil', 'terrain'])
  })

  it('is live only when all five inputs are live or authoritative', () => {
    const all = inputsWith({ rainfall72hMm: 'live', slopeDeg: 'authoritative', elevationM: 'authoritative', soilScore: 'live', historicalScore: 'authoritative' })
    expect(scoreProvenance(all, true).basis).toBe('live')
    const fourOfFive = inputsWith({ rainfall72hMm: 'live', slopeDeg: 'live', elevationM: 'live', soilScore: 'live' })
    expect(scoreProvenance(fourOfFive, true).basis).toBe('partial-live')
  })

  it('is unavailable whenever there is no score, whatever the sources say', () => {
    expect(scoreProvenance(inputsWith({}), false).basis).toBe('unavailable')
    const bad = structuredClone(DEMO_ZONES[0])
    bad.inputs.rainfall72hMm.value = Number.NaN
    const a = assessZone(bad)
    expect(a.ok).toBe(false)
    expect(scoreProvenance(bad.inputs, a.ok).basis).toBe('unavailable')
  })

  it('maps each factor to its own input', () => {
    expect(scoreProvenance(inputsWith({ slopeDeg: 'live' }), true).liveFactors).toEqual(['slope'])
    expect(scoreProvenance(inputsWith({ historicalScore: 'live' }), true).liveFactors).toEqual(['historical'])
    expect(scoreProvenance(inputsWith({ soilScore: 'live' }), true).liveFactors).toEqual(['soil'])
    expect(scoreProvenance(inputsWith({ elevationM: 'live' }), true).liveFactors).toEqual(['terrain'])
  })
})

describe('Phase 3 model is unchanged by Phase 5', () => {
  it('keeps the formula weights, level boundaries and golden scores', () => {
    expect(WEIGHTS).toEqual({ rainfall: 0.35, slope: 0.25, historical: 0.2, soil: 0.1, terrain: 0.1 })
    expect(FACTOR_KEYS.reduce((s, k) => s + WEIGHTS[k], 0)).toBeCloseTo(1, 10)
    expect(RISK_THRESHOLDS).toEqual({ MODERATE: 30, HIGH: 50, CRITICAL: 70 })
    const scores = DEMO_ZONES.map((z) => {
      const a = assessZone(z)
      return a.ok ? a.result.score : null
    })
    expect(scores).toEqual([23.3, 34.5, 44.8, 57.1, 63.3, 78.8])
  })

  it('does not accept weather as an input: demo rainfall stays the only rainfall the engine sees', () => {
    // assessZone takes only zone inputs; there is no code path from a weather payload to a score.
    const z = structuredClone(DEMO_ZONES[0])
    const before = assessZone(z)
    expect(before.ok && before.result.factors.rainfall).toBeCloseTo(20, 5) // 35 mm demo -> 20/100 via the Phase 3 bands
  })
})
