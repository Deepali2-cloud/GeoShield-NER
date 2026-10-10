// @vitest-environment node
import { loadZoneLocations } from '../../worker/zones'
import { ProviderError, buildRequestUrl, fetchOpenMeteo, floorToHour, parseOpenMeteo } from '../../worker/openMeteo'
import type { ZoneLocation } from '../../worker/openMeteo'
import { FLOOR_MS, HOUR, NOW_MS, TRAP_MM, expectedForecast, expectedPast, jsonRes, providerBody } from '../fixtures/openMeteo'
import { createTestDb } from './helpers'

let LOCS: ZoneLocation[]
beforeAll(async () => {
  LOCS = await loadZoneLocations(createTestDb().db)
})

describe('request construction', () => {
  it('batches all six zones into ONE request with documented parameters', () => {
    const url = new URL(buildRequestUrl(LOCS))
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(url.searchParams.get('latitude')).toBe(LOCS.map((l) => l.latitude).join(','))
    expect(url.searchParams.get('longitude')).toBe(LOCS.map((l) => l.longitude).join(','))
    expect(url.searchParams.get('hourly')).toBe('precipitation')
    expect(url.searchParams.get('past_hours')).toBe('72')
    expect(url.searchParams.get('forecast_hours')).toBe('25')
    expect(url.searchParams.get('timeformat')).toBe('unixtime')
    expect(url.searchParams.get('timezone')).toBe('UTC')
    expect(url.searchParams.get('precipitation_unit')).toBe('mm')
    expect(url.searchParams.has('apikey')).toBe(false) // public endpoint, no secret
  })

  it('uses the seeded zone coordinates, not invented ones', () => {
    expect(LOCS.map((l) => l.id)).toEqual(['guwahati', 'itanagar', 'kohima', 'shillong', 'aizawl', 'gangtok'])
    expect(LOCS[0]).toMatchObject({ latitude: 26.1445, longitude: 91.7362 })
    expect(LOCS[5]).toMatchObject({ latitude: 27.3314, longitude: 88.6138 })
  })

  it('floors to the hour in UTC', () => {
    expect(floorToHour(NOW_MS)).toBe(FLOOR_MS)
    expect(floorToHour(FLOOR_MS)).toBe(FLOOR_MS)
  })
})

describe('parseOpenMeteo: valid responses', () => {
  it('maps each location to the right zone id by request order', () => {
    const zones = parseOpenMeteo(providerBody(LOCS), LOCS, NOW_MS)
    expect(Object.keys(zones)).toEqual(LOCS.map((l) => l.id))
    LOCS.forEach((l, i) => {
      expect(zones[l.id].past?.totalMm).toBe(expectedPast(i))
      expect(zones[l.id].forecast?.totalMm).toBe(expectedForecast(i))
    })
    // distinct per zone: a swapped mapping would be caught
    expect(new Set(LOCS.map((l) => zones[l.id].past?.totalMm)).size).toBe(6)
  })

  it('keeps past and forecast separate and cuts windows by timestamp, ignoring trap values outside them', () => {
    const z = parseOpenMeteo(providerBody(LOCS), LOCS, NOW_MS).guwahati
    expect(z.past?.totalMm).toBe(7.2) // 72 x 0.1; the 9 mm trap at -72 h is excluded
    expect(z.forecast?.totalMm).toBe(1.2) // 24 x 0.05; the 9 mm trap at +25 h is excluded
    expect(z.past!.totalMm + z.forecast!.totalMm).not.toBe(z.past!.totalMm)
    expect(TRAP_MM).toBeGreaterThan(z.past!.totalMm / 72) // sanity: traps would have changed the sums
  })

  it('reports exact windows in UTC epoch ms: past (floor-72h, floor], forecast (floor, floor+24h]', () => {
    const z = parseOpenMeteo(providerBody(LOCS), LOCS, NOW_MS).guwahati
    expect(z.past).toMatchObject({ startMs: FLOOR_MS - 72 * HOUR, endMs: FLOOR_MS })
    expect(z.forecast).toMatchObject({ startMs: FLOOR_MS, endMs: FLOOR_MS + 24 * HOUR })
    expect(z.past!.endMs).toBeLessThanOrEqual(z.forecast!.startMs) // never overlap
  })

  it('accepts the single-object shape returned for one location', () => {
    const one = [LOCS[2]]
    const body = providerBody(one)[0]
    const zones = parseOpenMeteo(body, one, NOW_MS)
    expect(zones.kohima.past?.totalMm).toBe(expectedPast(0))
  })

  it('treats an exact 0 mm as a real value, not as missing', () => {
    const zones = parseOpenMeteo(providerBody(LOCS, { override: (i) => (i === 0 ? 0 : undefined) }), LOCS, NOW_MS)
    expect(zones.guwahati.past?.totalMm).toBe(0)
    expect(zones.guwahati.forecast?.totalMm).toBe(0)
  })
})

describe('parseOpenMeteo: missing and malformed data', () => {
  it('never reports a partial sum: one missing hour makes that part unavailable, the other part survives', () => {
    const zones = parseOpenMeteo(
      providerBody(LOCS, { override: (i, stamp) => (i === 0 && stamp === FLOOR_MS - 10 * HOUR ? null : undefined) }),
      LOCS,
      NOW_MS,
    )
    expect(zones.guwahati.past).toBeNull()
    expect(zones.guwahati.forecast?.totalMm).toBe(expectedForecast(0))
    expect(zones.itanagar.past?.totalMm).toBe(expectedPast(1)) // other zones unaffected
  })

  it('rejects negative, absurd or non-numeric hourly values as missing instead of clamping them', () => {
    for (const bad of [-1, 100000, NaN]) {
      const zones = parseOpenMeteo(providerBody(LOCS, { override: (i, s) => (i === 3 && s === FLOOR_MS ? bad : undefined) }), LOCS, NOW_MS)
      expect(zones.shillong.past).toBeNull()
    }
    const str = parseOpenMeteo(providerBody(LOCS, { override: (i, s) => (i === 3 && s === FLOOR_MS ? ('5' as never) : undefined) }), LOCS, NOW_MS)
    expect(str.shillong.past).toBeNull()
  })

  it('leaves a zone out when the precipitation variable is absent', () => {
    const body = providerBody(LOCS, { mutate: (i, loc) => (i === 1 ? { ...loc, hourly: { time: [1, 2, 3] } } : undefined) })
    const zones = parseOpenMeteo(body, LOCS, NOW_MS)
    expect(zones.itanagar).toBeUndefined()
    expect(zones.guwahati).toBeDefined()
  })

  it('leaves a zone out when units are not mm (never assumes a unit)', () => {
    const body = providerBody(LOCS, { mutate: (i, loc) => (i === 4 ? { ...loc, hourly_units: { precipitation: 'inch' } } : undefined) })
    expect(parseOpenMeteo(body, LOCS, NOW_MS).aizawl).toBeUndefined()
    const noUnits = providerBody(LOCS, { mutate: (i, loc) => (i === 4 ? { ...loc, hourly_units: undefined } : undefined) })
    expect(parseOpenMeteo(noUnits, LOCS, NOW_MS).aizawl).toBeUndefined()
  })

  it('leaves a zone out when time and value arrays differ in length or time is not epoch seconds', () => {
    const lengths = providerBody(LOCS, { mutate: (i, loc) => (i === 0 ? { ...loc, hourly: { time: [1, 2], precipitation: [0] } } : undefined) })
    expect(parseOpenMeteo(lengths, LOCS, NOW_MS).guwahati).toBeUndefined()
    const iso = providerBody(LOCS, {
      mutate: (i, loc) => (i === 0 ? { ...loc, hourly: { time: ['2026-10-10T03:00'], precipitation: [1] } } : undefined),
    })
    expect(parseOpenMeteo(iso, LOCS, NOW_MS).guwahati).toBeUndefined()
  })

  it('leaves a zone out when the returned grid point is not near the requested zone (guards position mapping)', () => {
    const body = providerBody(LOCS, { mutate: (i, loc) => (i === 2 ? { ...loc, latitude: 40, longitude: 10 } : undefined) })
    expect(parseOpenMeteo(body, LOCS, NOW_MS).kohima).toBeUndefined()
  })

  it('treats data that does not cover the windows (e.g. forecast only) as unavailable past values', () => {
    const body = providerBody(LOCS, { override: (_i, s) => (s <= FLOOR_MS ? null : undefined) })
    const zones = parseOpenMeteo(body, LOCS, NOW_MS)
    expect(zones.guwahati.past).toBeNull() // forecast-only data is NEVER reported as past precipitation
    expect(zones.guwahati.forecast?.totalMm).toBe(expectedForecast(0))
  })

  it.each([
    ['null', null],
    ['a string', 'oops'],
    ['an empty list', []],
    ['an unrelated object', { hello: 'world' }],
    ['too few locations', [{}]],
  ])('throws invalid_response for %s', (_n, body) => {
    expect(() => parseOpenMeteo(body, LOCS, NOW_MS)).toThrow(ProviderError)
    try {
      parseOpenMeteo(body, LOCS, NOW_MS)
    } catch (e) {
      expect((e as ProviderError).kind).toBe('invalid_response')
    }
  })
})

describe('fetchOpenMeteo: provider failures', () => {
  const call = (fetchFn: typeof fetch, timeoutMs = 1000) => fetchOpenMeteo(LOCS, fetchFn, NOW_MS, timeoutMs)
  const kindOf = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      return e instanceof ProviderError ? e.kind : 'NOT_A_PROVIDER_ERROR'
    }
    return 'resolved'
  }

  it('returns a snapshot stamped with the retrieval time on success, with exactly one provider call', async () => {
    const fn = vi.fn(async () => jsonRes(providerBody(LOCS)))
    const snap = await call(fn as unknown as typeof fetch)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(snap.fetchedAtMs).toBe(NOW_MS)
    expect(Object.keys(snap.zones)).toHaveLength(6)
  })

  it('maps HTTP 429 to rate_limited and other HTTP errors to http_error', async () => {
    expect(await kindOf(call((async () => jsonRes({ error: true, reason: 'Too many' }, 429)) as unknown as typeof fetch))).toBe('rate_limited')
    expect(await kindOf(call((async () => jsonRes({}, 500)) as unknown as typeof fetch))).toBe('http_error')
    expect(await kindOf(call((async () => jsonRes({ error: true, reason: 'bad' }, 400)) as unknown as typeof fetch))).toBe('http_error')
  })

  it('maps a 200 body of {error:true} to http_error', async () => {
    expect(await kindOf(call((async () => jsonRes({ error: true, reason: 'x' })) as unknown as typeof fetch))).toBe('http_error')
  })

  it('times out a hung request using the abort signal', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    const started = Date.now()
    expect(await kindOf(call(hang, 30))).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('maps a thrown network error to network_error', async () => {
    expect(await kindOf(call((async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch))).toBe('network_error')
  })

  it('maps non-JSON and malformed bodies to invalid_response', async () => {
    expect(await kindOf(call((async () => new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch))).toBe('invalid_response')
    expect(await kindOf(call((async () => jsonRes({ hourly: {} })) as unknown as typeof fetch))).toBe('invalid_response')
    expect(await kindOf(call((async () => jsonRes([])) as unknown as typeof fetch))).toBe('invalid_response')
  })
})
