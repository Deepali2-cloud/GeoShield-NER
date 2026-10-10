import { FACTOR_KEYS } from '../risk/config'
import type { RiskResult } from '../risk/engine'
import type { ZoneAssessment } from '../risk/zoneRisk'
import type { DataSource, Zone, ZoneInputs } from '../types'
import { INPUT_KEYS } from '../types/api'
import type { ZonesMeta } from '../types/api'

/** Base URL for API calls. Empty means same-origin `/api` (the Vite dev proxy forwards it to the Worker). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export type ApiErrorKind = 'network' | 'http' | 'invalid-response'

/** A failed API call. `message` is safe to show to the user. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

export interface ZonesData {
  zones: Zone[]
  assessments: Record<string, ZoneAssessment>
  meta: ZonesMeta
}

const LEVELS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL']
const SOURCES: readonly string[] = ['demo', 'live', 'authoritative']

const invalid = (why: string) => new ApiError('invalid-response', `The server returned data in an unexpected format (${why}).`)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function parseFactors(v: unknown, what: string): Record<(typeof FACTOR_KEYS)[number], number> {
  if (!isRecord(v)) throw invalid(`${what} missing`)
  const out = {} as Record<(typeof FACTOR_KEYS)[number], number>
  for (const k of FACTOR_KEYS) {
    const n = v[k]
    if (!isNum(n)) throw invalid(`${what}.${k}`)
    out[k] = n
  }
  return out
}

function parseResult(v: unknown, id: string): RiskResult {
  if (!isRecord(v)) throw invalid(`${id}: result missing`)
  if (!isNum(v.score) || v.score < 0 || v.score > 100) throw invalid(`${id}: score`)
  if (typeof v.level !== 'string' || !LEVELS.includes(v.level)) throw invalid(`${id}: level`)
  if (!Array.isArray(v.explanation) || !v.explanation.every((e) => typeof e === 'string')) throw invalid(`${id}: explanation`)
  if (typeof v.modelVersion !== 'string') throw invalid(`${id}: modelVersion`)
  return {
    score: v.score,
    level: v.level as RiskResult['level'],
    factors: parseFactors(v.factors, `${id}.factors`),
    contributions: parseFactors(v.contributions, `${id}.contributions`),
    weights: parseFactors(v.weights, `${id}.weights`),
    explanation: v.explanation as string[],
    modelVersion: v.modelVersion,
  }
}

function parseZone(v: unknown): { zone: Zone; assessment: ZoneAssessment } {
  if (!isRecord(v)) throw invalid('zone is not an object')
  const { id, name, state, latitude, longitude } = v
  if (!isStr(id) || !isStr(name) || !isStr(state)) throw invalid('zone id, name or state')
  if (!isNum(latitude) || latitude < -90 || latitude > 90 || !isNum(longitude) || longitude < -180 || longitude > 180) {
    throw invalid(`${id}: coordinates`)
  }
  if (!isRecord(v.inputs)) throw invalid(`${id}: inputs missing`)
  if (!isRecord(v.assessment) || typeof v.assessment.ok !== 'boolean') throw invalid(`${id}: assessment`)

  const assessment: ZoneAssessment = v.assessment.ok
    ? { ok: true, result: parseResult(v.assessment.result, id) }
    : (() => {
        const errors = v.assessment.errors
        if (!Array.isArray(errors) || !errors.every((e) => typeof e === 'string')) throw invalid(`${id}: errors`)
        return { ok: false as const, errors: errors as string[] }
      })()

  const inputs = {} as ZoneInputs
  for (const key of INPUT_KEYS) {
    const raw = v.inputs[key]
    if (!isRecord(raw)) throw invalid(`${id}: input ${key}`)
    let value: number
    if (raw.value === null) value = NaN
    else if (isNum(raw.value)) value = raw.value
    else throw invalid(`${id}: input ${key} value`)
    const source = raw.source
    if (source !== null && !(typeof source === 'string' && SOURCES.includes(source))) throw invalid(`${id}: input ${key} source`)
    // A scored zone must have complete, valid inputs; otherwise the response contradicts itself.
    if (assessment.ok && (!isNum(value) || source === null)) throw invalid(`${id}: scored zone with incomplete input ${key}`)
    // null value -> NaN so the existing Zone type still holds. It is only ever shown for unscored zones,
    // where the UI displays the unavailable state. A null source is likewise never displayed.
    inputs[key] = { value, source: (source ?? 'demo') as DataSource }
  }

  return { zone: { id, name, state, latitude, longitude, inputs }, assessment }
}

/** Validates an untrusted JSON body from `GET /api/zones`. Throws `ApiError('invalid-response')`. */
export function parseZonesResponse(json: unknown): ZonesData {
  if (!isRecord(json) || !isRecord(json.data) || !Array.isArray(json.data.zones)) throw invalid('missing data.zones')
  if (!isRecord(json.meta)) throw invalid('missing meta')
  const m = json.meta
  if (!isNum(m.count) || typeof m.demoData !== 'boolean' || typeof m.modelVersion !== 'string' || typeof m.notice !== 'string') {
    throw invalid('meta fields')
  }
  const zones: Zone[] = []
  const assessments: Record<string, ZoneAssessment> = {}
  for (const item of json.data.zones) {
    const { zone, assessment } = parseZone(item)
    if (Object.hasOwn(assessments, zone.id)) throw invalid(`duplicate zone id ${zone.id}`)
    zones.push(zone)
    assessments[zone.id] = assessment
  }
  if (m.count !== zones.length) throw invalid('meta.count does not match zones')
  return { zones, assessments, meta: { count: m.count, demoData: m.demoData, modelVersion: m.modelVersion, notice: m.notice } }
}

/** Fetches the zones and their calculated risk from the Worker. Never substitutes local data on failure. */
export async function fetchZones(signal?: AbortSignal, baseUrl: string = API_BASE_URL): Promise<ZonesData> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/zones`, { signal, headers: { accept: 'application/json' } })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError('network', 'Could not reach the API. Check that the Worker is running.')
  }
  if (!res.ok) {
    let message = `The API responded with an error (HTTP ${res.status}).`
    try {
      const body: unknown = await res.json()
      const e = isRecord(body) && isRecord(body.error) ? body.error.message : undefined
      if (typeof e === 'string' && e.length > 0 && e.length < 200) message = `${e} (HTTP ${res.status})`
    } catch {
      /* body was not JSON; keep the generic message */
    }
    throw new ApiError('http', message, res.status)
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw invalid('response was not JSON')
  }
  return parseZonesResponse(json)
}
