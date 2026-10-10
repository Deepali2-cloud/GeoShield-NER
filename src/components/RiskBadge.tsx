import type { RiskLevel } from '../types'
import { RISK_STYLES, UNAVAILABLE_STYLE } from '../utils/riskDisplay'

export function RiskBadge({ level }: { level: RiskLevel }) {
  const s = RISK_STYLES[level]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${s.badge}`}>
      <span aria-hidden="true">{s.shape}</span>
      {level}
    </span>
  )
}

export function UnavailableBadge() {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${UNAVAILABLE_STYLE.badge}`}>
      <span aria-hidden="true">{UNAVAILABLE_STYLE.shape}</span>
      {UNAVAILABLE_STYLE.label.toUpperCase()}
    </span>
  )
}
