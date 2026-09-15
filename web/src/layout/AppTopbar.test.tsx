import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const company = vi.hoisted(() => ({
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
}))

vi.mock('../company/CompanyContext', () => ({ useCompany: () => company }))
vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ profile: null, member: { display_name: 'Ada' } }),
}))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ signOut: () => {} }) }))
vi.mock('../components/AppLauncher', () => ({ AppLauncher: () => <div data-testid="launcher" /> }))

const { AppTopbar } = await import('./AppTopbar')
const { ThemeProvider } = await import('../theme/ThemeProvider')

function renderTopbar() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AppTopbar onToggleMobileNav={() => {}} />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

function topbarChildren(): HTMLElement[] {
  const header = document.querySelector('header.app-topbar') as HTMLElement
  expect(header, 'no topbar rendered').toBeTruthy()
  return [...header.children] as HTMLElement[]
}

/** Auto margins that survive into the desktop breakpoints. */
function spacers(): HTMLElement[] {
  return topbarChildren().filter(
    (el) => /(^|\s)ml-auto(\s|$)/.test(el.className) && !/(sm|md|lg|xl):ml-(0|auto)/.test(el.className),
  )
}

describe('AppTopbar layout', () => {
  it('renders the global controls', () => {
    renderTopbar()
    expect(screen.getByRole('button', { name: 'Search anything' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Appearance settings' })).toBeTruthy()
  })

  // The header is a plain flex row, so the right-hand cluster only reaches the
  // edge if exactly one item absorbs the free space and that item is the last
  // one. Two competing auto margins split the space between them instead, and
  // an `md:ml-0` cancels the push at precisely the widths that have space to
  // give.
  it('leaves one spacer in the row, on the right-hand cluster', () => {
    renderTopbar()
    const children = topbarChildren()
    const found = spacers()
    expect(found).toHaveLength(1)
    expect(found[0]).toBe(children[children.length - 1])
  })

  it('puts the appearance and user controls in that cluster', () => {
    renderTopbar()
    const cluster = spacers()[0]
    expect(cluster.contains(screen.getByRole('button', { name: 'Appearance settings' }))).toBe(true)
    expect(cluster.contains(screen.getByRole('button', { name: /^Ada/ }))).toBe(true)
  })
})
