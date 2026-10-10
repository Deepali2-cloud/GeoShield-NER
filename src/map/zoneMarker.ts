import L from 'leaflet'
import type { RiskLevel } from '../types'
import { RISK_STYLES } from '../utils/riskDisplay'

/** One distinct silhouette per level so risk is never conveyed by colour alone. */
const SHAPES: Record<RiskLevel, string> = {
  LOW: '<circle cx="14" cy="14" r="10"',
  MODERATE: '<polygon points="14,3 25.5,23.5 2.5,23.5"',
  HIGH: '<polygon points="14,2 26,14 14,26 2,14"',
  CRITICAL: '<rect x="4" y="4" width="20" height="20" rx="1.5"',
}

export const MARKER_SIZE = 38

/**
 * Built once per level. Selection is shown by toggling the `gs-selected` class on the existing
 * element (see index.css), so the DOM node, and keyboard focus on it, is never recreated.
 */
const UNAVAILABLE_SHAPE =
  '<circle cx="14" cy="14" r="10" fill="#e2e8f0" stroke="#475569" stroke-width="2.5" stroke-dasharray="4 2.5"/>' +
  '<text x="14" y="19" text-anchor="middle" font-size="14" font-weight="700" fill="#334155" font-family="sans-serif">?</text>'

/** `null` means the zone's score is unavailable (invalid inputs): a neutral dashed marker, no risk colour. */
export function buildZoneIcon(level: RiskLevel | null): L.DivIcon {
  const shape = level
    ? `${SHAPES[level]} fill="var(${RISK_STYLES[level].solidVar})" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>`
    : UNAVAILABLE_SHAPE
  return L.divIcon({
    className: 'gs-marker',
    html:
      `<svg width="${MARKER_SIZE}" height="${MARKER_SIZE}" viewBox="0 0 28 28" aria-hidden="true" focusable="false">` +
      `<circle class="gs-halo" cx="14" cy="14" r="13" fill="#ffffff" stroke="#0f2a4a" stroke-width="2"/>` +
      `<g class="gs-shape">${shape}</g></svg>`,
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
  })
}
