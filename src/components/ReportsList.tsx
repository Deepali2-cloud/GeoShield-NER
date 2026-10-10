import { useState } from 'react'
import { REPORT_CATEGORIES, REPORT_STATUSES } from '../types/api'
import type { ReportStatus } from '../types/api'
import type { Zone } from '../types'
import type { ReportFilters } from '../api/reportsApi'
import type { ReportsState } from '../hooks/useReports'

interface ReportsListProps {
  zones: Zone[]
  state: ReportsState
  filters: ReportFilters
  onFilterChange: (filters: ReportFilters) => void
  onRetry: () => void
  onLocateCoordinates?: (lat: number, lng: number, title: string) => void
}

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
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {labels[status] || status}
    </span>
  )
}

export function ReportsList({
  zones,
  state,
  filters,
  onFilterChange,
  onRetry,
  onLocateCoordinates,
}: ReportsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const zoneMap = new Map(zones.map((z) => [z.id, z.name]))

  const handleZoneFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ ...filters, zoneId: e.target.value || undefined })
  }

  const handleCategoryFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ ...filters, category: e.target.value || undefined })
  }

  const handleStatusFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ ...filters, status: e.target.value || undefined })
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <section aria-labelledby="reports-list-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="reports-list-heading" className="text-base font-semibold text-slate-900">
            Community Reports
          </h2>
          <span className="text-xs text-slate-500">Unverified public observations</span>
        </div>

        {/* Filters */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label htmlFor="filter-zone" className="sr-only">Filter by zone</label>
            <select
              id="filter-zone"
              value={filters.zoneId ?? ''}
              onChange={handleZoneFilter}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
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
            <label htmlFor="filter-category" className="sr-only">Filter by category</label>
            <select
              id="filter-category"
              value={filters.category ?? ''}
              onChange={handleCategoryFilter}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
            >
              <option value="">All Categories</option>
              {REPORT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="sr-only">Filter by status</label>
            <select
              id="filter-status"
              value={filters.status ?? ''}
              onChange={handleStatusFilter}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
            >
              <option value="">All Statuses</option>
              {REPORT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Body States */}
      <div className="p-4">
        {state.status === 'loading' && (
          <p role="status" className="py-8 text-center text-sm text-slate-500">
            Loading community reports…
          </p>
        )}

        {state.status === 'error' && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm text-red-800">{state.error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-red-900 border border-red-300 shadow-sm hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === 'success' && state.data.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">
            <p className="font-medium text-slate-700">No hazard reports found</p>
            <p className="mt-1 text-xs text-slate-400">
              No reports match your current filter criteria.
            </p>
          </div>
        )}

        {state.status === 'success' && state.data.length > 0 && (
          <ul className="divide-y divide-slate-100" aria-label="Hazard reports">
            {state.data.map((report) => {
              const isExpanded = expandedId === report.id
              const zoneName = zoneMap.get(report.zoneId) ?? report.zoneId
              const hasCoords = report.latitude !== null && report.longitude !== null

              return (
                <li key={report.id} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{report.title}</span>
                      <StatusBadge status={report.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                        {report.category}
                      </span>
                      <span>Zone: <strong className="text-slate-700">{zoneName}</strong></span>
                      <span>{new Date(report.createdAt).toLocaleString()}</span>
                    </div>

                    <p className={`mt-1 text-xs leading-relaxed text-slate-600 ${isExpanded ? '' : 'line-clamp-2'}`}>
                      {report.description}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      {report.description.length > 120 && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(report.id)}
                          className="font-medium text-navy-700 hover:text-navy-900 underline"
                        >
                          {isExpanded ? 'Show less' : 'Read full description'}
                        </button>
                      )}

                      {hasCoords && onLocateCoordinates && (
                        <button
                          type="button"
                          onClick={() => onLocateCoordinates(report.latitude!, report.longitude!, report.title)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          📍 Map ({report.latitude?.toFixed(3)}, {report.longitude?.toFixed(3)})
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

      <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-[11px] text-slate-500">
        Reports are public submissions pending official review and do not alter calculated risk scores.
      </div>
    </section>
  )
}
