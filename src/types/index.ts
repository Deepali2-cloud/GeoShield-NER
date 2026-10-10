export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'

/** Where an input came from. Every seeded input is 'demo'; 'live' / 'authoritative' are reserved for inputs that are genuinely measured. */
export type DataSource = 'demo' | 'live' | 'authoritative'

export interface SourcedValue {
  value: number
  source: DataSource
}

/** Raw (un-normalized) inputs to the risk engine. */
export interface ZoneInputs {
  /** Past-72h rainfall total, mm. Still a demo value: Phase 5 shows Open-Meteo weather beside the score but does not feed it in. */
  rainfall72hMm: SourcedValue
  /** Slope angle, degrees. */
  slopeDeg: SourcedValue
  /** Metres above sea level. */
  elevationM: SourcedValue
  /** Soil / ground condition, already 0-100. */
  soilScore: SourcedValue
  /** Historical susceptibility, already 0-100. */
  historicalScore: SourcedValue
}

/** A seeded monitoring zone. All input values are currently illustrative demo data. */
export interface Zone {
  id: string
  name: string
  state: string
  latitude: number
  longitude: number
  inputs: ZoneInputs
}
