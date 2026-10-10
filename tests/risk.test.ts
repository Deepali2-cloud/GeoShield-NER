import { DEMO_ZONES } from '../src/data/demoZones'
import { FACTOR_KEYS, RISK_THRESHOLDS, WEIGHTS } from '../src/risk/config'
import { calculateRisk, levelFromScore, roundScore } from '../src/risk/engine'
import { interpolate, normalizeElevation, normalizeRainfall72h, normalizeSlope } from '../src/risk/normalize'
import { assessZone, validateZoneInputs } from '../src/risk/zoneRisk'
import type { Zone } from '../src/types'

const uniform = (v: number) => ({ rainfall: v, slope: v, historical: v, soil: v, terrain: v })
const score = (f: Parameters<typeof calculateRisk>[0]) => {
  const r = calculateRisk(f)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.value
}

describe('weights', () => {
  it('match the SRS formula and total 1.0', () => {
    expect(WEIGHTS).toEqual({ rainfall: 0.35, slope: 0.25, historical: 0.2, soil: 0.1, terrain: 0.1 })
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })
})

describe('calculateRisk', () => {
  it('all factors 0 -> 0 LOW', () => {
    const r = score(uniform(0))
    expect(r.score).toBe(0)
    expect(r.level).toBe('LOW')
  })

  it('all factors 100 -> 100 CRITICAL', () => {
    const r = score(uniform(100))
    expect(r.score).toBe(100)
    expect(r.level).toBe('CRITICAL')
  })

  it('matches a manually calculated weighted sum', () => {
    // R=82 S=64 H=47 G=33 E=21
    // 0.35*82=28.7  0.25*64=16  0.20*47=9.4  0.10*33=3.3  0.10*21=2.1  => 59.5
    const r = score({ rainfall: 82, slope: 64, historical: 47, soil: 33, terrain: 21 })
    expect(r.score).toBe(59.5)
    expect(r.level).toBe('HIGH')
    expect(r.contributions.rainfall).toBeCloseTo(28.7, 10)
    expect(r.contributions.slope).toBeCloseTo(16, 10)
    expect(r.contributions.historical).toBeCloseTo(9.4, 10)
    expect(r.contributions.soil).toBeCloseTo(3.3, 10)
    expect(r.contributions.terrain).toBeCloseTo(2.1, 10)
    expect(FACTOR_KEYS.reduce((s, k) => s + r.contributions[k], 0)).toBeCloseTo(59.5, 10)
  })

  it('returns score, level, factors, weights, explanation and model version', () => {
    const r = score({ rainfall: 90, slope: 80, historical: 10, soil: 10, terrain: 10 })
    expect(r.factors.rainfall).toBe(90)
    expect(r.weights).toBe(WEIGHTS)
    expect(r.modelVersion).toBe('weighted-v1')
    expect(r.explanation.join(' ')).toMatch(/Rainfall.*high/)
    expect(r.explanation.join(' ')).toMatch(/Slope.*high/)
    expect(r.explanation.join(' ')).not.toMatch(/Soil.*high/)
  })

  it('explains when no single factor is high', () => {
    expect(score(uniform(40)).explanation[0]).toMatch(/No factor is individually high/)
  })

  it('is deterministic for identical inputs', () => {
    const f = { rainfall: 73.3, slope: 12.7, historical: 55.5, soil: 61.1, terrain: 8.8 }
    const a = calculateRisk(f)
    const b = calculateRisk({ ...f })
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('does not mutate its input', () => {
    const f = Object.freeze({ ...uniform(50) })
    expect(() => calculateRisk(f)).not.toThrow()
  })
})

describe('rounding and classification (D2)', () => {
  it.each([
    [29.9, 'LOW'],
    [30, 'MODERATE'],
    [49.9, 'MODERATE'],
    [50, 'HIGH'],
    [69.9, 'HIGH'],
    [70, 'CRITICAL'],
  ] as const)('score %s -> %s', (s, level) => {
    expect(levelFromScore(s)).toBe(level)
    const r = score(uniform(s)) // uniform factors give score == factor, since weights total 1
    expect(r.score).toBe(s)
    expect(r.level).toBe(level)
  })

  it('rounds to 1 decimal BEFORE classifying', () => {
    expect(score(uniform(29.94)).score).toBe(29.9)
    expect(score(uniform(29.94)).level).toBe('LOW')
    expect(score(uniform(29.95)).score).toBe(30)
    expect(score(uniform(29.95)).level).toBe('MODERATE')
    expect(score(uniform(49.96)).level).toBe('HIGH')
    expect(score(uniform(69.95)).level).toBe('CRITICAL')
  })

  it('roundScore handles floating-point noise and halves', () => {
    expect(roundScore(0.1 + 0.2)).toBe(0.3)
    expect(roundScore(23.25)).toBe(23.3)
    expect(roundScore(23.2499)).toBe(23.2)
  })

  it('exposes the agreed thresholds', () => {
    expect(RISK_THRESHOLDS).toEqual({ MODERATE: 30, HIGH: 50, CRITICAL: 70 })
  })
})

describe('input validation', () => {
  it('rejects missing factors and names them', () => {
    const r = calculateRisk({ rainfall: 10, slope: 10 } as never)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(3)
      expect(r.errors.join(' ')).toMatch(/Historical susceptibility: missing/)
    }
  })

  it('does not treat a missing value as zero', () => {
    expect(calculateRisk({ ...uniform(0), soil: undefined } as never).ok).toBe(false)
    expect(calculateRisk({ ...uniform(0), soil: null } as never).ok).toBe(false)
  })

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['negative', -0.1],
    ['above 100', 100.1],
    ['a numeric string', '50'],
  ])('rejects %s without producing a score', (_name, bad) => {
    const r = calculateRisk({ ...uniform(50), slope: bad } as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(1)
  })

  it('accepts the inclusive bounds 0 and 100', () => {
    expect(calculateRisk(uniform(0)).ok).toBe(true)
    expect(calculateRisk(uniform(100)).ok).toBe(true)
  })
})

describe('normalization bands', () => {
  it('interpolates linearly between control points and saturates above the last', () => {
    expect(normalizeRainfall72h(0)).toBe(0)
    expect(normalizeRainfall72h(25)).toBe(15)
    expect(normalizeRainfall72h(50)).toBeCloseTo(27.5, 10)
    expect(normalizeRainfall72h(250)).toBe(100)
    expect(normalizeRainfall72h(900)).toBe(100)
    expect(normalizeSlope(15)).toBe(25)
    expect(normalizeSlope(45)).toBe(100)
    expect(normalizeSlope(80)).toBe(100)
    expect(normalizeElevation(1000)).toBe(40)
    expect(normalizeElevation(2000)).toBeCloseTo(85, 10)
  })

  it('is monotonic non-decreasing and always within 0-100', () => {
    for (const fn of [normalizeRainfall72h, normalizeSlope, normalizeElevation]) {
      let prev = -1
      for (let x = 0; x <= 3000; x += 7) {
        const y = fn(x)
        expect(y).toBeGreaterThanOrEqual(prev)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(100)
        prev = y
      }
    }
    expect(interpolate([[0, 0], [10, 50]], 5)).toBe(25)
  })
})

describe('seeded zones', () => {
  it('has exactly six zones, each with all five sourced inputs marked demo', () => {
    expect(DEMO_ZONES).toHaveLength(6)
    for (const z of DEMO_ZONES) {
      expect(validateZoneInputs(z)).toEqual([])
      for (const input of Object.values(z.inputs)) {
        expect(Number.isFinite(input.value)).toBe(true)
        expect(input.source).toBe('demo')
      }
      expect(Object.keys(z.inputs).sort()).toEqual(['elevationM', 'historicalScore', 'rainfall72hMm', 'slopeDeg', 'soilScore'])
    }
  })

  it('every zone produces all five normalized factors in range', () => {
    for (const z of DEMO_ZONES) {
      const a = assessZone(z)
      expect(a.ok).toBe(true)
      if (a.ok) for (const k of FACTOR_KEYS) {
        expect(a.result.factors[k]).toBeGreaterThanOrEqual(0)
        expect(a.result.factors[k]).toBeLessThanOrEqual(100)
      }
    }
  })

  // Golden values calculated by hand from the bands in src/risk/config.ts.
  // Gangtok: R=70+(160-150)/100*30=73, S=60+(42-30)/15*40=92, E=70+(1650-1500)/1000*30=74.5, H=78, G=72
  //   0.35*73 + 0.25*92 + 0.20*78 + 0.10*72 + 0.10*74.5 = 25.55+23+15.6+7.2+7.45 = 78.8
  it.each([
    ['guwahati', 23.3, 'LOW'],
    ['itanagar', 34.5, 'MODERATE'],
    ['kohima', 44.8, 'MODERATE'],
    ['shillong', 57.1, 'HIGH'],
    ['aizawl', 63.3, 'HIGH'],
    ['gangtok', 78.8, 'CRITICAL'],
  ] as const)('%s scores %s (%s)', (id, expected, level) => {
    const a = assessZone(DEMO_ZONES.find((z) => z.id === id)!)
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.result.score).toBe(expected)
      expect(a.result.level).toBe(level)
    }
  })
})

describe('assessZone with invalid raw inputs', () => {
  const bad = (patch: Partial<Zone['inputs']>): Zone => ({
    ...DEMO_ZONES[0],
    inputs: { ...DEMO_ZONES[0].inputs, ...patch },
  })

  it('reports NaN, negative, out-of-range and missing inputs instead of inventing a score', () => {
    for (const patch of [
      { rainfall72hMm: { value: NaN, source: 'demo' as const } },
      { slopeDeg: { value: -5, source: 'demo' as const } },
      { slopeDeg: { value: 120, source: 'demo' as const } },
      { soilScore: { value: 101, source: 'demo' as const } },
      { elevationM: { value: Infinity, source: 'demo' as const } },
    ]) {
      const a = assessZone(bad(patch))
      expect(a.ok).toBe(false)
      if (!a.ok) expect(a.errors.length).toBeGreaterThan(0)
    }
    const missing = { ...DEMO_ZONES[0], inputs: { ...DEMO_ZONES[0].inputs, rainfall72hMm: undefined } } as unknown as Zone
    const a = assessZone(missing)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.errors[0]).toMatch(/Rainfall.*missing/)
  })
})
