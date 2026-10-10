import type { WeatherState } from '../hooks/useWeather'
import type { WeatherStatus, ZoneWeather } from '../types/weather'
import { STATUS_LABEL, formatAge, formatMm, formatUtc, formatWindow } from '../utils/weatherDisplay'

const BADGE: Record<WeatherStatus, string> = {
  live: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  stale: 'bg-amber-100 text-amber-900 border-amber-400',
  unavailable: 'bg-slate-100 text-slate-700 border-slate-300',
}

export function WeatherBadge({ status }: { status: WeatherStatus }) {
  return (
    <span data-testid="weather-status" className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function RetryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-100">
      {label}
    </button>
  )
}

const Mm = ({ part }: { part: ZoneWeather['past'] | ZoneWeather['forecast'] }) =>
  part.status === 'available' && part.totalMm !== null ? <>{formatMm(part.totalMm)}</> : <span className="text-slate-500">Unavailable</span>

/** Explains, in words, what each number is and how old it is. Shared by the panel and the zone detail. */
function Provenance({ data, testId }: { data: Extract<WeatherState, { status: 'success' }>['data']; testId: string }) {
  const { meta } = data
  const sample = data.data.zones.find((z) => z.past.window && z.forecast.window) ?? data.data.zones.find((z) => z.past.window || z.forecast.window)
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600">
      {meta.retrievedAt && meta.ageSeconds !== null && (
        <p data-testid={testId}>
          Retrieved {formatUtc(meta.retrievedAt)} ({formatAge(meta.ageSeconds)} ago) from Open-Meteo.
        </p>
      )}
      {sample?.past.window && <p>Past window ({sample.past.window.hours} h, model-derived, not gauge-measured): {formatWindow(sample.past.window)}</p>}
      {sample?.forecast.window && <p>Forecast window (next {sample.forecast.window.hours} h, a prediction): {formatWindow(sample.forecast.window)}</p>}
    </div>
  )
}

export function WeatherPanel({ state, reload, selectedId }: { state: WeatherState; reload: () => void; selectedId: string | null }) {
  return (
    <section aria-labelledby="weather-title" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="weather-title" className="text-sm font-semibold text-slate-900">Weather (Open-Meteo)</h2>
        {state.status === 'success' && <WeatherBadge status={state.data.meta.status} />}
      </div>

      {state.status === 'loading' && (
        <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-600">Loading weather…</p>
      )}

      {state.status === 'error' && (
        <div role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
          <p className="text-sm font-semibold">Weather could not be loaded</p>
          <p className="mt-1 text-sm">{state.error.message}</p>
          <p className="mt-1 text-xs">Zones, map and risk scores are unaffected. No weather values are shown or estimated.</p>
          <div className="mt-2"><RetryButton onClick={reload} label="Retry weather" /></div>
        </div>
      )}

      {state.status === 'success' && (
        <>
          {state.data.meta.status === 'stale' && (
            <p role="status" className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Stale data.</strong> The latest refresh failed, so these are the last values received
              {state.data.meta.ageSeconds !== null && <> ({formatAge(state.data.meta.ageSeconds)} old)</>}. They are not current.
            </p>
          )}
          {state.data.meta.status === 'unavailable' ? (
            <div role="status" className="mt-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">
              <p className="font-semibold">Weather data unavailable</p>
              <p className="mt-1 text-xs">The weather provider could not be used and no earlier data is available. Nothing has been estimated.</p>
              <div className="mt-2"><RetryButton onClick={reload} label="Retry weather" /></div>
            </div>
          ) : (
            <>
              {state.data.meta.partial && (
                <p className="mt-2 text-xs text-slate-700">Some zones or values are unavailable and are marked as such.</p>
              )}
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Precipitation per zone in millimetres: model-derived past 72 hours and forecast for the next 24 hours</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-1 pr-2 font-medium">Zone</th>
                      <th scope="col" className="py-1 pr-2 font-medium">Past 72 h (mm)</th>
                      <th scope="col" className="py-1 pr-2 font-medium">Forecast next 24 h (mm)</th>
                      <th scope="col" className="py-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.data.zones.map((z) => (
                      <tr key={z.id} data-testid={`weather-row-${z.id}`} className={`border-b border-slate-100 ${z.id === selectedId ? 'bg-slate-50 font-medium' : ''}`}>
                        <th scope="row" className="py-1.5 pr-2 font-medium text-slate-900">{z.name}</th>
                        <td className="py-1.5 pr-2 tabular-nums" data-testid={`weather-past-${z.id}`}><Mm part={z.past} /></td>
                        <td className="py-1.5 pr-2 tabular-nums" data-testid={`weather-forecast-${z.id}`}><Mm part={z.forecast} /></td>
                        <td className="py-1.5"><WeatherBadge status={z.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Provenance data={state.data} testId="weather-retrieved" />
              <div className="mt-3"><RetryButton onClick={reload} label="Refresh weather" /></div>
            </>
          )}
          <p className="mt-2 text-[11px] text-slate-500">{state.data.meta.notice}</p>
        </>
      )}
    </section>
  )
}

/** Weather for the selected zone, shown in the zone detail panel. Never blocks the rest of the panel. */
export function ZoneWeatherDetail({ state, zoneId, reload }: { state: WeatherState; zoneId: string; reload: () => void }) {
  return (
    <div data-testid="zone-weather" className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-800">Weather for this zone</p>
      {state.status === 'loading' && <p role="status" className="text-xs text-slate-500">Loading weather…</p>}
      {state.status === 'error' && (
        <div className="mt-1">
          <p className="text-xs text-red-800">Weather unavailable: {state.error.message}</p>
          <button type="button" onClick={reload} className="mt-1 text-xs font-medium text-navy-800 underline">Retry weather</button>
        </div>
      )}
      {state.status === 'success' && (() => {
        const z = state.data.data.zones.find((x) => x.id === zoneId)
        if (!z || z.status === 'unavailable') {
          return <p className="text-xs text-slate-600">No weather data for this zone. Nothing has been estimated.</p>
        }
        return (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-700">
            <dt className="font-medium">Past 72 h</dt>
            <dd data-testid="zone-weather-past">
              <Mm part={z.past} /> <span className="text-slate-500">model-derived, not a gauge reading</span>
            </dd>
            <dt className="font-medium">Next 24 h</dt>
            <dd data-testid="zone-weather-forecast">
              <Mm part={z.forecast} /> <span className="text-slate-500">forecast</span>
            </dd>
            <dt className="font-medium">Status</dt>
            <dd><WeatherBadge status={z.status} /></dd>
          </dl>
        )
      })()}
      {state.status === 'success' && <Provenance data={state.data} testId="zone-weather-retrieved" />}
    </div>
  )
}
