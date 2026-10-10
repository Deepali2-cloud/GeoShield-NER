import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { DEMO_ZONES } from '../src/data/demoZones'
import { isWeatherUrl, jsonResponse, stubFetch, stubApiResponse, weatherPayload, zonesPayload } from './fixtures/apiZones'

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )

const NAMES = DEMO_ZONES.map((z) => z.name)

/** Nothing from the hard-coded dataset may appear when the API did not supply it. */
function expectNoZoneData() {
  for (const name of NAMES) expect(screen.queryByText(name)).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: /monitoring zones/i })).not.toBeInTheDocument()
  expect(screen.queryByTestId('zone-map')).not.toBeInTheDocument()
}

describe('Dashboard data loading from GET /api/zones', () => {
  it('shows a loading state while the request is pending, then the zones', async () => {
    let release!: (r: Response) => void
    const fetchFn = stubFetch(() => new Promise<Response>((resolve) => { release = resolve }) as unknown as Response)
    renderDashboard()
    expect(screen.getByText(/loading monitoring zones/i)).toBeInTheDocument()
    expectNoZoneData()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(String(fetchFn.mock.calls[0][0])).toBe('/api/zones')

    release(jsonResponse(zonesPayload()))
    const list = await screen.findByRole('region', { name: /monitoring zones/i })
    expect(within(list).getAllByRole('button')).toHaveLength(6)
    expect(screen.queryByText(/loading monitoring zones/i)).not.toBeInTheDocument()
  })

  it('renders the API-calculated scores in the list and map', async () => {
    stubFetch(() => jsonResponse(zonesPayload()))
    renderDashboard()
    await screen.findByRole('region', { name: /monitoring zones/i })
    expect(screen.getByTestId('list-score-gangtok')).toHaveTextContent('78.8')
    expect(screen.getByTestId('list-score-guwahati')).toHaveTextContent('23.3')
    expect(screen.getByTestId('zone-map').querySelectorAll('.leaflet-marker-icon')).toHaveLength(6)
  })

  it('shows an empty state (not an error, not demo data) when the API returns no zones', async () => {
    stubFetch(() => jsonResponse(zonesPayload([])))
    renderDashboard()
    expect(await screen.findByText(/no monitoring zones found/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectNoZoneData()
  })

  it('shows a retryable error on a network failure and never falls back to demo data', async () => {
    const fetchFn = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')) as unknown as Response)
    renderDashboard()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/cannot reach the api/i)
    expect(alert).toHaveTextContent(/no placeholder or cached zones/i)
    expectNoZoneData()

    // Retry succeeds once the API is back.
    fetchFn.mockImplementation((input) => {
      const url = String(input)
      return Promise.resolve(stubApiResponse(url) ?? jsonResponse(isWeatherUrl(url) ? weatherPayload() : zonesPayload()))
    })
    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('region', { name: /monitoring zones/i })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Phase 5: the weather request only starts after zones loaded, so zone requests are still exactly two.
    expect(fetchFn.mock.calls.filter(([u]) => String(u) === '/api/zones')).toHaveLength(2)
  })

  it('shows an error for an HTTP 503 using only the safe API message', async () => {
    stubFetch(() => jsonResponse({ error: { code: 'database_unavailable', message: 'The database is currently unavailable.' } }, 503))
    renderDashboard()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/the api returned an error/i)
    expect(alert).toHaveTextContent('The database is currently unavailable. (HTTP 503)')
    expect(within(alert).getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expectNoZoneData()
  })

  it('shows an error for a non-JSON error body', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    renderDashboard()
    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP 502/)
    expectNoZoneData()
  })

  it.each([
    ['not JSON', () => new Response('nope', { status: 200 })],
    ['wrong shape', () => jsonResponse({ zones: [] })],
    ['a zone without coordinates', () => {
      const p = zonesPayload()
      delete (p.data.zones[0] as Partial<(typeof p.data.zones)[0]>).latitude
      return jsonResponse(p)
    }],
  ])('treats an invalid 200 response (%s) as an error and shows no zones', async (_label, make) => {
    stubFetch(() => make())
    renderDashboard()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not be used/i)
    expect(alert).toHaveTextContent(/unexpected format/i)
    expectNoZoneData()
  })

  it('keeps selection, panel and accessibility behaviour working with API data', async () => {
    stubFetch(() => jsonResponse(zonesPayload()))
    renderDashboard()
    const list = await screen.findByRole('region', { name: /monitoring zones/i })
    await userEvent.click(within(list).getByRole('button', { name: /shillong/i }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Shillong' })).toBeInTheDocument())
    expect(screen.getByTestId('panel-score')).toHaveTextContent('57.1')
    expect(within(list).getByRole('button', { name: /shillong/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a zone whose inputs are invalid as unavailable, with no score', async () => {
    const payload = zonesPayload()
    const z = payload.data.zones[0]
    z.inputs.rainfall72hMm.value = null
    z.assessment = { ok: false, errors: ['Rainfall (past 72 h): missing'] }
    stubFetch(() => jsonResponse(payload))
    renderDashboard()
    const list = await screen.findByRole('region', { name: /monitoring zones/i })
    expect(within(list).getAllByText('UNAVAILABLE').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('list-score-guwahati')).not.toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: /guwahati/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Rainfall \(past 72 h\): missing/)
  })

  it('keeps the safety disclaimer and navigation in every state', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')) as unknown as Response)
    renderDashboard()
    await screen.findByRole('alert')
    expect(screen.getByText(/not an official emergency warning system/i)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /dashboard/i }).length).toBeGreaterThan(0)
  })
})
