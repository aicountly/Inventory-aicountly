import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { P } from '../services/access'

const access = vi.hoisted(() => {
  const state: { can: (key: string | readonly string[]) => boolean; loading: boolean } = {
    can: () => true,
    loading: false,
  }
  return state
})

vi.mock('../access/AccessContext', () => ({
  useAccess: () => access,
}))

// Imported after the mock so the sidebar picks it up.
const { AppSidebar } = await import('./AppSidebar')

function renderSidebar(props: Partial<Parameters<typeof AppSidebar>[0]> = {}, route = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppSidebar
        collapsed={false}
        onToggleCollapsed={() => {}}
        mobileOpen={false}
        onNavigate={() => {}}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('AppSidebar', () => {
  it('lists the primary sections as links', () => {
    access.can = () => true
    renderSidebar()
    const nav = screen.getByLabelText('Primary')
    expect(within(nav).getByRole('link', { name: /Dashboard/ })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: /Documents/ })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: /Reports/ })).toBeTruthy()
  })

  it('hides a section the user has no permission for', () => {
    access.can = (key) => {
      const keys = typeof key === 'string' ? [key] : key
      return !keys.includes(P.auditRead)
    }
    renderSidebar()
    expect(screen.queryByRole('link', { name: /Audit/ })).toBeNull()
    access.can = () => true
  })

  it('shows every section while permissions are still loading', () => {
    access.can = () => false
    access.loading = true
    renderSidebar()
    expect(screen.getByRole('link', { name: /Audit/ })).toBeTruthy()
    access.loading = false
    access.can = () => true
  })

  it('opens the mega menu on hover and closes it on leave', async () => {
    access.can = () => true
    renderSidebar()
    const item = screen.getByRole('link', { name: /Masters/ }).closest('li') as HTMLElement
    expect(screen.queryByRole('link', { name: /Bill of materials/ })).toBeNull()
    fireEvent.mouseEnter(item)
    expect(screen.getByRole('link', { name: /Bill of materials/ })).toBeTruthy()
    fireEvent.mouseLeave(item)
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.queryByRole('link', { name: /Bill of materials/ })).toBeNull()
  })

  it('opens the mega menu from the keyboard too', () => {
    renderSidebar()
    fireEvent.focus(screen.getByRole('link', { name: /Stock/ }))
    expect(screen.getByRole('link', { name: /Ledger/ })).toBeTruthy()
  })

  it('hides labels but keeps the links when collapsed', () => {
    renderSidebar({ collapsed: true })
    const nav = screen.getByLabelText('Primary')
    expect(within(nav).getAllByRole('link').length).toBeGreaterThan(5)
    expect(within(nav).queryByText('Dashboard')).toBeNull()
  })

  it('offers a collapse control', () => {
    const onToggleCollapsed = vi.fn()
    renderSidebar({ onToggleCollapsed })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(onToggleCollapsed).toHaveBeenCalledOnce()
  })
})
