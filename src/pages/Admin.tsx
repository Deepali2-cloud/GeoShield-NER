import { useCallback, useEffect, useState } from 'react'
import {
  checkAdminSession,
  fetchAdminReports,
  loginAdmin,
  logoutAdmin,
  updateReportStatus,
} from '../api/adminApi'
import { REPORT_CATEGORIES, REPORT_STATUSES } from '../types/api'
import type { ApiReport, ModerationStatus, ReportStatus } from '../types/api'
import { useZones } from '../hooks/useZones'
import type { ReportFilters } from '../api/reportsApi'

function StatusBadge({ status }: { status: ReportStatus }) {
  const styles: Record<ReportStatus, string> = {
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    reviewed: 'bg-blue-100 text-blue-800 border-blue-200',
    resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    rejected: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  const labels: Record<ReportStatus, string> = {
    pending: 'Pending review',
    reviewed: 'Reviewed',
    resolved: 'Resolved',
    rejected: 'Rejected',
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${styles[status]}`}>
      {labels[status] || status}
    </span>
  )
}

export default function Admin() {
  const { state: zonesState } = useZones()
  const zones = zonesState.status === 'success' ? zonesState.data.zones : []
  const zoneMap = new Map(zones.map((z) => [z.id, z.name]))

  // Session state
  const [checkingSession, setCheckingSession] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [adminId, setAdminId] = useState<string | null>(null)

  // Login form state
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  // Moderation reports state
  const [reportsState, setReportsState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'success'; reports: ApiReport[] } | { status: 'error'; error: string }
  >({ status: 'idle' })
  const [filters, setFilters] = useState<ReportFilters>({})
  const [reportsAttempt, setReportsAttempt] = useState(0)

  // Action / Confirmation modal state
  const [pendingAction, setPendingAction] = useState<{
    report: ApiReport
    nextStatus: ModerationStatus
  } | null>(null)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  // Check session on mount
  useEffect(() => {
    let active = true
    checkAdminSession()
      .then((data) => {
        if (!active) return
        setIsAuthenticated(true)
        setAdminId(data.adminId)
        setCheckingSession(false)
      })
      .catch(() => {
        if (!active) return
        setIsAuthenticated(false)
        setAdminId(null)
        setCheckingSession(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    let active = true
    fetchAdminReports(filters)
      .then((data) => {
        if (!active) return
        setReportsState({ status: 'success', reports: data })
      })
      .catch((err: unknown) => {
        if (!active) return
        setReportsState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load reports queue.',
        })
      })

    return () => {
      active = false
    }
  }, [isAuthenticated, filters, reportsAttempt])

  const loadReports = useCallback(() => {
    setReportsState({ status: 'loading' })
    setReportsAttempt((a) => a + 1)
  }, [])

  const reports = reportsState.status === 'success' ? reportsState.reports : []
  const loadingReports = reportsState.status === 'loading'
  const reportsError = reportsState.status === 'error' ? reportsState.error : null

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim() || loggingIn) return

    setLoggingIn(true)
    setLoginError(null)

    try {
      const data = await loginAdmin(password)
      setIsAuthenticated(true)
      setAdminId(data.adminId)
      setPassword('')
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Invalid credentials.')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    try {
      await logoutAdmin()
    } finally {
      setIsAuthenticated(false)
      setAdminId(null)
      setReportsState({ status: 'idle' })
    }
  }

  const handleConfirmStatusChange = async () => {
    if (!pendingAction || actionInProgress) return

    const { report, nextStatus } = pendingAction
    setActionInProgress(true)
    setActionFeedback(null)

    try {
      const result = await updateReportStatus(report.id, nextStatus)
      // Update local reports list with new status
      setReportsState((prev) => {
        if (prev.status !== 'success') return prev
        return {
          status: 'success',
          reports: prev.reports.map((r) => (r.id === report.id ? result.report : r)),
        }
      })
      setActionFeedback(
        `Report "${report.title}" status changed to ${nextStatus}. Audit ID: ${result.audit.id.slice(0, 8)}…`
      )
      setPendingAction(null)
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Failed to update report status.')
    } finally {
      setActionInProgress(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="py-16 text-center">
        <p role="status" className="text-sm text-slate-500">
          Checking administrator authorization…
        </p>
      </div>
    )
  }

  // Unauthenticated State: Show Login Form
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-md py-8">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="border-b border-slate-100 pb-4 text-center">
            <span className="inline-block rounded-full bg-navy-100 p-2.5 text-navy-800">
              🔒
            </span>
            <h1 className="mt-2 text-lg font-bold text-slate-900">Administrator Access</h1>
            <p className="mt-1 text-xs text-slate-500">
              Sign in with your server-configured admin secret to access the report moderation queue.
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-5 space-y-4">
            {loginError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <p className="font-semibold">{loginError}</p>
              </div>
            )}

            <div>
              <label htmlFor="admin-password" className="block text-xs font-medium text-slate-700">
                Administrator Password
              </label>
              <input
                id="admin-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password…"
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
              />
            </div>

            <button
              type="submit"
              disabled={loggingIn || !password.trim()}
              className="w-full rounded-lg bg-navy-800 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-600 disabled:opacity-50 transition-colors"
            >
              {loggingIn ? 'Authenticating…' : 'Sign In as Administrator'}
            </button>
          </form>

          <p className="mt-4 border-t border-slate-100 pt-3 text-center text-[11px] text-slate-400">
            Phase 8 • Single-administrator server-side authentication
          </p>
        </div>
      </div>
    )
  }

  // Authenticated State: Moderation Queue
  return (
    <div className="space-y-6">
      {/* Admin Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">Report Moderation Workspace</h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              Authenticated: {adminId}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Review, verify, and resolve incoming community hazard reports. Actions generate an append-only audit trail.
          </p>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        >
          Sign Out
        </button>
      </div>

      {actionFeedback && (
        <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs font-medium text-blue-900">
          {actionFeedback}
        </div>
      )}

      {/* Moderation Queue Filter Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="admin-filter-status" className="block text-xs font-medium text-slate-600">
              Status Filter
            </label>
            <select
              id="admin-filter-status"
              value={filters.status ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              <option value="">All Statuses</option>
              {REPORT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="admin-filter-zone" className="block text-xs font-medium text-slate-600">
              Zone Filter
            </label>
            <select
              id="admin-filter-zone"
              value={filters.zoneId ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, zoneId: e.target.value || undefined }))}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              <option value="">All Zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="admin-filter-category" className="block text-xs font-medium text-slate-600">
              Category Filter
            </label>
            <select
              id="admin-filter-category"
              value={filters.category ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              <option value="">All Categories</option>
              {REPORT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={loadReports}
              disabled={loadingReports}
              className="w-full rounded bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-navy-900 disabled:opacity-50"
            >
              {loadingReports ? 'Refreshing…' : 'Refresh Queue'}
            </button>
          </div>
        </div>
      </div>

      {/* Reports Queue List */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Reports Queue ({reports.length})
          </h2>
        </div>

        <div className="p-4">
          {loadingReports && (
            <p role="status" className="py-8 text-center text-sm text-slate-500">
              Loading reports queue…
            </p>
          )}

          {reportsError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-sm text-red-800">{reportsError}</p>
              <button
                type="button"
                onClick={loadReports}
                className="mt-3 rounded border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-900"
              >
                Retry
              </button>
            </div>
          )}

          {!loadingReports && !reportsError && reports.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-500">
              <p className="font-medium text-slate-700">No reports in this queue</p>
              <p className="mt-1 text-xs text-slate-400">All reports matching the criteria have been reviewed or none exist.</p>
            </div>
          )}

          {!loadingReports && reports.length > 0 && (
            <ul className="divide-y divide-slate-100" aria-label="Moderation reports">
              {reports.map((report) => {
                const zoneName = zoneMap.get(report.zoneId) ?? report.zoneId
                const hasCoords = report.latitude !== null && report.longitude !== null

                return (
                  <li key={report.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">{report.title}</span>
                        <StatusBadge status={report.status} />
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">{report.category}</span>
                        <span>Zone: <strong className="text-slate-800">{zoneName}</strong></span>
                        <span>Submitted: {new Date(report.createdAt).toLocaleString()}</span>
                        <span className="font-mono text-[10px] text-slate-400">ID: {report.id}</span>
                      </div>

                      <p className="text-xs leading-relaxed text-slate-700 bg-slate-50 p-2.5 rounded border border-slate-100">
                        {report.description}
                      </p>

                      {hasCoords && (
                        <p className="text-xs text-slate-500">
                          📍 Coordinates: <strong>{report.latitude?.toFixed(4)}, {report.longitude?.toFixed(4)}</strong>
                        </p>
                      )}

                      {/* Moderation Action Buttons */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                        <span className="text-xs font-semibold text-slate-600 mr-1">Change Status:</span>

                        {report.status !== 'reviewed' && (
                          <button
                            type="button"
                            onClick={() => setPendingAction({ report, nextStatus: 'reviewed' })}
                            className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-900 hover:bg-blue-100"
                          >
                            Mark Reviewed
                          </button>
                        )}

                        {report.status !== 'resolved' && (
                          <button
                            type="button"
                            onClick={() => setPendingAction({ report, nextStatus: 'resolved' })}
                            className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                          >
                            Mark Resolved
                          </button>
                        )}

                        {report.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => setPendingAction({ report, nextStatus: 'rejected' })}
                            className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-900 hover:bg-red-100"
                          >
                            Reject Report
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {pendingAction && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 id="confirm-modal-title" className="text-sm font-bold text-slate-900">
              Confirm Status Change
            </h3>
            <p className="mt-2 text-xs text-slate-600">
              Are you sure you want to mark report <strong>"{pendingAction.report.title}"</strong> as{' '}
              <strong className="uppercase">{pendingAction.nextStatus}</strong>?
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              This action will be logged in the permanent audit trail with your administrator identity.
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={actionInProgress}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusChange}
                disabled={actionInProgress}
                className="rounded bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-navy-900 disabled:opacity-50"
              >
                {actionInProgress ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
