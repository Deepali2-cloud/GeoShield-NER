import type { Bands } from './config'
import { ELEVATION_BANDS, RAINFALL_72H_BANDS, SLOPE_BANDS } from './config'

/**
 * Piecewise-linear interpolation through ascending control points. Inputs beyond the last point
 * saturate at its value (a physical measurement above the top band legitimately scores the maximum).
 * Callers must validate that x is finite and within the raw-input limits first.
 */
export function interpolate(bands: Bands, x: number): number {
  const first = bands[0]
  const last = bands[bands.length - 1]
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < bands.length; i++) {
    const [x1, y1] = bands[i]
    if (x <= x1) {
      const [x0, y0] = bands[i - 1]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return last[1]
}

export const normalizeRainfall72h = (mm: number): number => interpolate(RAINFALL_72H_BANDS, mm)
export const normalizeSlope = (deg: number): number => interpolate(SLOPE_BANDS, deg)
export const normalizeElevation = (m: number): number => interpolate(ELEVATION_BANDS, m)
