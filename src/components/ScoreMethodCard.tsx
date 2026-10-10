import { ELEVATION_BANDS, FACTOR_KEYS, FACTOR_LABELS, MODEL_VERSION, RAINFALL_72H_BANDS, SLOPE_BANDS, WEIGHTS } from '../risk/config'
import type { Bands } from '../risk/config'

const bandText = (b: Bands, unit: string) => b.map(([x, y]) => `${x}${unit}→${y}`).join(', ')

export function ScoreMethodCard() {
  const formula = FACTOR_KEYS.map((k) => `${WEIGHTS[k].toFixed(2)}${FACTOR_LABELS[k].symbol}`).join(' + ')
  return (
    <section aria-labelledby="method-title" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="method-title" className="text-sm font-semibold text-slate-900">How the score works</h2>
      <p className="mt-1 text-sm text-slate-700">
        A rule-based weighted calculation ({MODEL_VERSION}), <strong>not machine learning</strong> and <strong>not a validated landslide forecast</strong>.
        Inputs are illustrative demo data.
      </p>
      <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">Score = {formula}</p>
      <details className="mt-2 text-sm text-slate-700">
        <summary className="cursor-pointer font-medium text-navy-800">Factors and prototype normalization assumptions</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {FACTOR_KEYS.map((k) => (
            <li key={k}><strong>{FACTOR_LABELS[k].symbol}</strong> {FACTOR_LABELS[k].name}: weight {WEIGHTS[k].toFixed(2)}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-600">
          Each factor is scaled to 0–100 first. Soil and historical susceptibility are already 0–100. The others use
          straight-line interpolation between these <em>prototype assumptions</em> (not official thresholds):
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          <li>Rainfall, past 72 h (mm→score): {bandText(RAINFALL_72H_BANDS, '')}</li>
          <li>Slope (°→score): {bandText(SLOPE_BANDS, '')}</li>
          <li>Elevation (m→score), a crude terrain proxy: {bandText(ELEVATION_BANDS, '')}</li>
        </ul>
        <p className="mt-2 text-xs text-slate-600">
          The score is rounded to one decimal, then classified: below 30 LOW, 30 to below 50 MODERATE, 50 to below 70 HIGH, 70 and above CRITICAL.
        </p>
      </details>
    </section>
  )
}
