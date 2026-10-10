import type { SourcedValue, Zone } from '../types'

/**
 * ILLUSTRATIVE DEMO DATA ONLY.
 * Coordinates are approximate town locations. Every input below (rainfall, slope, elevation, soil,
 * historical susceptibility) is invented for UI demonstration. None are measurements or authoritative
 * data. Rainfall here is NOT live weather; Phase 5 weather is shown beside it and does not replace it.
 */
const demo = (value: number): SourcedValue => ({ value, source: 'demo' })

export const DEMO_ZONES: Zone[] = [
  { id: 'guwahati', name: 'Guwahati', state: 'Assam', latitude: 26.1445, longitude: 91.7362,
    inputs: { rainfall72hMm: demo(35), slopeDeg: demo(14), elevationM: demo(140), soilScore: demo(40), historicalScore: demo(30) } },
  { id: 'itanagar', name: 'Itanagar', state: 'Arunachal Pradesh', latitude: 27.0844, longitude: 93.6053,
    inputs: { rainfall72hMm: demo(40), slopeDeg: demo(24), elevationM: demo(320), soilScore: demo(52), historicalScore: demo(45) } },
  { id: 'kohima', name: 'Kohima', state: 'Nagaland', latitude: 25.6751, longitude: 94.1086,
    inputs: { rainfall72hMm: demo(55), slopeDeg: demo(27), elevationM: demo(1261), soilScore: demo(55), historicalScore: demo(50) } },
  { id: 'shillong', name: 'Shillong', state: 'Meghalaya', latitude: 25.5788, longitude: 91.8933,
    inputs: { rainfall72hMm: demo(90), slopeDeg: demo(31), elevationM: demo(1496), soilScore: demo(60), historicalScore: demo(62) } },
  { id: 'aizawl', name: 'Aizawl', state: 'Mizoram', latitude: 23.7271, longitude: 92.7176,
    inputs: { rainfall72hMm: demo(110), slopeDeg: demo(36), elevationM: demo(1132), soilScore: demo(66), historicalScore: demo(70) } },
  { id: 'gangtok', name: 'Gangtok', state: 'Sikkim', latitude: 27.3314, longitude: 88.6138,
    inputs: { rainfall72hMm: demo(160), slopeDeg: demo(42), elevationM: demo(1650), soilScore: demo(72), historicalScore: demo(78) } },
]
