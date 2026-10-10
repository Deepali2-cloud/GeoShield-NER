import { usePredictions } from '../hooks/usePredictions'
import { formatScore } from '../utils/riskDisplay'
import { RiskBadge } from './RiskBadge'
export function PredictionHistory({ zoneId }: { zoneId: string }) {
  const { state, load } = usePredictions(zoneId)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-slate-800">Risk History</h3>
      <div className="mt-2 max-h-48 overflow-y-auto pr-1">
        {state.status === 'loading' && <p className="text-xs text-slate-500" role="status">Loading history…</p>}
        {state.status === 'error' && (
          <div role="alert" className="text-xs text-red-600">
            <p>{state.error}</p>
            <button
              type="button"
              onClick={() => load(zoneId)}
              className="mt-1 font-semibold underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}
        {state.status === 'success' && state.data.length === 0 && (
          <p className="text-xs text-slate-500">No previous risk assessments recorded.</p>
        )}
        {state.status === 'success' && state.data.length > 0 && (
          <ul className="space-y-2">
            {state.data.map(pred => (
              <li key={pred.id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{formatScore(pred.riskScore)}</span>
                    <RiskBadge level={pred.riskLevel} />
                  </div>
                  <p className="text-[10px] text-slate-500">{new Date(pred.createdAt).toLocaleString()} · {pred.inputProvenance === 'demo' ? 'Demo' : 'Live'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
