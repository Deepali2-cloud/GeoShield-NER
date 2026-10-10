import type { ZoneAssessment } from '../risk/zoneRisk'
import type { Zone } from '../types'
import { RISK_STYLES, UNAVAILABLE_STYLE, formatScore } from '../utils/riskDisplay'
import { RiskBadge, UnavailableBadge } from './RiskBadge'

interface Props {
  zones: Zone[]
  assessments: Record<string, ZoneAssessment>
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ZoneList({ zones, assessments, selectedId, onSelect }: Props) {
  return (
    <section aria-labelledby="zones-title" className="rounded-xl border border-slate-200 bg-white">
      <h2 id="zones-title" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
        Monitoring zones <span className="font-normal text-slate-500">({zones.length})</span>
      </h2>
      <ul className="divide-y divide-slate-100">
        {zones.map((z) => {
          const selected = z.id === selectedId
          const a = assessments[z.id]
          const border = a?.ok ? RISK_STYLES[a.result.level].border : UNAVAILABLE_STYLE.border
          return (
            <li key={z.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(z.id)}
                className={`flex w-full items-center justify-between gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${border} ${selected ? 'bg-sky-50' : ''}`}
              >
                <span>
                  <span className="block text-sm font-medium text-slate-900">{z.name}</span>
                  <span className="block text-xs text-slate-500">{z.state}</span>
                </span>
                <span className="flex items-center gap-2">
                  {a?.ok ? (
                    <>
                      <span className="text-xs tabular-nums text-slate-600" data-testid={`list-score-${z.id}`}>{formatScore(a.result.score)}</span>
                      <RiskBadge level={a.result.level} />
                    </>
                  ) : (
                    <UnavailableBadge />
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
