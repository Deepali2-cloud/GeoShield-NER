import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { jsonResponse, stubFetch, zonesPayload } from './fixtures/apiZones'
import type { ApiReport } from '../src/types/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

const sampleReports: ApiReport[] = [
  {
    id: 'rep-1',
    zoneId: 'gangtok',
    category: 'Landslide',
    title: 'Debris over roadway',
    description: 'Active mud and boulders observed near mile 12.',
    latitude: 27.33,
    longitude: 88.61,
    status: 'pending',
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-10T08:00:00.000Z',
  },
]

describe('Citizen Reporting UI — /report', () => {
  it('renders the citizen reporting page with form and disclaimer', async () => {
    stubFetch(
      (url) => {
        if (url.includes('/api/zones')) return jsonResponse(zonesPayload())
        return jsonResponse({})
      },
      { reports: () => jsonResponse({ data: { reports: sampleReports } }) },
    )

    render(
      <MemoryRouter initialEntries={['/report']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: /citizen hazard reporting/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /report a hazard/i })).toBeInTheDocument()
    expect(screen.getByText(/citizen reports are community-submitted and unverified/i)).toBeInTheDocument()
    expect(screen.getByText('Debris over roadway')).toBeInTheDocument()
    expect(screen.getAllByText(/pending review/i).length).toBeGreaterThan(0)
  })

  it('validates required fields before submitting', async () => {
    const user = userEvent.setup()
    stubFetch((url) => {
      if (url.includes('/api/zones')) return jsonResponse(zonesPayload())
      if (url.includes('/api/reports')) return jsonResponse({ data: { reports: [] } })
      return jsonResponse({})
    })

    render(
      <MemoryRouter initialEntries={['/report']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { level: 1, name: /citizen hazard reporting/i })

    const submitBtn = screen.getByRole('button', { name: /submit hazard report/i })
    await user.click(submitBtn)

    expect(screen.getByText(/please select a monitoring zone/i)).toBeInTheDocument()
    expect(screen.getByText(/please select a hazard category/i)).toBeInTheDocument()
    expect(screen.getByText(/title is required/i)).toBeInTheDocument()
    expect(screen.getByText(/description is required/i)).toBeInTheDocument()
  })

  it('validates coordinate pairs (both required if one is entered)', async () => {
    const user = userEvent.setup()
    stubFetch((url) => {
      if (url.includes('/api/zones')) return jsonResponse(zonesPayload())
      if (url.includes('/api/reports')) return jsonResponse({ data: { reports: [] } })
      return jsonResponse({})
    })

    render(
      <MemoryRouter initialEntries={['/report']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { level: 1, name: /citizen hazard reporting/i })

    await user.selectOptions(screen.getByLabelText(/monitored zone/i), 'gangtok')
    await user.selectOptions(screen.getByLabelText(/hazard category/i), 'Landslide')
    await user.type(screen.getByLabelText(/short title/i), 'Road crack')
    await user.type(screen.getByLabelText(/detailed description/i), 'A large crack across the road.')
    await user.type(screen.getByLabelText(/latitude/i), '27.33')

    const submitBtn = screen.getByRole('button', { name: /submit hazard report/i })
    await user.click(submitBtn)

    expect(screen.getByText(/both latitude and longitude must be provided/i)).toBeInTheDocument()
  })

  it('submits a report successfully and shows the confirmation banner with ID and pending status', async () => {
    const user = userEvent.setup()

    stubFetch((url) => {
      if (url.includes('/api/zones')) return jsonResponse(zonesPayload())
      if (url.includes('/api/reports')) {
        return jsonResponse({
          data: {
            report: {
              id: 'rep-new-123',
              zoneId: 'gangtok',
              category: 'Landslide',
              title: 'Fresh slide on hillside',
              description: 'Small earth movement witnessed this morning.',
              latitude: 27.35,
              longitude: 88.62,
              status: 'pending',
              createdAt: '2026-10-10T09:00:00.000Z',
              updatedAt: '2026-10-10T09:00:00.000Z',
            },
          },
        })
      }
      return jsonResponse({})
    })

    render(
      <MemoryRouter initialEntries={['/report']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { level: 1, name: /citizen hazard reporting/i })

    await user.selectOptions(screen.getByLabelText(/monitored zone/i), 'gangtok')
    await user.selectOptions(screen.getByLabelText(/hazard category/i), 'Landslide')
    await user.type(screen.getByLabelText(/short title/i), 'Fresh slide on hillside')
    await user.type(screen.getByLabelText(/detailed description/i), 'Small earth movement witnessed this morning.')
    await user.type(screen.getByLabelText(/latitude/i), '27.35')
    await user.type(screen.getByLabelText(/longitude/i), '88.62')

    const submitBtn = screen.getByRole('button', { name: /submit hazard report/i })
    await user.click(submitBtn)

    expect(await screen.findByText(/hazard report submitted/i)).toBeInTheDocument()
    expect(screen.getByText('rep-new-123')).toBeInTheDocument()
    expect(screen.getByText(/status: pending/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit another report/i })).toBeInTheDocument()
  })
})
