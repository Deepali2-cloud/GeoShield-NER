import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ZonesData } from '../api/zonesApi'
import { EmptyState, ErrorState, LoadingState } from '../components/ApiState'
import { DemoDataNotice } from '../components/DemoDataNotice'
import { RiskBadge } from '../components/RiskBadge'
import { RiskLegend } from '../components/RiskLegend'
import { ScoreMethodCard } from '../components/ScoreMethodCard'
import { SelectedZonePanel } from '../components/SelectedZonePanel'
import { SummaryCard } from '../components/SummaryCard'
import { WeatherPanel } from '../components/WeatherPanel'
import { ZoneList } from '../components/ZoneList'
import { ZoneMap } from '../map/ZoneMap'
import { RISK_THRESHOLDS } from '../risk/config'
import { useWeather } from '../hooks/useWeather'
import { useZones } from '../hooks/useZones'
import { formatScore } from '../utils/riskDisplay'

import { AlertsPanel } from '../components/AlertsPanel'
import { useAlerts } from '../hooks/useAlerts'

function Loaded({ data }: { data: ZonesData }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { zones, assessments } = data
  // Starts only after zones have loaded and never blocks them: a weather failure leaves map and list working.
  const { state: weather, reload: reloadWeather } = useWeather()
  const { state: alertsState } = useAlerts()
  const selected = zones.find((z) => z.id === selectedId) ?? null
  const selectedAssessment = selected ? assessments[selected.id] : null

  const scored = zones.flatMap((z) => {
    const a = assessments[z.id]
    return a.ok ? [{ zone: z, result: a.result }] : []
  })
  const top = scored.length ? scored.reduce((a, b) => (b.result.score > a.result.score ? b : a)) : null
  const elevated = scored.filter((s) => s.result.level === 'HIGH' || s.result.level === 'CRITICAL').length

  const activeAlertsCount = alertsState.status === 'success' ? alertsState.data.filter(a => !a.isRead).length : '...'

  return (
    <>
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Monitored zones" value={zones.length} hint="Seeded demo zones" />
        <SummaryCard
          label="Highest calculated score"
          value={top ? <span className="flex flex-wrap items-center gap-2">{top.zone.name} <RiskBadge level={top.result.level} /></span> : 'n/a'}
          hint={top ? `Score ${formatScore(top.result.score)} (demo inputs)` : 'No valid zone scores'}
        />
        <SummaryCard label="HIGH or CRITICAL" value={elevated} hint={`Zones scoring ${RISK_THRESHOLDS.HIGH}+ (demo inputs)`} />
        <SummaryCard label="Active alerts" value={activeAlertsCount} hint="Unread alerts" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-200/60 bg-gradient-to-r from-navy-900 to-navy-800 p-4 text-white shadow-sm">
            <div>
              <h2 className="text-sm font-semibold">Community Hazard Reporting</h2>
              <p className="mt-0.5 text-xs text-slate-300">
                Witnessed landslides, rockfalls, or road blockages? Submit an anonymous citizen report.
              </p>
            </div>
            <Link
              to="/report"
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 shadow hover:bg-slate-100 transition-colors"
            >
              Report a Hazard →
            </Link>
          </div>
          <AlertsPanel />
          <ZoneMap zones={zones} assessments={assessments} selectedId={selectedId} onSelect={setSelectedId} />
          <RiskLegend />
          <WeatherPanel state={weather} reload={reloadWeather} selectedId={selectedId} />
          <ScoreMethodCard />
        </div>
        <div className="space-y-4">
          <ZoneList zones={zones} assessments={assessments} selectedId={selectedId} onSelect={setSelectedId} />
          <SelectedZonePanel zone={selected} assessment={selectedAssessment} weather={weather} onReloadWeather={reloadWeather} />
        </div>
      </div>
    </>
  )
}

export default function Dashboard() {
  const { state, reload } = useZones()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Six seeded Northeast India zones. Select one to inspect it.</p>
        <DemoDataNotice />
      </div>

      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
      {state.status === 'success' && (state.data.zones.length === 0 ? <EmptyState /> : <Loaded data={state.data} />)}
    </div>
  )
}
