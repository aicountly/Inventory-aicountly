import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * Below `md` the rail is an overlay drawer, and the two states it is wrong in
 * are opposites: closed it is merely translated off-screen, so it stays in the
 * tab order and the accessibility tree; open it sits over a page that is still
 * tabbable behind the scrim, with no way out but a pointer.
 */

const state = vi.hoisted(() => ({
  company: {
    companies: [{ cmpId: 1, name: 'Acme Ltd' }],
    cmpId: 1,
    companyName: 'Acme Ltd',
    fyList: [],
    fyId: null,
    fy: null,
    branches: [],
    boId: 0,
    branch: null,
    status: 'ready',
    error: null,
    warning: null,
    reload: () => {},
    selectCompany: () => {},
    selectFy: () => {},
    selectBranch: () => {},
  },
  access: {
    loading: false,
    error: null,
    member: { uuid: 'u1', display_name: 'Ada' },
    isOwner: true,
    profile: null,
    can: () => true,
    reload: () => {},
  },
}))

vi.mock('../company/CompanyContext', () => ({ useCompany: () => state.company }))
vi.mock('../access/AccessContext', () => ({ useAccess: () => state.access }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ signOut: () => {} }) }))
vi.mock('../components/AppLauncher', () => ({ AppLauncher: () => <div data-testid="launcher" /> }))
vi.mock('../services/appLauncher', () => ({ getManageApiOrigin: () => 'https://manage.example' }))

const { AppShell } = await import('./AppShell')
const { AppSidebar } = await import('./AppSidebar')
const { ThemeProvider } = await import('../theme/ThemeProvider')

/** happy-dom answers min-width from its own viewport; drive it explicitly. */
function setViewportWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSidebar(mobileOpen: boolean) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AppSidebar
        collapsed={false}
        onToggleCollapsed={() => {}}
        mobileOpen={mobileOpen}
        onNavigate={() => {}}
      />
    </MemoryRouter>,
  )
}

function renderShell() {
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

const rail = () => screen.getByLabelText('Primary')

describe('mobile nav drawer', () => {
  it('takes the closed drawer out of the tab order and the AT tree', () => {
    setViewportWidth(390)
    renderSidebar(false)
    expect(rail().hasAttribute('inert')).toBe(true)
  })

  it('hands the drawer back when it opens', () => {
    setViewportWidth(390)
    renderSidebar(true)
    expect(rail().hasAttribute('inert')).toBe(false)
  })

  it('never inerts the static desktop rail', () => {
    setViewportWidth(1280)
    renderSidebar(false)
    expect(rail().hasAttribute('inert')).toBe(false)
  })

  it('moves focus into the drawer and keeps Tab inside it', () => {
    setViewportWidth(390)
    const { rerender } = renderSidebar(false)
    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppSidebar
          collapsed={false}
          onToggleCollapsed={() => {}}
          mobileOpen
          onNavigate={() => {}}
        />
      </MemoryRouter>,
    )
    const stops = [...rail().querySelectorAll<HTMLElement>('a[href], button')]
    const first = stops[0]
    const last = stops[stops.length - 1]
    expect(document.activeElement).toBe(first)

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  // happy-dom cannot evaluate `hidden md:flex`, so stand in for it: a control
  // the drawer width hides is not a Tab stop, and a trap that wrapped to it
  // would drop focus onto the page behind the scrim.
  it('skips a control the drawer width hides', () => {
    setViewportWidth(390)
    renderSidebar(true)
    const style = document.createElement('style')
    style.textContent = '.test-hidden { display: none }'
    document.head.append(style)
    screen.getByRole('button', { name: 'Collapse sidebar' }).classList.add('test-hidden')

    const links = [...rail().querySelectorAll<HTMLElement>('a[href]')]
    links[links.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(links[0])
    style.remove()
  })

  it('closes on Escape, not only on a scrim click', () => {
    setViewportWidth(390)
    renderShell()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    })
    expect(rail().hasAttribute('inert')).toBe(false)

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(rail().hasAttribute('inert')).toBe(true)
  })
})
