import { RISK_LEVELS, RISK_STYLES } from '../utils/riskDisplay'
import { RiskBadge } from './RiskBadge'

export function RiskLegend() {
  return (
    <section aria-labelledby="legend-title" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="legend-title" className="text-sm font-semibold text-slate-900">Risk legend</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {RISK_LEVELS.map((level) => (
          <li key={level} className="flex min-w-0 items-start gap-3 rounded-lg bg-slate-50 p-2.5">
            <span className="shrink-0"><RiskBadge level={level} /></span>
            <span className="text-xs text-slate-600">
              <span className="block font-medium text-slate-800">Score {RISK_STYLES[level].range}</span>
              {RISK_STYLES[level].meaning}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
