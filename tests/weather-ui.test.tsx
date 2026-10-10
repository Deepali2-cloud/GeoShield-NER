import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { DEMO_ZONES } from '../src/data/demoZones'
import { SelectedZonePanel } from '../src/components/SelectedZonePanel'
import { assessZone } from '../src/risk/zoneRisk'
import { WEATHER_VALUES, isWeatherUrl, jsonResponse, stubFetch, unavailableZoneWeather, weatherPayload, zonesPayload } from './fixtures/apiZones'

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderApp = () =>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )

const zonesRegion = () => screen.findByRole('region', { name: /monitoring zones/i })
const weatherSection = () => screen.getByRole('region', { name: /weather \(open-meteo\)/i })
const zoneButton = (name: RegExp) => within(screen.getByRole('region', { name: /monitoring zones/i })).getByRole('button', { name })

function stubApi(weather: () => Promise<Response> | Response) {
  return stubFetch(() => jsonResponse(zonesPayload()), { weather })
}

describe('weather panel: loading and success', () => {
  it('shows a loading state while weather is pending, and the zones and map are already usable', async () => {
    let release!: (r: Response) => void
    stubApi(() => new Promise<Response>((resolve) => { release = resolve }) as unknown as Response)
    renderApp()
    await zonesRegion()
    expect(within(weatherSection()).getByText(/loading weather/i)).toBeInTheDocument()
    expect(screen.queryByTestId('weather-past-guwahati')).not.toBeInTheDocument() // no values before they exist

    // zone selection works while weather is still loading
    await userEvent.click(zoneButton(/guwahati/i))
    expect(screen.getByTestId('panel-score')).toBeInTheDocument()
    expect(screen.getByTestId('zone-weather')).toHaveTextContent(/loading weather/i)

    release(jsonResponse(weatherPayload('live')))
    expect(await screen.findByTestId('weather-past-guwahati')).toBeInTheDocument()
    expect(within(weatherSection()).queryByText(/loading weather/i)).not.toBeInTheDocument()
  })

  it('shows past and forecast mm for the right zone, units, window, retrieval time and a Live badge', async () => {
    stubApi(() => jsonResponse(weatherPayload('live')))
    renderApp()
    await zonesRegion()
    for (const z of DEMO_ZONES) {
      const v = WEATHER_VALUES[z.id]
      expect(await screen.findByTestId(`weather-past-${z.id}`)).toHaveTextContent(`${v.past.toFixed(1)} mm`)
      expect(screen.getByTestId(`weather-forecast-${z.id}`)).toHaveTextContent(`${v.forecast.toFixed(1)} mm`)
    }
    const section = weatherSection()
    expect(within(section).getAllByText('Past 72 h (mm)').length).toBe(1)
    expect(within(section).getByText('Forecast next 24 h (mm)')).toBeInTheDocument()
    expect(within(section).getAllByTestId('weather-status')[0]).toHaveTextContent('Live')
    expect(screen.getByTestId('weather-retrieved')).toHaveTextContent(/10 Oct 03:00 UTC/)
    expect(section).toHaveTextContent(/model-derived, not gauge-measured/i)
    expect(section).toHaveTextContent(/a prediction/i)
    expect(section).toHaveTextContent(/07 Oct 03:00 UTC → 10 Oct 03:00 UTC/) // past window
    expect(section).toHaveTextContent(/10 Oct 03:00 UTC → 11 Oct 03:00 UTC/) // forecast window
  })

  it('requests weather once per load, not on every render or selection', async () => {
    const fn = stubApi(() => jsonResponse(weatherPayload('live')))
    renderApp()
    await zonesRegion()
    await screen.findByTestId('weather-past-guwahati')
    await userEvent.click(zoneButton(/shillong/i))
    await userEvent.click(zoneButton(/kohima/i))
    expect(fn.mock.calls.filter(([u]) => isWeatherUrl(String(u)))).toHaveLength(1)
  })

  it('shows the selected zone’s own weather in its detail panel', async () => {
    stubApi(() => jsonResponse(weatherPayload('live')))
    renderApp()
    await zonesRegion()
    await userEvent.click(zoneButton(/shillong/i))
    await screen.findByTestId('weather-past-shillong')
    expect(screen.getByTestId('zone-weather-past')).toHaveTextContent(`${WEATHER_VALUES.shillong.past.toFixed(1)} mm`)
    expect(screen.getByTestId('zone-weather-forecast')).toHaveTextContent(`${WEATHER_VALUES.shillong.forecast.toFixed(1)} mm`)
    expect(screen.getByTestId('zone-weather')).toHaveTextContent(/not a gauge reading/i)
    await userEvent.click(zoneButton(/gangtok/i))
    expect(screen.getByTestId('zone-weather-past')).toHaveTextContent(`${WEATHER_VALUES.gangtok.past.toFixed(1)} mm`)
  })
})

describe('weather panel: stale, unavailable and partial', () => {
  it('labels stale data as stale, with its age, and says it is not current', async () => {
    stubApi(() => jsonResponse(weatherPayload('stale')))
    renderApp()
    await screen.findByTestId('weather-past-guwahati')
    const section = weatherSection()
    expect(within(section).getAllByTestId('weather-status')[0]).toHaveTextContent('Stale')
    expect(section).toHaveTextContent(/stale data/i)
    expect(section).toHaveTextContent(/2 h old/)
    expect(section).toHaveTextContent(/not current/i)
    expect(within(section).queryByText('Live')).not.toBeInTheDocument() // nothing claims to be live
  })

  it('shows an unavailable state with no values, no estimates and a retry action', async () => {
    const fn = stubApi(() => jsonResponse(weatherPayload('unavailable')))
    renderApp()
    await zonesRegion()
    const section = await waitFor(() => {
      const s = weatherSection()
      expect(within(s).getByText(/weather data unavailable/i)).toBeInTheDocument()
      return s
    })
    expect(section).toHaveTextContent(/nothing has been estimated/i)
    expect(within(section).queryByText(/\d mm/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('weather-past-guwahati')).not.toBeInTheDocument()

    fn.mockImplementation((input) => Promise.resolve(jsonResponse(isWeatherUrl(String(input)) ? weatherPayload('live') : zonesPayload())))
    await userEvent.click(within(section).getByRole('button', { name: /retry weather/i }))
    expect(await screen.findByTestId('weather-past-guwahati')).toBeInTheDocument()
  })

  it('marks a missing zone as unavailable while the others keep their values', async () => {
    const p = weatherPayload('live')
    p.data.zones[3] = unavailableZoneWeather(DEMO_ZONES[3]) // shillong
    p.meta.partial = true
    stubApi(() => jsonResponse(p))
    renderApp()
    expect(await screen.findByTestId('weather-past-guwahati')).toHaveTextContent('mm')
    expect(screen.getByTestId('weather-past-shillong')).toHaveTextContent('Unavailable')
    expect(screen.getByTestId('weather-forecast-shillong')).toHaveTextContent('Unavailable')
    expect(weatherSection()).toHaveTextContent(/some zones or values are unavailable/i)
    await userEvent.click(zoneButton(/shillong/i))
    expect(screen.getByTestId('zone-weather')).toHaveTextContent(/no weather data for this zone/i)
  })

  it('shows an unavailable forecast while keeping the past value when only the forecast is missing', async () => {
    const p = weatherPayload('live')
    p.data.zones[0].forecast = { kind: 'forecast', status: 'unavailable', totalMm: null, unit: 'mm', window: null }
    p.meta.partial = true
    stubApi(() => jsonResponse(p))
    renderApp()
    expect(await screen.findByTestId('weather-past-guwahati')).toHaveTextContent(`${WEATHER_VALUES.guwahati.past.toFixed(1)} mm`)
    expect(screen.getByTestId('weather-forecast-guwahati')).toHaveTextContent('Unavailable')
  })
})

describe('weather panel: errors and retry', () => {
  it('shows a retryable error on a network failure without breaking zones, map or selection', async () => {
    const fn = stubApi(() => Promise.reject(new TypeError('offline')) as unknown as Response)
    renderApp()
    await zonesRegion()
    const section = weatherSection()
    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent(/weather could not be loaded/i)
    expect(alert).toHaveTextContent(/could not reach the weather service/i)
    expect(alert).toHaveTextContent(/no weather values are shown or estimated/i)
    expect(screen.queryByTestId('weather-past-guwahati')).not.toBeInTheDocument()

    // zones, map, list and selection are unaffected
    expect(screen.getByTestId('zone-map').querySelectorAll('.leaflet-marker-icon')).toHaveLength(6)
    await userEvent.click(zoneButton(/aizawl/i))
    expect(screen.getByTestId('panel-score')).toHaveTextContent('63.3')
    expect(screen.getByTestId('zone-weather')).toHaveTextContent(/weather unavailable/i)

    fn.mockImplementation((input) => Promise.resolve(jsonResponse(isWeatherUrl(String(input)) ? weatherPayload('live') : zonesPayload())))
    await userEvent.click(within(section).getByRole('button', { name: /retry weather/i }))
    expect(await screen.findByTestId('weather-past-aizawl')).toBeInTheDocument()
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the safe API message for an HTTP error', async () => {
    stubApi(() => jsonResponse({ error: { code: 'database_unavailable', message: 'The database is currently unavailable.' } }, 503))
    renderApp()
    await zonesRegion()
    expect(await within(weatherSection()).findByRole('alert')).toHaveTextContent('The database is currently unavailable. (HTTP 503)')
  })

  it('rejects a malformed weather payload instead of showing any of it', async () => {
    const p = weatherPayload('live')
    p.data.zones[0].past.unit = 'inch' as never
    stubApi(() => jsonResponse(p))
    renderApp()
    await zonesRegion()
    expect(await within(weatherSection()).findByRole('alert')).toHaveTextContent(/unexpected format/i)
    expect(screen.queryByTestId('weather-past-guwahati')).not.toBeInTheDocument()
  })

  it('shows a clear error when the request is slow and times out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      stubFetch(() => jsonResponse(zonesPayload()), {
        weather: () => new Promise<Response>(() => undefined) as unknown as Response, // never answers; the client timeout must end it
      })
      // The real client aborts via AbortController; make the stubbed fetch honour the signal.
      const original = globalThis.fetch
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        isWeatherUrl(String(input))
          ? new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))
          : original(input, init),
      )
      renderApp()
      await zonesRegion()
      expect(within(weatherSection()).getByText(/loading weather/i)).toBeInTheDocument()
      await vi.advanceTimersByTimeAsync(16_000)
      expect(await within(weatherSection()).findByRole('alert')).toHaveTextContent(/took too long/i)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('risk score provenance in the UI', () => {
  it('labels the selected score as demo-derived and says weather is not part of it', async () => {
    stubApi(() => jsonResponse(weatherPayload('live')))
    renderApp()
    await zonesRegion()
    await userEvent.click(zoneButton(/gangtok/i))
    expect(screen.getByTestId('score-basis')).toHaveTextContent(/demo-derived/i)
    expect(screen.getByTestId('score-basis')).toHaveTextContent(/weather shown below is not used in this score/i)
    expect(screen.getByTestId('panel-score')).toHaveTextContent('78.8') // unchanged by live weather
  })

  it('keeps every Phase 4 score identical whatever the weather state', async () => {
    for (const status of ['live', 'stale', 'unavailable'] as const) {
      stubApi(() => jsonResponse(weatherPayload(status)))
      const { unmount } = renderApp()
      await zonesRegion()
      expect(screen.getByTestId('list-score-guwahati')).toHaveTextContent('23.3')
      expect(screen.getByTestId('list-score-gangtok')).toHaveTextContent('78.8')
      unmount()
      vi.unstubAllGlobals()
    }
  })

  it('labels a partly-live score as partly live, never as live (component level)', () => {
    const zone = structuredClone(DEMO_ZONES[0])
    zone.inputs.rainfall72hMm.source = 'live'
    const a = assessZone(zone)
    render(<SelectedZonePanel zone={zone} assessment={a} />)
    expect(screen.getByTestId('score-basis')).toHaveTextContent(/partly live/i)
    expect(screen.getByTestId('score-basis')).toHaveTextContent(/not a fully live score/i)
  })

  it('shows no basis line and no score for an unscorable zone', () => {
    const zone = structuredClone(DEMO_ZONES[0])
    zone.inputs.rainfall72hMm.value = Number.NaN
    render(<SelectedZonePanel zone={zone} assessment={assessZone(zone)} />)
    expect(screen.queryByTestId('score-basis')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-score')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/risk score unavailable/i)
  })

  it('keeps the safety disclaimer visible with weather in any state', async () => {
    stubApi(() => jsonResponse(weatherPayload('unavailable')))
    renderApp()
    await zonesRegion()
    expect(screen.getByText(/not an official emergency warning system/i)).toBeInTheDocument()
  })
})
