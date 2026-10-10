/**
 * Risk engine configuration. Everything here is a PROTOTYPE ASSUMPTION, not an official or
 * scientifically validated threshold.
 */

export const MODEL_VERSION = 'weighted-v1'

export const FACTOR_KEYS = ['rainfall', 'slope', 'historical', 'soil', 'terrain'] as const
export type FactorKey = (typeof FACTOR_KEYS)[number]

/** Weights from the SRS formula: 0.35R + 0.25S + 0.20H + 0.10G + 0.10E. They must total 1.0. */
export const WEIGHTS: Readonly<Record<FactorKey, number>> = {
  rainfall: 0.35,
  slope: 0.25,
  historical: 0.2,
  soil: 0.1,
  terrain: 0.1,
}

export const FACTOR_LABELS: Readonly<Record<FactorKey, { name: string; symbol: string }>> = {
  rainfall: { name: 'Rainfall (past 72 h)', symbol: 'R' },
  slope: { name: 'Slope', symbol: 'S' },
  historical: { name: 'Historical susceptibility', symbol: 'H' },
  soil: { name: 'Soil / ground condition', symbol: 'G' },
  terrain: { name: 'Elevation / terrain', symbol: 'E' },
}

/** Lower bound (inclusive) of each level on the score rounded to 1 decimal. Below MODERATE is LOW. */
export const RISK_THRESHOLDS = { MODERATE: 30, HIGH: 50, CRITICAL: 70 } as const

/** A factor at or above this normalized value is called out as "high" in explanations. */
export const HIGH_FACTOR_CUTOFF = 60

/** Piecewise-linear band: [raw value, normalized 0-100] control points, ascending by raw value. */
export type Bands = ReadonlyArray<readonly [number, number]>

/**
 * Prototype assumption: past-72h rainfall (mm) to a 0-100 rainfall score.
 * Values above the last point saturate at 100. NOT official rainfall thresholds.
 */
export const RAINFALL_72H_BANDS: Bands = [[0, 0], [25, 15], [75, 40], [150, 70], [250, 100]]

/** Prototype assumption: slope angle (degrees) to a 0-100 slope score. Above 45 degrees saturates at 100. */
export const SLOPE_BANDS: Bands = [[0, 0], [15, 25], [30, 60], [45, 100]]

/**
 * Prototype assumption: elevation (m) as a crude proxy for mountainous terrain. This is a simplification;
 * higher is not always more hazardous. A real terrain factor needs DEM-derived relief/curvature (future work).
 */
export const ELEVATION_BANDS: Bands = [[0, 0], [500, 15], [1000, 40], [1500, 70], [2500, 100]]

/** Physical sanity limits for RAW inputs. Values outside these are rejected, never clamped. */
export const INPUT_LIMITS = {
  rainfall72hMm: { min: 0, max: 2000, unit: 'mm' },
  slopeDeg: { min: 0, max: 90, unit: '°' },
  elevationM: { min: 0, max: 9000, unit: 'm' },
  soilScore: { min: 0, max: 100, unit: '/100' },
  historicalScore: { min: 0, max: 100, unit: '/100' },
} as const
