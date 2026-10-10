import { ApiError, fetchZones, parseZonesResponse } from '../src/api/zonesApi'
import { DEMO_ZONES } from '../src/data/demoZones'
import { jsonResponse, stubFetch, zonesPayload } from './fixtures/apiZones'

afterEach(() => {
  vi.unstubAllGlobals()
})

const clone = () => JSON.parse(JSON.stringify(zonesPayload()))

describe('parseZonesResponse', () => {
  it('converts a valid response into zones, assessments and meta', () => {
    const d = parseZonesResponse(clone())
    expect(d.zones.map((z) => z.id)).toEqual(DEMO_ZONES.map((z) => z.id))
    expect(d.meta.count).toBe(6)
    const g = d.assessments.gangtok
    expect(g.ok && g.result.score).toBe(78.8)
    expect(d.zones[0].inputs.rainfall72hMm).toEqual({ value: 35, source: 'demo' })
  })

  it('accepts an empty zone list', () => {
    const d = parseZonesResponse(zonesPayload([]))
    expect(d.zones).toEqual([])
  })

  it('maps null input values to NaN for unscored zones', () => {
    const p = clone()
    p.data.zones[0].inputs.slopeDeg.value = null
    p.data.zones[0].assessment = { ok: false, errors: ['Slope angle: missing'] }
    const d = parseZonesResponse(p)
    expect(Number.isNaN(d.zones[0].inputs.slopeDeg.value)).toBe(true)
    expect(d.assessments.guwahati.ok).toBe(false)
  })

  const bad: [string, (p: any) => unknown][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['null body', () => null],
    ['array body', () => []],
    ['missing data', (p) => ({ meta: p.meta })],
    ['zones not an array', (p) => ({ ...p, data: { zones: {} } })],
    ['missing meta', (p) => ({ data: p.data })],
    ['meta.count mismatch', (p) => { p.meta.count = 5; return p }],
    ['duplicate zone ids', (p) => { p.data.zones[1].id = p.data.zones[0].id; return p }],
    ['empty id', (p) => { p.data.zones[0].id = ''; return p }],
    ['latitude out of range', (p) => { p.data.zones[0].latitude = 123; return p }],
    ['longitude as string', (p) => { p.data.zones[0].longitude = '91.7'; return p }],
    ['score out of range', (p) => { p.data.zones[0].assessment.result.score = 140; return p }],
    ['unknown level', (p) => { p.data.zones[0].assessment.result.level = 'SEVERE'; return p }],
    ['missing factor', (p) => { delete p.data.zones[0].assessment.result.factors.slope; return p }],
    ['assessment.ok not boolean', (p) => { p.data.zones[0].assessment.ok = 'yes'; return p }],
    ['errors not strings', (p) => { p.data.zones[0].assessment = { ok: false, errors: [1] }; return p }],
    ['unknown input source', (p) => { p.data.zones[0].inputs.slopeDeg.source = 'guess'; return p }],
    ['scored zone with a null input', (p) => { p.data.zones[0].inputs.soilScore.value = null; return p }],
    ['scored zone with a null source', (p) => { p.data.zones[0].inputs.soilScore.source = null; return p }],
    ['missing input', (p) => { delete p.data.zones[0].inputs.elevationM; return p }],
  ]
  it.each(bad)('rejects an invalid response: %s', (_name, mutate) => {
    expect(() => parseZonesResponse(mutate(clone()))).toThrow(ApiError)
    try {
      parseZonesResponse(mutate(clone()))
    } catch (e) {
      expect((e as ApiError).kind).toBe('invalid-response')
    }
  })
})

describe('fetchZones', () => {
  it('requests /api/zones relative to the given base URL', async () => {
    const f = stubFetch(() => jsonResponse(zonesPayload()))
    await fetchZones(undefined, '')
    expect(f.mock.calls[0][0]).toBe('/api/zones')
    await fetchZones(undefined, 'http://localhost:8787')
    expect(f.mock.calls[1][0]).toBe('http://localhost:8787/api/zones')
  })

  it('classifies network, http and invalid-response failures', async () => {
    stubFetch(() => Promise.reject(new TypeError('x')) as unknown as Response)
    await expect(fetchZones(undefined, '')).rejects.toMatchObject({ kind: 'network' })
    stubFetch(() => jsonResponse({ error: { code: 'internal_error', message: 'An unexpected error occurred.' } }, 500))
    await expect(fetchZones(undefined, '')).rejects.toMatchObject({ kind: 'http', status: 500 })
    stubFetch(() => jsonResponse({ nope: true }))
    await expect(fetchZones(undefined, '')).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('does not echo an oversized or non-string error message from the server', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'x'.repeat(500) } }, 500))
    await expect(fetchZones(undefined, '')).rejects.toMatchObject({ message: 'The API responded with an error (HTTP 500).' })
  })
})
