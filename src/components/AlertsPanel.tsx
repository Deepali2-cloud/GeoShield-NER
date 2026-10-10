import { useAlerts } from '../hooks/useAlerts'
import { RiskBadge } from './RiskBadge'
import { formatScore } from '../utils/riskDisplay'
export function AlertsIndicator() {
  const { state } = useAlerts()
  if (state.status !== 'success') return null
  const unreadCount = state.data.filter(a => !a.isRead).length
  if (unreadCount === 0) return null
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
      {unreadCount}
    </span>
  )
}

export function AlertsPanel() {
  const { state, reload, markRead } = useAlerts()

  return (
    <section aria-labelledby="alerts-heading" className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <h2 id="alerts-heading" className="font-semibold text-slate-800">Recent Alerts</h2>
        <AlertsIndicator />
      </div>
      <div className="p-4">
        {state.status === 'loading' && (
          <p className="text-sm text-slate-500" role="status">Loading alerts…</p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>{state.error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-2 text-xs font-semibold underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}
        {state.status === 'success' && state.data.length === 0 && (
          <p className="text-sm text-slate-500">No active alerts.</p>
        )}
        {state.status === 'success' && state.data.length > 0 && (
          <ul className="space-y-3">
            {state.data.map(alert => (
              <li key={alert.id} className={`flex items-start justify-between rounded-lg border p-3 ${alert.isRead ? 'border-slate-200 bg-slate-50' : 'border-red-200 bg-red-50'}`}>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-slate-900">{alert.message}</strong>
                    <RiskBadge level={alert.riskLevel} />
                  </div>
                  <p className="text-xs text-slate-500">
                    Score: {formatScore(alert.riskScore)} • {new Date(alert.createdAt).toLocaleString()} • {alert.inputProvenance === 'demo' ? 'Demo data' : 'Live data'}
                  </p>
                </div>
                {!alert.isRead && (
                  <button onClick={() => markRead(alert.id)} className="ml-4 shrink-0 rounded bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-accent">
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
