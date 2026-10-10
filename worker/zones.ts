import { assessZone } from '../src/risk/zoneRisk'
import { MODEL_VERSION } from '../src/risk/config'
import type { DataSource, Zone, ZoneInputs } from '../src/types'
import { INPUT_KEYS } from '../src/types/api'
import type { ApiAssessment, ApiInputValue, ApiZone, InputKey, RecordOrigin, ZonesResponse } from '../src/types/api'
import type { D1Like } from './db'
import type { ZoneLocation } from './openMeteo'

/** The Phase 3 engine (src/risk/) is reused as is. Nothing here calculates a score. */

/** Hard cap on rows returned, bound as a query parameter. The prototype has six zones. */
export const MAX_ZONES = 500

export const DEMO_NOTICE = 'All inputs are illustrative demo data. Not measured, not live weather, not a validated prediction.'

/** Column names per input. Value columns hold the raw value in the same units as `ZoneInputs`. */
const COLUMNS: Record<InputKey, { value: string; source: string; label: string }> = {
  rainfall72hMm: { value: 'rainfall_72h_mm', source: 'rainfall_72h_mm_source', label: 'Rainfall (past 72 h)' },
  slopeDeg: { value: 'slope_deg', source: 'slope_deg_source', label: 'Slope angle' },
  elevationM: { value: 'elevation_m', source: 'elevation_m_source', label: 'Elevation' },
  soilScore: { value: 'soil_score', source: 'soil_score_source', label: 'Soil score' },
  historicalScore: { value: 'historical_score', source: 'historical_score_source', label: 'Historical susceptibility' },
}

// Constant SQL. No request data is ever concatenated into it; the only variable is bound with ?.
const SELECT_ZONES_SQL = `SELECT id, name, state, latitude, longitude, record_origin,
  ${INPUT_KEYS.map((k) => `${COLUMNS[k].value}, ${COLUMNS[k].source}`).join(',\n  ')}
FROM zones
ORDER BY sort_order, id
LIMIT ?`

export const COUNT_ZONES_SQL = 'SELECT COUNT(*) AS n FROM zones'

/** The database could not be queried (missing binding, missing table, I/O failure, ...). */
export class DatabaseError extends Error {}

/** A stored row cannot be represented as a zone at all (no usable id, name or coordinates). */
export class StoredDataError extends Error {}

type Row = Record<string, unknown>

const DATA_SOURCES: readonly string[] = ['demo', 'live', 'authoritative']
const ORIGINS: readonly string[] = ['demo_seed', 'user']

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/**
 * Converts one database row into an API zone with its calculated Phase 3 result.
 * - Row identity (id, name, state, coordinates) must be valid or this throws `StoredDataError`.
 * - Bad risk inputs never throw and never produce a score: the zone is returned with `assessment.ok = false`.
 */
export function rowToApiZone(row: Row): ApiZone {
  const { id, name, state, latitude, longitude } = row
  if (!isNonEmptyString(id)) throw new StoredDataError('zone row has no usable id')
  if (!isNonEmptyString(name) || !isNonEmptyString(state)) throw new StoredDataError(`zone ${id}: missing name or state`)
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) throw new StoredDataError(`zone ${id}: invalid latitude`)
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) throw new StoredDataError(`zone ${id}: invalid longitude`)
  if (typeof row.record_origin !== 'string' || !ORIGINS.includes(row.record_origin)) throw new StoredDataError(`zone ${id}: invalid record origin`)

  const sourceErrors: string[] = []
  const apiInputs = {} as Record<InputKey, ApiInputValue>
  // What the engine sees: raw stored values, un-coerced, so it reports "missing" / "must be a finite number" itself.
  const engineInputs = {} as Record<InputKey, { value: number; source: DataSource }>

  for (const key of INPUT_KEYS) {
    const col = COLUMNS[key]
    const rawValue = row[col.value]
    const rawSource = row[col.source]
    const sourceOk = typeof rawSource === 'string' && DATA_SOURCES.includes(rawSource)
    if (!sourceOk) sourceErrors.push(`${col.label}: unknown data source`)
    apiInputs[key] = {
      value: isFiniteNumber(rawValue) ? rawValue : null,
      source: sourceOk ? (rawSource as DataSource) : null,
    }
    engineInputs[key] = { value: rawValue as number, source: rawSource as DataSource }
  }

  const zone: Zone = { id, name, state, latitude, longitude, inputs: engineInputs as ZoneInputs }
  const calc = assessZone(zone)
  const errors = [...(calc.ok ? [] : calc.errors), ...sourceErrors]
  const assessment: ApiAssessment = errors.length === 0 && calc.ok ? { ok: true, result: calc.result } : { ok: false, errors }

  return { id, name, state, latitude, longitude, origin: row.record_origin as RecordOrigin, inputs: apiInputs, assessment }
}

/** Reads every zone from D1 and calculates its risk with the shared engine. */
export async function loadZones(db: D1Like): Promise<ApiZone[]> {
  let rows: Row[]
  try {
    const res = await db.prepare(SELECT_ZONES_SQL).bind(MAX_ZONES).all<Row>()
    rows = res.results
    if (!Array.isArray(rows)) throw new Error('unexpected query result')
  } catch (err) {
    throw new DatabaseError(err instanceof Error ? err.message : 'database query failed')
  }
  return rows.map(rowToApiZone)
}

export function buildZonesResponse(zones: ApiZone[]): ZonesResponse {
  const demoData = zones.every((z) => INPUT_KEYS.every((k) => z.inputs[k].source === 'demo'))
  return {
    data: { zones },
    meta: { count: zones.length, demoData, modelVersion: MODEL_VERSION, notice: DEMO_NOTICE },
  }
}

/** True when the database answers and the `zones` table exists (i.e. migrations were applied). */
export async function checkDatabase(db: D1Like): Promise<boolean> {
  try {
    const row = await db.prepare(COUNT_ZONES_SQL).first<{ n: number }>()
    return row !== null && typeof row.n === 'number'
  } catch {
    return false
  }
}

// Constant SQL, same ordering and cap as the zones query. Weather needs identity and coordinates only.
const SELECT_LOCATIONS_SQL = `SELECT id, name, latitude, longitude FROM zones ORDER BY sort_order, id LIMIT ?`

/** Zone identity and coordinates from D1, validated like `rowToApiZone`. Used by the weather endpoint. */
export async function loadZoneLocations(db: D1Like): Promise<ZoneLocation[]> {
  let rows: Row[]
  try {
    const res = await db.prepare(SELECT_LOCATIONS_SQL).bind(MAX_ZONES).all<Row>()
    rows = res.results
    if (!Array.isArray(rows)) throw new Error('unexpected query result')
  } catch (err) {
    throw new DatabaseError(err instanceof Error ? err.message : 'database query failed')
  }
  return rows.map((row) => {
    const { id, name, latitude, longitude } = row
    if (!isNonEmptyString(id)) throw new StoredDataError('zone row has no usable id')
    if (!isNonEmptyString(name)) throw new StoredDataError(`zone ${id}: missing name`)
    if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) throw new StoredDataError(`zone ${id}: invalid latitude`)
    if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) throw new StoredDataError(`zone ${id}: invalid longitude`)
    return { id, name, latitude, longitude }
  })
}
