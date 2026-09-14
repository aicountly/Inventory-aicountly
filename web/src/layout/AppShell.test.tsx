import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * The shell's company / access state machine is the one piece of AppLayout
 * that had to survive the re-skin untouched: four banner branches, a
 * "no company" fullscreen panel, and no outlet until the scope is ready.
 * These assert that contract rather than the styling.
 */

type CompanyState = {
  companies: { cmpId: number; name: string }[]
  status: 'loading' | 'ready' | 'empty' | 'error'
  error: string | null
  warning: string | null
  companyName: string
  reload: () => void
  fyList: never[]
  branches: never[]
  cmpId: number | null
  fyId: number | null
  boId: number
  fy: null
  branch: null
  selectCompany: () => void
  selectFy: () => void
  selectBranch: () => void
}

type AccessState = {
  loading: boolean
  error: string | null
  member: { uuid: string } | null
  isOwner: boolean
  profile: null
  can: () => boolean
  reload: () => void
}

const state = vi.hoisted(() => {
  const company = {
    companies: [{ cmpId: 1, name: 'Acme Ltd' }],
    status: 'ready',
    error: null,
    warning: null,
    companyName: 'Acme Ltd',
    reload: () => {},
    fyList: [],
    branches: [],
    cmpId: 1,
    fyId: 10,
    boId: 0,
    fy: null,
    branch: null,
    selectCompany: () => {},
    selectFy: () => {},
    selectBranch: () => {},
  }
  const access = {
    loading: false,
    error: null,
    member: { uuid: 'u1' },
    isOwner: true,
    profile: null,
    can: () => true,
    reload: () => {},
  }
  return { company, access } as { company: CompanyState; access: AccessState }
})

vi.mock('../company/CompanyContext', () => ({ useCompany: () => state.company }))
vi.mock('../access/AccessContext', () => ({ useAccess: () => state.access }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ signOut: () => {} }) }))
vi.mock('../components/AppLauncher', () => ({ AppLauncher: () => <div data-testid="launcher" /> }))
vi.mock('../services/appLauncher', () => ({ getManageApiOrigin: () => 'https://manage.example' }))

const { AppShell } = await import('./AppShell')
const { ThemeProvider } = await import('../theme/ThemeProvider')

function renderShell() {
  // ThemeProvider sits above the router in App.tsx; the topbar's appearance
  // controls read from it.
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="dashboard" element={<p>Routed content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

function reset() {
  state.company.companies = [{ cmpId: 1, name: 'Acme Ltd' }]
  state.company.status = 'ready'
  state.company.error = null
  state.company.warning = null
  state.access.error = null
  state.access.member = { uuid: 'u1' }
  state.access.isOwner = true
  state.access.loading = false
}

describe('AppShell', () => {
  it('renders the chrome and the routed screen once the scope is ready', () => {
    reset()
    renderShell()
    expect(screen.getByLabelText('Primary')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search anything' })).toBeTruthy()
    expect(screen.getByText('Routed content')).toBeTruthy()
  })

  it('shows the no-company panel and a way out when there are no companies', () => {
    reset()
    state.company.companies = []
    state.company.status = 'empty'
    renderShell()
    expect(screen.getByText('No company to open')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Manage' })).toBeTruthy()
    expect(screen.queryByText('Routed content')).toBeNull()
  })

  it('shows the load failure panel with the reason', () => {
    reset()
    state.company.companies = []
    state.company.status = 'error'
    state.company.error = 'Manage did not answer.'
    renderShell()
    expect(screen.getByText('Could not load your companies')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('banners a company error and still renders the app', () => {
    reset()
    state.company.error = 'Financial year missing.'
    renderShell()
    expect(screen.getByText('Financial year missing.')).toBeTruthy()
    expect(screen.getByText('Routed content')).toBeTruthy()
  })

  it('banners a non-fatal company warning', () => {
    reset()
    state.company.warning = 'Using the remembered financial year.'
    renderShell()
    expect(screen.getByText('Using the remembered financial year.')).toBeTruthy()
  })

  it('banners an access error', () => {
    reset()
    state.access.error = 'Access could not be read.'
    renderShell()
    expect(screen.getByText('Access could not be read.')).toBeTruthy()
  })

  it('banners a missing access profile, naming the company', () => {
    reset()
    state.access.member = null
    state.access.isOwner = false
    renderShell()
    const banner = screen.getByText('No access profile').closest('[role="status"]')
    expect(banner).toBeTruthy()
    // The company name is in the banner, not only in the scope switcher.
    expect(banner?.textContent).toContain('Acme Ltd')
  })

  it('does not banner a missing profile while access is still loading', () => {
    reset()
    state.access.member = null
    state.access.isOwner = false
    state.access.loading = true
    renderShell()
    expect(screen.queryByText('No access profile')).toBeNull()
  })

  it('holds the outlet back while the company is still loading', () => {
    reset()
    state.company.status = 'loading'
    renderShell()
    expect(screen.queryByText('Routed content')).toBeNull()
    expect(screen.getByText(/Loading Acme Ltd/)).toBeTruthy()
  })
})
