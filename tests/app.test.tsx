import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { DEMO_ZONES } from '../src/data/demoZones'
import { ScoreMethodCard } from '../src/components/ScoreMethodCard'
import { SelectedZonePanel } from '../src/components/SelectedZonePanel'
import { ZoneList } from '../src/components/ZoneList'
import { assessZone } from '../src/risk/zoneRisk'
import type { Zone } from '../src/types'
import { stubZonesApi } from './fixtures/apiZones'
import { DISCLAIMER, RISK_LEVELS, RISK_STYLES, formatScore } from '../src/utils/riskDisplay'

const zoneList = () => within(screen.getByRole('region', { name: /monitoring zones/i }))

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The dashboard loads zones from GET /api/zones, so tests serve the API response from a stubbed fetch. */
async function renderAt(path = '/') {
  stubZonesApi()
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  if (path === '/') await screen.findByRole('region', { name: /monitoring zones/i })
  return view
}

describe('Dashboard shell', () => {
  it('shows branding, disclaimer and the demo/local status', async () => {
    await renderAt()
    expect(screen.getAllByText('GeoShield-NER').length).toBeGreaterThan(0)
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
    // Phase 5 adds a weather region that can also be a status region, so look for the demo/local one among them.
    expect(screen.getAllByRole('status').some((el) => /demo \/ local/i.test(el.textContent ?? ''))).toBe(true)
  })

  it('lists six seeded zones', async () => {
    await renderAt()
    const list = screen.getByRole('region', { name: /monitoring zones/i })
    expect(within(list).getAllByRole('button')).toHaveLength(6)
    for (const name of ['Guwahati', 'Shillong', 'Aizawl', 'Kohima', 'Gangtok', 'Itanagar']) {
      expect(within(list).getByText(name)).toBeInTheDocument()
    }
  })

  it('shows all four risk levels in the legend with text labels', async () => {
    await renderAt()
    const legend = screen.getByRole('region', { name: /risk legend/i })
    for (const level of RISK_LEVELS) expect(within(legend).getByText(level)).toBeInTheDocument()
  })

  it('selecting a zone updates the detail panel', async () => {
    await renderAt()
    expect(screen.getByText(/select a monitoring zone/i)).toBeInTheDocument()
    await userEvent.click(zoneList().getByRole('button', { name: /gangtok/i }))
    const panel = screen.getByRole('region', { name: 'Gangtok' })
    expect(within(panel).getByText(/calculated demo score/i)).toBeInTheDocument()
    expect(zoneList().getByRole('button', { name: /gangtok/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders the interactive map with OSM attribution and no live-data claims', async () => {
    await renderAt()
    expect(screen.getByRole('region', { name: /monitoring map/i })).toBeInTheDocument()
    expect(screen.queryByText('Map placeholder')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    expect(screen.queryByText(/live weather/i)).not.toBeInTheDocument()
  })

  it('renders one keyboard-focusable marker per zone, labelled with level text', async () => {
    await renderAt()
    const map = screen.getByTestId('zone-map')
    const markers = map.querySelectorAll('.leaflet-marker-icon')
    expect(markers).toHaveLength(DEMO_ZONES.length)
    for (const z of DEMO_ZONES) {
      const m = map.querySelector(`[title^="${z.name},"]`)
      expect(m).not.toBeNull()
      expect(m).toHaveAttribute('tabindex', '0')
      const a = assessZone(z)
      expect(a.ok).toBe(true)
      if (a.ok) expect(m!.getAttribute('title')).toMatch(new RegExp(RISK_STYLES[a.result.level].label))
    }
  })

  it('keeps marker clicks, list selection and the detail panel in sync', async () => {
    await renderAt()
    const map = screen.getByTestId('zone-map')
    await userEvent.click(map.querySelector('[title^="Shillong,"]')!)
    expect(screen.getByRole('region', { name: 'Shillong' })).toBeInTheDocument()
    expect(zoneList().getByRole('button', { name: /shillong/i })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(zoneList().getByRole('button', { name: /aizawl/i }))
    expect(screen.getByRole('region', { name: 'Aizawl' })).toBeInTheDocument()
    const aizawl = map.querySelector('[title^="Aizawl,"]')!
    const shillong = map.querySelector('[title^="Shillong,"]')!
    expect(aizawl).toHaveAttribute('aria-pressed', 'true')
    expect(aizawl.getAttribute('title')).toMatch(/selected/)
    expect(aizawl).toHaveClass('gs-selected')
    expect(shillong).toHaveAttribute('aria-pressed', 'false')
    expect(shillong.getAttribute('title')).not.toMatch(/selected/)
    // the same DOM node is reused, so keyboard focus is never lost on selection
    expect(map.querySelector('[title^="Aizawl,"]')).toBe(aizawl)
  })

  it('selects a focused marker with Enter and Space', async () => {
    await renderAt()
    const map = screen.getByTestId('zone-map')
    const kohima = map.querySelector<HTMLElement>('[title^="Kohima,"]')!
    kohima.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('region', { name: 'Kohima' })).toBeInTheDocument()
    const gangtok = map.querySelector<HTMLElement>('[title^="Gangtok,"]')!
    gangtok.focus()
    await userEvent.keyboard(' ')
    expect(screen.getByRole('region', { name: 'Gangtok' })).toBeInTheDocument()
  })

  it('does not request browser geolocation', async () => {
    const getCurrentPosition = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition, watchPosition: vi.fn() }, configurable: true })
    await renderAt()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })
})

describe('Navigation', () => {
  it('renders the report and admin placeholder pages', async () => {
    await renderAt('/report')
    expect(screen.getByRole('heading', { name: /citizen hazard reporting/i })).toBeInTheDocument()
  })
  it('renders admin page', async () => {
    await renderAt('/admin')
    expect(await screen.findByRole('heading', { name: /administrator access/i })).toBeInTheDocument()
  })
})

describe('Risk engine integration in the UI', () => {
  it('shows the same calculated score and level in the list, map marker and panel for every zone', async () => {
    await renderAt()
    const map = screen.getByTestId('zone-map')
    for (const z of DEMO_ZONES) {
      const a = assessZone(z)
      expect(a.ok).toBe(true)
      if (!a.ok) continue
      const expected = formatScore(a.result.score)
      // list
      expect(screen.getByTestId(`list-score-${z.id}`)).toHaveTextContent(expected)
      const row = zoneList().getByRole('button', { name: new RegExp(z.name) })
      expect(within(row).getByText(a.result.level)).toBeInTheDocument()
      // marker
      const marker = map.querySelector(`[title^="${z.name},"]`)!
      expect(marker.getAttribute('title')).toContain(`calculated demo score ${expected}`)
      expect(marker.getAttribute('title')).toContain(RISK_STYLES[a.result.level].label)
      // panel
      await userEvent.click(row)
      expect(screen.getByTestId('panel-score')).toHaveTextContent(expected)
      const panel = screen.getByRole('region', { name: z.name })
      expect(within(panel).getByText(a.result.level)).toBeInTheDocument()
    }
  })

  it('shows the five factors with weights and demo labelling in the panel', async () => {
    await renderAt()
    await userEvent.click(zoneList().getByRole('button', { name: /gangtok/i }))
    const panel = screen.getByRole('region', { name: 'Gangtok' })
    for (const symbol of ['R ·', 'S ·', 'H ·', 'G ·', 'E ·']) expect(within(panel).getByText(new RegExp(`^${symbol}`))).toBeInTheDocument()
    expect(within(panel).getAllByText(/Demo input/)).toHaveLength(5)
    for (const [w, n] of [['0.35', 1], ['0.25', 1], ['0.20', 1], ['0.10', 2]] as const) {
      expect(within(panel).getAllByText(new RegExp(`× weight ${w.replace('.', '\\.')}`))).toHaveLength(n)
    }
    expect(within(panel).getByText(/not machine learning, not live data, not a validated forecast/i)).toBeInTheDocument()
  })

  it('states on the dashboard that the score is rule-based and not a forecast, and shows the formula', async () => {
    await renderAt()
    const card = screen.getByRole('region', { name: /how the score works/i })
    expect(within(card).getByText(/not machine learning/i)).toBeInTheDocument()
    expect(within(card).getByText(/not a validated landslide forecast/i)).toBeInTheDocument()
    expect(within(card).getByText(/0\.35R \+ 0\.25S \+ 0\.20H \+ 0\.10G \+ 0\.10E/)).toBeInTheDocument()
  })

  it('legend uses the agreed fractional-safe boundaries', async () => {
    await renderAt()
    const legend = screen.getByRole('region', { name: /risk legend/i })
    expect(within(legend).getByText('Score below 30')).toBeInTheDocument()
    expect(within(legend).getByText('Score 30 to below 50')).toBeInTheDocument()
    expect(within(legend).getByText('Score 50 to below 70')).toBeInTheDocument()
    expect(within(legend).getByText('Score 70 and above')).toBeInTheDocument()
  })

  it('summary cards derive from calculated scores', async () => {
    await renderAt()
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(within(summary).getByText('Gangtok')).toBeInTheDocument()
    expect(within(summary).getByText(/Score 78\.8 \(demo inputs\)/)).toBeInTheDocument()
    expect(within(summary).getByText(/Zones scoring 50\+/).previousElementSibling).toHaveTextContent('3')
  })
})

describe('Invalid zone inputs', () => {
  const broken: Zone = {
    ...DEMO_ZONES[0],
    id: 'broken',
    name: 'Brokenville',
    inputs: { ...DEMO_ZONES[0].inputs, rainfall72hMm: { value: NaN, source: 'demo' } },
  }

  it('shows an unavailable state in the list and panel instead of inventing a score', () => {
    const assessments = { broken: assessZone(broken) }
    render(
      <>
        <ZoneList zones={[broken]} assessments={assessments} selectedId="broken" onSelect={() => {}} />
        <SelectedZonePanel zone={broken} assessment={assessments.broken} />
      </>,
    )
    expect(screen.getAllByText('UNAVAILABLE').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert')).toHaveTextContent(/risk score unavailable/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/Rainfall \(past 72 h\): must be a finite number/)
    expect(screen.queryByTestId('panel-score')).not.toBeInTheDocument()
    expect(screen.queryByTestId('list-score-broken')).not.toBeInTheDocument()
  })

  it('method card renders standalone', () => {
    render(<ScoreMethodCard />)
    expect(screen.getByText(/prototype assumptions/i)).toBeInTheDocument()
  })
})
