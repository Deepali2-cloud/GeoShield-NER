import { FACTOR_KEYS, FACTOR_LABELS } from '../risk/config'
import type { FactorKey } from '../risk/config'
import type { ZoneAssessment } from '../risk/zoneRisk'
import type { DataSource, Zone, ZoneInputs } from '../types'
import { formatScore } from '../utils/riskDisplay'
import type { WeatherState } from '../hooks/useWeather'
import { scoreProvenance } from '../risk/provenance'
import type { ScoreBasis } from '../risk/provenance'
import { DemoDataNotice } from './DemoDataNotice'
import { RiskBadge, UnavailableBadge } from './RiskBadge'
import { ZoneWeatherDetail } from './WeatherPanel'
import { PredictionHistory } from './PredictionHistory'


/** Which raw input feeds each normalized factor, and how to print it. */
const RAW: Record<FactorKey, { key: keyof ZoneInputs; fmt: (v: number) => string }> = {
  rainfall: { key: 'rainfall72hMm', fmt: (v) => `${v} mm` },
  slope: { key: 'slopeDeg', fmt: (v) => `${v}°` },
  historical: { key: 'historicalScore', fmt: (v) => `${v}/100` },
  soil: { key: 'soilScore', fmt: (v) => `${v}/100` },
  terrain: { key: 'elevationM', fmt: (v) => `${v} m` },
}

const SOURCE_LABEL: Record<DataSource, string> = { demo: 'Demo input', live: 'Live input', authoritative: 'Authoritative input' }

const BASIS_TEXT: Record<ScoreBasis, string> = {
  demo: 'Demo-derived: all five inputs are illustrative demo data. The weather shown below is not used in this score.',
  'partial-live': 'Partly live: some inputs are live, the rest are still demo data. This is not a fully live score.',
  live: 'Live-derived: all five inputs are live or authoritative data.',
  unavailable: 'No score: inputs are invalid.',
}

interface Props {
  zone: Zone | null
  assessment: ZoneAssessment | null
  weather?: WeatherState
  onReloadWeather?: () => void
}

export function SelectedZonePanel({ zone, assessment, weather, onReloadWeather }: Props) {
  if (!zone || !assessment) {
    return (
      <section aria-live="polite" className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        Select a monitoring zone to see its details.
      </section>
    )
  }
  return (
    <section aria-live="polite" aria-labelledby="selected-title" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="selected-title" className="text-lg font-semibold text-navy-900">{zone.name}</h2>
          <p className="text-xs text-slate-500">{zone.state} · {zone.latitude.toFixed(4)}°N, {zone.longitude.toFixed(4)}°E</p>
        </div>
        {assessment.ok ? <RiskBadge level={assessment.result.level} /> : <UnavailableBadge />}
      </div>

      {assessment.ok ? (
        <>
          <div className="mt-3 rounded-lg bg-navy-950 p-3 text-white">
            <p className="text-xs uppercase tracking-wide text-slate-300">Calculated demo score</p>
            <p className="text-3xl font-semibold tabular-nums" data-testid="panel-score">
              {formatScore(assessment.result.score)}<span className="text-base font-normal text-slate-300"> / 100</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-300">Rule-based model {assessment.result.modelVersion}</p>
          </div>
          <div className="mt-2 space-y-1.5">
            <p data-testid="score-basis" className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
              <strong>Score basis:</strong> {BASIS_TEXT[scoreProvenance(zone.inputs, true).basis]}
            </p>
            <DemoDataNotice>Rule-based prototype calculation from illustrative demo inputs. Not machine learning, not live data, not a validated forecast.</DemoDataNotice>
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">How this score was made</h3>
          <ul className="mt-1 divide-y divide-slate-100">
            {FACTOR_KEYS.map((k) => {
              const raw = RAW[k]
              const input = zone.inputs[raw.key]
              const r = assessment.result
              return (
                <li key={k} className="py-2">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">{FACTOR_LABELS[k].symbol} · {FACTOR_LABELS[k].name}</span>
                    <span className="tabular-nums font-semibold text-slate-900">+{r.contributions[k].toFixed(1)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {SOURCE_LABEL[input.source]} {raw.fmt(input.value)} → {r.factors[k].toFixed(1)}/100 × weight {r.weights[k].toFixed(2)}
                  </p>
                  <div aria-hidden="true" className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-navy-700" style={{ width: `${r.factors[k]}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">
            Points shown to 1 decimal; the total is the exact sum rounded once to 1 decimal.
          </p>

          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Main contributors</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {assessment.result.explanation.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </>
      ) : (
        <div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">Risk score unavailable</p>
          <p className="mt-1 text-xs">This zone has invalid inputs, so no score is shown. Nothing has been estimated or substituted.</p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {assessment.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {weather && <ZoneWeatherDetail state={weather} zoneId={zone.id} reload={onReloadWeather ?? (() => undefined)} />}
        <PredictionHistory zoneId={zone.id} />
      </div>
    </section>
  )
}
