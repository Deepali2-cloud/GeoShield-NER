// @vitest-environment node
import { DEMO_ZONES } from '../../src/data/demoZones'
import { INPUT_KEYS } from '../../src/types/api'
import type { WeatherResponse } from '../../src/types/weather'
import { handleRequest } from '../../worker/index'
import type { Env } from '../../worker/index'
import { FAILURE_COOLDOWN_MS, FRESH_SECONDS, MAX_STALE_SECONDS, cacheKey, resetWeatherRuntime } from '../../worker/weather'
import type { WeatherDeps } from '../../worker/weather'
import { loadZoneLocations } from '../../worker/zones'
import { FLOOR_MS, NOW_MS, expectedForecast, expectedPast, jsonRes, providerBody } from '../fixtures/openMeteo'
import { LEAKY_MESSAGE, createTestDb } from './helpers'

const LEAK = /sqlite|no such table|\/srv\/|secret|token|abc123|stack|\bat \w+.*\(|SELECT|FROM zones|api\.open-meteo|apikey/i

/** A controllable world: a clock, and a provider that answers from `respond` and counts its calls. */
function world(initial: (() => Response | Promise<Response>) | null = null) {
  const state = {
    now: NOW_MS,
    respond: initial ?? (async () => jsonRes(providerBody(await locs()))),
    calls: 0,
    urls: [] as string[],
  }
  let cachedLocs: Awaited<ReturnType<typeof loadZoneLocations>> | null = null
  async function locs() {
    cachedLocs ??= await loadZoneLocations(createTestDb().db)
    return cachedLocs
  }
  const deps: WeatherDeps = {
    fetch: (async (input: RequestInfo | URL) => {
      state.calls++
      state.urls.push(String(input))
      return state.respond()
    }) as typeof fetch,
    now: () => state.now,
    timeoutMs: 200,
  }
  return { state, deps }
}

async function get(env: Env, deps: WeatherDeps, path = '/api/weather', init?: RequestInit) {
  const res = await handleRequest(new Request(`http://localhost${path}`, init), env, deps)
  const text = await res.text()
  let body: Record<string, any> | null = null // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = JSON.parse(text)
  } catch {
    /* no body */
  }
  return { res, text, body: body as WeatherResponse & { error?: { code: string } } }
}

beforeEach(() => {
  resetWeatherRuntime()
})

describe('GET /api/weather: live data', () => {
  it('returns the six zones with past and forecast kept separate, in mm, with times', async () => {
    const t = createTestDb()
    const w = world()
    const { res, body } = await get(t.env, w.deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(w.state.calls).toBe(1)

    expect(body.data.zones.map((z) => z.id)).toEqual(DEMO_ZONES.map((z) => z.id))
    body.data.zones.forEach((z, i) => {
      const demo = DEMO_ZONES[i]
      expect(z).toMatchObject({ id: demo.id, name: demo.name, latitude: demo.latitude, longitude: demo.longitude, status: 'live' })
      expect(z.past).toMatchObject({ kind: 'model_derived_recent', status: 'available', totalMm: expectedPast(i), unit: 'mm' })
      expect(z.forecast).toMatchObject({ kind: 'forecast', status: 'available', totalMm: expectedForecast(i), unit: 'mm' })
      expect(z.past.window).toEqual({ start: new Date(FLOOR_MS - 72 * 3600_000).toISOString(), end: new Date(FLOOR_MS).toISOString(), hours: 72 })
      expect(z.forecast.window).toEqual({ start: new Date(FLOOR_MS).toISOString(), end: new Date(FLOOR_MS + 24 * 3600_000).toISOString(), hours: 24 })
    })
    expect(body.meta).toMatchObject({
      status: 'live',
      partial: false,
      count: 6,
      unit: 'mm',
      cache: 'refreshed',
      retrievedAt: new Date(NOW_MS).toISOString(),
      ageSeconds: 0,
      freshSeconds: FRESH_SECONDS,
      maxStaleSeconds: MAX_STALE_SECONDS,
      provider: { name: 'Open-Meteo', endpoint: 'forecast', model: 'best_match', status: 'ok' },
    })
    expect(body.meta.notice).toMatch(/not rain-gauge/i)
  })

  it('makes ONE batched provider request for all six zones, with no secret', async () => {
    const w = world()
    await get(createTestDb().env, w.deps)
    expect(w.state.urls).toHaveLength(1)
    const u = new URL(w.state.urls[0])
    expect(u.searchParams.get('latitude')!.split(',')).toHaveLength(6)
    expect(u.searchParams.has('apikey')).toBe(false)
  })

  it('serves HEAD and rejects other methods like the other routes', async () => {
    const w = world()
    const env = createTestDb().env
    const head = await get(env, w.deps, '/api/weather', { method: 'HEAD' })
    expect(head.res.status).toBe(200)
    expect(head.text).toBe('')
    const post = await get(env, w.deps, '/api/weather', { method: 'POST' })
    expect(post.res.status).toBe(405)
    expect(post.res.headers.get('allow')).toBe('GET, HEAD')
  })
})

describe('caching and freshness', () => {
  it('serves a repeat request from cache without calling the provider, still labelled live with its age', async () => {
    const env = createTestDb().env
    const w = world()
    await get(env, w.deps)
    w.state.now += 10 * 60_000
    const { body } = await get(env, w.deps)
    expect(w.state.calls).toBe(1)
    expect(body.meta).toMatchObject({ status: 'live', cache: 'cache_fresh', ageSeconds: 600, retrievedAt: new Date(NOW_MS).toISOString() })
    expect(body.meta.provider.status).toBe('not_attempted')
  })

  it('refreshes once the freshness window has passed', async () => {
    const env = createTestDb().env
    const w = world()
    await get(env, w.deps)
    w.state.now += (FRESH_SECONDS + 1) * 1000
    const { body } = await get(env, w.deps)
    expect(w.state.calls).toBe(2)
    expect(body.meta).toMatchObject({ status: 'live', cache: 'refreshed', ageSeconds: 0 })
  })

  it('persists the cache in D1 across Worker instances (new runtime state, same database)', async () => {
    const env = createTestDb().env
    const w = world()
    await get(env, w.deps)
    resetWeatherRuntime()
    w.state.now += 60_000
    await get(env, w.deps)
    expect(w.state.calls).toBe(1)
  })

  it('misses the cache when a zone coordinate changes', async () => {
    const t = createTestDb()
    const w = world()
    await get(t.env, w.deps)
    t.raw.exec("UPDATE zones SET latitude = 26.2 WHERE id = 'guwahati'")
    await get(t.env, w.deps)
    expect(w.state.calls).toBe(2)
    const locs = await loadZoneLocations(t.db)
    expect(cacheKey(locs)).toContain('guwahati:26.2,91.7362')
  })

  it('ignores a corrupt cache row (counts as a miss) rather than serving or crashing', async () => {
    const t = createTestDb()
    const w = world()
    await get(t.env, w.deps)
    t.raw.exec("UPDATE weather_cache SET payload = '{not json'")
    expect((await get(t.env, w.deps)).body.meta.cache).toBe('refreshed')
    t.raw.exec(`UPDATE weather_cache SET payload = '{"fetchedAtMs": 1, "zones": {"guwahati": {"past": {"totalMm": "lots"}, "forecast": null}}}'`)
    w.state.now += 1000
    const again = await get(t.env, w.deps)
    expect(again.body.meta.cache).toBe('refreshed')
    expect(again.body.data.zones[0].past.totalMm).toBe(expectedPast(0))
  })

  it('does not trust a cache entry stamped in the future', async () => {
    const t = createTestDb()
    const w = world()
    await get(t.env, w.deps)
    w.state.now -= 3 * 3600_000 // clock now earlier than the stored stamp by 3 h
    const { body } = await get(t.env, w.deps)
    expect(body.meta.cache).toBe('refreshed')
    expect(w.state.calls).toBe(2)
  })

  it('still answers when the cache cannot be written', async () => {
    const t = createTestDb()
    t.raw.exec('DROP TABLE weather_cache') // as if migration 0002 had not been applied
    const w = world()
    const { res, body } = await get(t.env, w.deps)
    expect(res.status).toBe(200)
    expect(body.meta.status).toBe('live')
    expect(body.data.zones[0].past.totalMm).toBe(expectedPast(0))
  })
})

describe('stale data and provider failure', () => {
  async function primed() {
    const t = createTestDb()
    const w = world()
    await get(t.env, w.deps)
    return { t, w }
  }

  it('serves stale data, clearly labelled with its real age, when a refresh fails', async () => {
    const { t, w } = await primed()
    w.state.now += 2 * 3600_000
    w.state.respond = async () => jsonRes({}, 500)
    const { res, body } = await get(t.env, w.deps)
    expect(res.status).toBe(200)
    expect(body.meta).toMatchObject({
      status: 'stale',
      cache: 'cache_stale',
      ageSeconds: 7200,
      retrievedAt: new Date(NOW_MS).toISOString(), // the ORIGINAL retrieval time, not now
      provider: { status: 'http_error' },
    })
    expect(body.data.zones.every((z) => z.status === 'stale')).toBe(true)
    expect(body.data.zones[0].past.totalMm).toBe(expectedPast(0)) // the real old value, nothing invented
  })

  it.each([
    ['a timeout', () => new Promise<Response>(() => undefined), 'timeout'],
    ['HTTP 429', async () => jsonRes({ error: true }, 429), 'rate_limited'],
    ['a network error', async (): Promise<Response> => { throw new TypeError('boom') }, 'network_error'],
    ['malformed JSON', async () => new Response('garbage'), 'invalid_response'],
  ])('falls back to stale data on %s', async (_n, respond, status) => {
    const { t, w } = await primed()
    w.state.now += 3600_000
    // a hanging fetch only ends via the abort signal, which `world` does not wire; make that case reject on abort
    w.deps.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      w.state.calls++
      if (status === 'timeout') {
        return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))
      }
      return respond()
    }) as typeof fetch
    const { body } = await get(t.env, w.deps)
    expect(body.meta.status).toBe('stale')
    expect(body.meta.provider.status).toBe(status)
  })

  it('becomes unavailable (no values at all) once the cached data is older than the maximum stale age', async () => {
    const { t, w } = await primed()
    w.state.now += (MAX_STALE_SECONDS + 1) * 1000
    w.state.respond = async () => jsonRes({}, 503)
    const { res, body } = await get(t.env, w.deps)
    expect(res.status).toBe(200)
    expect(body.meta).toMatchObject({ status: 'unavailable', retrievedAt: null, ageSeconds: null, cache: 'none' })
    for (const z of body.data.zones) {
      expect(z.status).toBe('unavailable')
      expect(z.past).toMatchObject({ status: 'unavailable', totalMm: null, window: null })
      expect(z.forecast).toMatchObject({ status: 'unavailable', totalMm: null, window: null })
    }
  })

  it('is unavailable, with no invented numbers, when there is no cache and the provider is down', async () => {
    const t = createTestDb()
    const w = world(async () => jsonRes({}, 502))
    const { res, text, body } = await get(t.env, w.deps)
    expect(res.status).toBe(200)
    expect(body.meta.status).toBe('unavailable')
    expect(body.meta.provider.status).toBe('http_error')
    expect(body.data.zones).toHaveLength(6)
    expect(text).not.toMatch(/"totalMm":\s*-?\d/)
    expect(text).not.toMatch(LEAK)
  })

  it('does not hammer a failing provider: no second call inside the cool-down, a retry after it', async () => {
    const t = createTestDb()
    const w = world(async () => jsonRes({}, 500))
    await get(t.env, w.deps)
    w.state.now += 5_000
    const second = await get(t.env, w.deps)
    expect(w.state.calls).toBe(1)
    expect(second.body.meta.provider.status).toBe('http_error') // remembered failure, not a fresh claim of success
    w.state.now += FAILURE_COOLDOWN_MS
    await get(t.env, w.deps)
    expect(w.state.calls).toBe(2)
  })

  it('recovers: after a failure, a successful refresh returns live data again', async () => {
    const { t, w } = await primed()
    w.state.now += 2 * 3600_000
    w.state.respond = async () => jsonRes({}, 500)
    expect((await get(t.env, w.deps)).body.meta.status).toBe('stale')
    w.state.now += FAILURE_COOLDOWN_MS + 1
    w.state.respond = async () => jsonRes(providerBody(await loadZoneLocations(t.db)))
    const { body } = await get(t.env, w.deps)
    expect(body.meta).toMatchObject({ status: 'live', cache: 'refreshed' })
  })

  it('never leaks provider details, URLs or internals', async () => {
    const t = createTestDb()
    const w = world(async () => {
      throw new Error(LEAKY_MESSAGE)
    })
    const { text } = await get(t.env, w.deps)
    expect(text).not.toMatch(LEAK)
  })
})

describe('partial results', () => {
  it('marks only the failing zone unavailable and the rest live; the whole response is partial', async () => {
    const t = createTestDb()
    const locs = await loadZoneLocations(t.db)
    const body = providerBody(locs, { mutate: (i, loc) => (i === 4 ? { ...loc, hourly_units: { precipitation: 'inch' } } : undefined) })
    const { body: out } = await get(t.env, world(async () => jsonRes(body)).deps)
    const aizawl = out.data.zones.find((z) => z.id === 'aizawl')!
    expect(aizawl.status).toBe('unavailable')
    expect(aizawl.past.totalMm).toBeNull()
    expect(out.data.zones.filter((z) => z.status === 'live')).toHaveLength(5)
    expect(out.meta).toMatchObject({ status: 'live', partial: true })
  })

  it('keeps a zone usable when only its forecast (or only its past) is incomplete', async () => {
    const t = createTestDb()
    const locs = await loadZoneLocations(t.db)
    const b = providerBody(locs, { override: (i, s) => (i === 0 && s === FLOOR_MS + 5 * 3600_000 ? null : undefined) })
    const { body } = await get(t.env, world(async () => jsonRes(b)).deps)
    const z = body.data.zones[0]
    expect(z.status).toBe('live')
    expect(z.forecast).toMatchObject({ status: 'unavailable', totalMm: null })
    expect(z.past.totalMm).toBe(expectedPast(0))
    expect(body.meta.partial).toBe(true)
  })

  it('does not overwrite good cached data with a response that has no usable zone', async () => {
    const t = createTestDb()
    const w = world()
    await get(t.env, w.deps)
    w.state.now += 2 * 3600_000
    const locs = await loadZoneLocations(t.db)
    const bad = providerBody(locs, { mutate: (_i, loc) => ({ ...loc, hourly_units: { precipitation: 'mm/h' } }) })
    w.state.respond = async () => jsonRes(bad)
    const { body } = await get(t.env, w.deps)
    expect(body.meta).toMatchObject({ status: 'stale', provider: { status: 'invalid_response' } })
    expect(body.data.zones[0].past.totalMm).toBe(expectedPast(0))
  })
})

describe('database and health boundaries', () => {
  it('returns the standard 503 when zones cannot be read, without leaking details', async () => {
    const broken: Env = { DB: { prepare() { throw new Error(LEAKY_MESSAGE) } } }
    const w = world()
    const { res, text, body } = await get(broken, w.deps)
    expect(res.status).toBe(503)
    expect(body.error?.code).toBe('database_unavailable')
    expect(text).not.toMatch(LEAK)
    expect(w.state.calls).toBe(0)
  })

  it('returns an empty, unavailable response (and calls no provider) when there are no zones', async () => {
    const t = createTestDb({ seed: false })
    const w = world()
    const { res, body } = await get(t.env, w.deps)
    expect(res.status).toBe(200)
    expect(body.data.zones).toEqual([])
    expect(body.meta).toMatchObject({ status: 'unavailable', count: 0 })
    expect(w.state.calls).toBe(0)
  })

  it('keeps /api/health independent of weather: it never calls the provider and stays ok when the provider is down', async () => {
    const t = createTestDb()
    const w = world(async () => jsonRes({}, 500))
    const { res, body } = await get(t.env, w.deps, '/api/health')
    expect(res.status).toBe(200)
    expect((body as unknown as { data: { status: string } }).data.status).toBe('ok')
    expect(w.state.calls).toBe(0)
  })
})

describe('risk scoring is untouched by weather (demo / live / unavailable boundary)', () => {
  const GOLDEN: Record<string, [number, number]> = {
    guwahati: [23.3, 35],
    itanagar: [34.5, 40],
    kohima: [44.8, 55],
    shillong: [57.1, 90],
    aizawl: [63.3, 110],
    gangtok: [78.8, 160],
  }

  it('leaves every score and the demo rainfall input exactly as in Phase 4 after live weather is fetched', async () => {
    const t = createTestDb()
    const w = world()
    const before = await handleRequest(new Request('http://localhost/api/zones'), t.env, w.deps).then((r) => r.json())
    expect((await get(t.env, w.deps)).body.meta.status).toBe('live')
    const after = (await handleRequest(new Request('http://localhost/api/zones'), t.env, w.deps).then((r) => r.json())) as typeof before
    expect(after).toEqual(before)

    for (const z of after.data.zones) {
      const [score, rain] = GOLDEN[z.id]
      expect(z.assessment.result.score).toBe(score)
      // The demo rainfall (35, 40, ...) is NOT replaced by the fetched past-72h total (7.2, 14.4, ...).
      expect(z.inputs.rainfall72hMm).toEqual({ value: rain, source: 'demo' })
      for (const k of INPUT_KEYS) expect(z.inputs[k].source).toBe('demo')
    }
    expect(after.meta.demoData).toBe(true)
  })

  it('is unaffected by a weather outage too', async () => {
    const t = createTestDb()
    const w = world(async () => jsonRes({}, 500))
    await get(t.env, w.deps)
    const zones = (await handleRequest(new Request('http://localhost/api/zones'), t.env, w.deps).then((r) => r.json())) as { data: { zones: { id: string; assessment: { result: { score: number } } }[] } }
    expect(zones.data.zones.map((z) => z.assessment.result.score)).toEqual(Object.values(GOLDEN).map(([s]) => s))
  })
})
