import { RISK_THRESHOLDS } from '../risk/config'
import type { RiskLevel } from '../types'

/** Display helpers only. The scoring engine arrives in Phase 3. */
export interface RiskStyle {
  label: string
  /** Distinct shape so level is not conveyed by colour alone */
  shape: string
  range: string
  meaning: string
  /** Tailwind classes (full literals so Tailwind can detect them) */
  badge: string
  dot: string
  border: string
  /** CSS custom property holding the solid colour (used by map markers) */
  solidVar: string
}

export const RISK_LEVELS: RiskLevel[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL']

export const RISK_STYLES: Record<RiskLevel, RiskStyle> = {
  LOW: {
    label: 'Low', shape: '●', range: `below ${RISK_THRESHOLDS.MODERATE}`, meaning: 'Normal monitoring',
    badge: 'bg-risk-low-bg text-risk-low border-risk-low/30',
    dot: 'text-risk-low-solid', border: 'border-l-risk-low-solid',
    solidVar: '--color-risk-low-solid',
  },
  MODERATE: {
    label: 'Moderate', shape: '▲', range: `${RISK_THRESHOLDS.MODERATE} to below ${RISK_THRESHOLDS.HIGH}`, meaning: 'Monitor conditions',
    badge: 'bg-risk-moderate-bg text-risk-moderate border-risk-moderate/30',
    dot: 'text-risk-moderate-solid', border: 'border-l-risk-moderate-solid',
    solidVar: '--color-risk-moderate-solid',
  },
  HIGH: {
    label: 'High', shape: '◆', range: `${RISK_THRESHOLDS.HIGH} to below ${RISK_THRESHOLDS.CRITICAL}`, meaning: 'Increased attention / inspection',
    badge: 'bg-risk-high-bg text-risk-high border-risk-high/30',
    dot: 'text-risk-high-solid', border: 'border-l-risk-high-solid',
    solidVar: '--color-risk-high-solid',
  },
  CRITICAL: {
    label: 'Critical', shape: '■', range: `${RISK_THRESHOLDS.CRITICAL} and above`, meaning: 'Immediate review (prototype)',
    badge: 'bg-risk-critical-bg text-risk-critical border-risk-critical/30',
    dot: 'text-risk-critical-solid', border: 'border-l-risk-critical-solid',
    solidVar: '--color-risk-critical-solid',
  },
}

export const DISCLAIMER =
  'GeoShield-NER is an experimental risk-indicator prototype, not an official emergency warning system. Follow instructions from local authorities.'

/** Shown instead of a score when a zone's inputs fail validation. Never a made-up score. */
export const UNAVAILABLE_STYLE = {
  label: 'Unavailable',
  shape: '?',
  badge: 'bg-slate-100 text-slate-700 border-slate-300',
  border: 'border-l-slate-400',
}

/** Scores are always shown with exactly one decimal, matching the engine's rounding. */
export const formatScore = (score: number): string => score.toFixed(1)
