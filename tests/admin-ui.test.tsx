import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { jsonResponse } from './fixtures/apiZones'
import type { ApiReport } from '../src/types/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

const sampleReports: ApiReport[] = [
  {
    id: 'rep-pending-1',
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
  {
    id: 'rep-reviewed-2',
    zoneId: 'shillong',
    category: 'Rockfall',
    title: 'Rockfall on ridge road',
    description: 'Minor slide cleared by locals.',
    latitude: 25.57,
    longitude: 91.89,
    status: 'reviewed',
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-10T09:30:00.000Z',
  },
]

describe('Admin UI — /admin', () => {
  it('renders login form when unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/admin/session')) {
        return Promise.resolve(jsonResponse({ error: { code: 'unauthorized', message: 'Not logged in' } }, 401))
      }
      return Promise.resolve(jsonResponse({}))
    }))

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: /administrator access/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/administrator password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('displays error message on failed login', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/api/admin/session')) {
        return Promise.resolve(jsonResponse({ error: { code: 'unauthorized' } }, 401))
      }
      if (url.includes('/api/admin/login') && method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { code: 'unauthorized', message: 'Invalid administrator password' } }, 401))
      }
      return Promise.resolve(jsonResponse({}))
    }))

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    const passwordInput = await screen.findByLabelText(/administrator password/i)
    await user.type(passwordInput, 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid administrator password/i)
  })

  it('logs in successfully and renders the moderation queue', async () => {
    const user = userEvent.setup()
    let loggedIn = false

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()

      if (url.includes('/api/admin/session')) {
        if (loggedIn) {
          return Promise.resolve(jsonResponse({ data: { authenticated: true, adminId: 'admin' } }))
        }
        return Promise.resolve(jsonResponse({ error: { code: 'unauthorized' } }, 401))
      }

      if (url.includes('/api/admin/login') && method === 'POST') {
        loggedIn = true
        return Promise.resolve(jsonResponse({ data: { authenticated: true, adminId: 'admin' } }))
      }

      if (url.includes('/api/admin/reports')) {
        return Promise.resolve(jsonResponse({ data: { reports: sampleReports } }))
      }

      return Promise.resolve(jsonResponse({}))
    }))

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    const passwordInput = await screen.findByLabelText(/administrator password/i)
    await user.type(passwordInput, 'correctpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: /report moderation workspace/i })).toBeInTheDocument()
    expect(screen.getByText('Debris over roadway')).toBeInTheDocument()
    expect(screen.getByText('Rockfall on ridge road')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('allows moderating a report through confirm dialog', async () => {
    const user = userEvent.setup()
    let currentReports = [...sampleReports]

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()

      if (url.includes('/api/admin/session')) {
        return Promise.resolve(jsonResponse({ data: { authenticated: true, adminId: 'admin' } }))
      }

      if (url.includes('/api/admin/reports') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: { reports: currentReports } }))
      }

      if (url.includes('/api/admin/reports/rep-pending-1/status') && method === 'PATCH') {
        currentReports = currentReports.map((r) =>
          r.id === 'rep-pending-1' ? { ...r, status: 'reviewed', updatedAt: new Date().toISOString() } : r,
        )
        return Promise.resolve(
          jsonResponse({
            data: {
              report: currentReports[0],
              audit: {
                id: 'audit-1',
                reportId: 'rep-pending-1',
                previousStatus: 'pending',
                newStatus: 'reviewed',
                adminId: 'admin',
                createdAt: new Date().toISOString(),
              },
            },
          }),
        )
      }

      return Promise.resolve(jsonResponse({}))
    }))

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Debris over roadway')).toBeInTheDocument()

    // Click "Mark Reviewed" button on the first report
    const markReviewedBtn = screen.getByRole('button', { name: /mark reviewed/i })
    await user.click(markReviewedBtn)

    // Confirm dialog opens
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/confirm status change/i)).toBeInTheDocument()

    // Click "Confirm"
    const confirmBtn = screen.getByRole('button', { name: /^confirm$/i })
    await user.click(confirmBtn)

    // Dialog closes and success alert appears
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(await screen.findByText(/status changed to reviewed/i)).toBeInTheDocument()
  })

  it('signs out and returns to login view', async () => {
    const user = userEvent.setup()
    let loggedIn = true

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()

      if (url.includes('/api/admin/session')) {
        if (loggedIn) {
          return Promise.resolve(jsonResponse({ data: { authenticated: true, adminId: 'admin' } }))
        }
        return Promise.resolve(jsonResponse({ error: { code: 'unauthorized' } }, 401))
      }

      if (url.includes('/api/admin/reports')) {
        return Promise.resolve(jsonResponse({ data: { reports: sampleReports } }))
      }

      if (url.includes('/api/admin/logout') && method === 'POST') {
        loggedIn = false
        return Promise.resolve(jsonResponse({ data: { success: true } }))
      }

      return Promise.resolve(jsonResponse({}))
    }))

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    )

    const signOutBtn = await screen.findByRole('button', { name: /sign out/i })
    await user.click(signOutBtn)

    expect(await screen.findByRole('heading', { name: /administrator access/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/administrator password/i)).toBeInTheDocument()
  })
})
