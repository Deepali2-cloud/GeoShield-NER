import type { LatLngBoundsLiteral } from 'leaflet'

/** Standard OpenStreetMap tile server. Subject to the OSM tile usage policy (fine for a low-traffic prototype). */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

/** Rough bounding box for Northeast India (incl. Sikkim), used only as a fallback view. */
export const NER_BOUNDS: LatLngBoundsLiteral = [
  [21.5, 87.8],
  [29.5, 97.5],
]

/** Number of consecutive tile errors (without a success) before we show the warning. */
export const TILE_ERROR_THRESHOLD = 3

/** Extra top/left room so edge markers are not hidden under the zoom control. */
export const FIT_OPTIONS = {
  paddingTopLeft: [72, 56] as [number, number],
  paddingBottomRight: [48, 48] as [number, number],
}
