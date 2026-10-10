import { fetchWeather, parseWeatherResponse } from '../src/api/weatherApi'
import { ApiError } from '../src/api/zonesApi'
import { DEMO_ZONES } from '../src/data/demoZones'
import { jsonResponse, stubFetch, weatherPayload, unavailableZoneWeather, WEATHER_VALUES } from './fixtures/apiZones'

afterEach(() => {
  vi.unstubAllGlobals()
})

const clone = <T,>(v: T): T => structuredClone(v)

describe('parseWeatherResponse', () => {
  it('accepts a valid live payload and keeps values on the right zone and the right part', () => {
    const parsed = parseWeatherResponse(clone(weatherPayload('live')))
    expect(parsed.data.zones).toHaveLength(6)
    for (const z of parsed.data.zones) {
      expect(z.past.totalMm).toBe(WEATHER_VALUES[z.id].past)
      expect(z.forecast.totalMm).toBe(WEATHER_VALUES[z.id].forecast)
      expect(z.past.unit).toBe('mm')
      expect(z.past.kind).toBe('model_derived_recent')
      expect(z.forecast.kind).toBe('forecast')
    }
    expect(parsed.meta.status).toBe('live')
  })

  it('accepts stale and unavailable payloads', () => {
    expect(parseWeatherResponse(clone(weatherPayload('stale'))).meta.status).toBe('stale')
    const u = parseWeatherResponse(clone(weatherPayload('unavailable')))
    expect(u.meta.retrievedAt).toBeNull()
    expect(u.data.zones.every((z) => z.past.totalMm === null)).toBe(true)
  })

  it('accepts partial data (one zone unavailable)', () => {
    const p = weatherPayload('live')
    p.data.zones[2] = unavailableZoneWeather(DEMO_ZONES[2])
    p.meta.partial = true
    expect(parseWeatherResponse(clone(p)).data.zones[2].status).toBe('unavailable')
  })

  const mutations: [string, (p: ReturnType<typeof weatherPayload>) => unknown][] = [
    ['not an object', () => 'nope'],
    ['no zones', () => ({ meta: {} })],
    ['no meta', (p) => ({ data: p.data })],
    ['unknown meta status', (p) => ({ ...p, meta: { ...p.meta, status: 'fresh' } })],
    ['wrong unit', (p) => { p.data.zones[0].past.unit = 'inch' as never; return p }],
    ['negative mm', (p) => { p.data.zones[0].past.totalMm = -1; return p }],
    ['NaN-like mm (string)', (p) => { p.data.zones[0].forecast.totalMm = '5' as never; return p }],
    ['available part without a window', (p) => { p.data.zones[0].past.window = null; return p }],
    ['window with wrong hours', (p) => { p.data.zones[0].past.window!.hours = 48; return p }],
    ['window end before start', (p) => { const w = p.data.zones[0].forecast.window!; [w.start, w.end] = [w.end, w.start]; return p }],
    ['unavailable part that still has a value', (p) => { p.data.zones[0].forecast.status = 'unavailable'; return p }],
    ['past and forecast kinds swapped', (p) => { p.data.zones[0].past.kind = 'forecast' as never; return p }],
    ['zone says live with no data', (p) => { p.data.zones[1] = { ...unavailableZoneWeather(DEMO_ZONES[1]), status: 'live' }; return p }],
    ['meta says unavailable but zones have data', (p) => ({ ...p, meta: { ...p.meta, status: 'unavailable', retrievedAt: null, ageSeconds: null } })],
    ['stale zone inside live meta', (p) => { p.data.zones[0].status = 'stale'; return p }],
    ['live meta without retrieval time', (p) => ({ ...p, meta: { ...p.meta, retrievedAt: null } })],
    ['unavailable meta with retrieval time', () => { const u = weatherPayload('unavailable'); u.meta.retrievedAt = new Date().toISOString(); return u }],
    ['count mismatch', (p) => ({ ...p, meta: { ...p.meta, count: 5 } })],
    ['duplicate zone id', (p) => { p.data.zones[1].id = p.data.zones[0].id; return p }],
  ]
  it.each(mutations)('rejects: %s', (_name, mutate) => {
    const bad = mutate(clone(weatherPayload('live')))
    expect(() => parseWeatherResponse(bad)).toThrow(ApiError)
  })
})

describe('fetchWeather', () => {
  it('requests /api/weather once and parses the body', async () => {
    const fn = stubFetch(() => jsonResponse({}), { weather: () => jsonResponse(weatherPayload('live')) })
    const out = await fetchWeather()
    expect(out.meta.status).toBe('live')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(String(fn.mock.calls[0][0])).toBe('/api/weather')
  })

  it('turns a network failure into a safe ApiError, with no fallback values', async () => {
    stubFetch(() => jsonResponse({}), { weather: () => Promise.reject(new TypeError('Failed to fetch')) as never })
    await expect(fetchWeather()).rejects.toMatchObject({ kind: 'network' })
  })

  it('uses only the safe API message for HTTP errors', async () => {
    stubFetch(() => jsonResponse({}), { weather: () => jsonResponse({ error: { code: 'database_unavailable', message: 'The database is currently unavailable.' } }, 503) })
    await expect(fetchWeather()).rejects.toMatchObject({ kind: 'http', status: 503, message: 'The database is currently unavailable. (HTTP 503)' })
  })

  it('rejects a non-JSON success body', async () => {
    stubFetch(() => jsonResponse({}), { weather: () => new Response('<html>', { status: 200 }) })
    await expect(fetchWeather()).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('gives up on a slow response after the timeout with a clear message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))),
    )
    await expect(fetchWeather(undefined, '', 25)).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/took too long/i) })
  })

  it('rethrows the abort when the caller cancels (so the UI ignores it)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))),
    )
    const c = new AbortController()
    const p = fetchWeather(c.signal)
    c.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
