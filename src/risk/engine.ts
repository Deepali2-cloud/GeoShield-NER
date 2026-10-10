import type { RiskLevel } from '../types'
import { FACTOR_KEYS, FACTOR_LABELS, HIGH_FACTOR_CUTOFF, MODEL_VERSION, RISK_THRESHOLDS, WEIGHTS } from './config'
import type { FactorKey } from './config'

/**
 * Deterministic, rule-based weighted score. This is NOT machine learning and NOT a validated
 * landslide prediction. Pure: no React, network, storage, clock or mutation.
 */

export type RiskFactors = Record<FactorKey, number>

export interface RiskResult {
  /** 0-100, rounded to 1 decimal. */
  score: number
  /** Assigned from the ROUNDED score. */
  level: RiskLevel
  /** The five normalized inputs (each 0-100). */
  factors: RiskFactors
  /** weight * factor for each input, unrounded. Sums to the unrounded score. */
  contributions: RiskFactors
  weights: Readonly<RiskFactors>
  explanation: string[]
  modelVersion: string
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/**
 * Round to 1 decimal, half up. toPrecision(12) strips binary floating-point noise first, so a value
 * that is mathematically 29.95 rounds to 30.0 rather than 29.9.
 */
export function roundScore(x: number): number {
  return Math.round(Number((x * 10).toPrecision(12))) / 10
}

/** Level for a score that has ALREADY been rounded to 1 decimal. */
export function levelFromScore(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.CRITICAL) return 'CRITICAL'
  if (score >= RISK_THRESHOLDS.HIGH) return 'HIGH'
  if (score >= RISK_THRESHOLDS.MODERATE) return 'MODERATE'
  return 'LOW'
}

/** Returns a list of problems; empty means the five normalized factors are valid. Never coerces. */
export function validateFactors(input: Partial<Record<FactorKey, unknown>>): string[] {
  const errors: string[] = []
  for (const key of FACTOR_KEYS) {
    const name = FACTOR_LABELS[key].name
    const v = input[key]
    if (v === undefined || v === null) errors.push(`${name}: missing`)
    else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${name}: must be a finite number`)
    else if (v < 0 || v > 100) errors.push(`${name}: must be between 0 and 100 (got ${v})`)
  }
  return errors
}

function explain(factors: RiskFactors, contributions: RiskFactors): string[] {
  const high = FACTOR_KEYS.filter((k) => factors[k] >= HIGH_FACTOR_CUTOFF).sort((a, b) => contributions[b] - contributions[a])
  if (high.length === 0) {
    return [`No factor is individually high (all below ${HIGH_FACTOR_CUTOFF}/100); the score reflects combined moderate contributions.`]
  }
  return high.map((k) => `${FACTOR_LABELS[k].name} is high (${factors[k].toFixed(1)}/100, weight ${WEIGHTS[k].toFixed(2)})`)
}

export function calculateRisk(input: Partial<Record<FactorKey, number>>): Validation<RiskResult> {
  const errors = validateFactors(input)
  if (errors.length > 0) return { ok: false, errors }

  const factors = {} as RiskFactors
  const contributions = {} as RiskFactors
  let sum = 0
  for (const key of FACTOR_KEYS) {
    const v = input[key] as number
    factors[key] = v
    contributions[key] = WEIGHTS[key] * v
    sum += contributions[key]
  }
  // Valid inputs cannot leave [0, 100] mathematically; this clamp only absorbs floating-point error.
  const score = roundScore(Math.min(100, Math.max(0, sum)))

  return {
    ok: true,
    value: {
      score,
      level: levelFromScore(score),
      factors,
      contributions,
      weights: WEIGHTS,
      explanation: explain(factors, contributions),
      modelVersion: MODEL_VERSION,
    },
  }
}
