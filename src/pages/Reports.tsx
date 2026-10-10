import { useState } from 'react'
import { ReportForm } from '../components/ReportForm'
import { ReportsList } from '../components/ReportsList'
import { useReports } from '../hooks/useReports'
import { useZones } from '../hooks/useZones'
import { LoadingState } from '../components/ApiState'

export default function Reports() {
  const { state: zonesState } = useZones()
  const { state: reportsState, reload: reloadReports, filters, setFilters } = useReports()
  const [activeTab, setActiveTab] = useState<'form' | 'list'>('form')

  const zones = zonesState.status === 'success' ? zonesState.data.zones : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Citizen Hazard Reporting</h1>
            <p className="mt-1 text-sm text-slate-600">
              Report local hazards like landslides, cracks, rockfalls, or road blockages to inform monitoring in Northeast India.
            </p>
          </div>
          <span className="rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy-800 border border-navy-100">
            Phase 7 • Public MVP
          </span>
        </div>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
          <p>
            <strong>Important disclaimer:</strong> Citizen reports are community-submitted and unverified. All new submissions are marked as <code>pending</code> review and do not alter official calculated hazard levels or emergency services dispatch.
          </p>
        </div>

        {/* Mobile Tab Selector */}
        <div className="mt-4 flex border-b border-slate-200 lg:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('form')}
            className={`flex-1 py-2 text-center text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'form'
                ? 'border-navy-800 text-navy-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Submit Report
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2 text-center text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'list'
                ? 'border-navy-800 text-navy-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Community Reports
          </button>
        </div>
      </div>

      {zonesState.status === 'loading' && <LoadingState />}

      {zonesState.status === 'error' && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Could not load monitoring zones for hazard reporting. Please check your connection.
        </div>
      )}

      {zonesState.status === 'success' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: Report Form */}
          <div className={`lg:col-span-5 ${activeTab === 'form' ? 'block' : 'hidden lg:block'}`}>
            <ReportForm zones={zones} onReportCreated={() => reloadReports()} />
          </div>

          {/* Right: Reports List */}
          <div className={`lg:col-span-7 ${activeTab === 'list' ? 'block' : 'hidden lg:block'}`}>
            <ReportsList
              zones={zones}
              state={reportsState}
              filters={filters}
              onFilterChange={setFilters}
              onRetry={reloadReports}
            />
          </div>
        </div>
      )}
    </div>
  )
}
