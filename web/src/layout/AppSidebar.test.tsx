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

  // The rail is one of the two products' shared geometry: Books' sidebar is
  // w-60 expanded / w-[4.25rem] collapsed (web/src/components/AppSidebar.jsx:
  // 552-553), and the two read as one product only if this one matches.
  it('uses the same rail widths as Books', () => {
    const { rerender } = renderSidebar()
    const rail = () => screen.getByLabelText('Primary')
    expect(rail().className).toContain('w-60')

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppSidebar collapsed onToggleCollapsed={() => {}} mobileOpen={false} onNavigate={() => {}} />
      </MemoryRouter>,
    )
    expect(rail().className).toContain('w-[4.25rem]')
  })

  // The flyout is the rail's SIBLING, so a custom property declared on the rail
  // never reaches it and `left` falls back to `auto` — the panel then opens at
  // x=0, on top of the rail it is meant to sit beside. The offset has to arrive
  // as a resolved value on the panel itself, and it has to equal the rail width.
  it('opens the mega menu flush against the rail, at the rail width', () => {
    const { rerender } = renderSidebar()
    // By href, not by name: a collapsed rail renders the icon only.
    const openPanel = () => {
      const rail = screen.getByLabelText('Primary')
      fireEvent.mouseEnter(rail.querySelector('a[href="/masters"]')?.closest('li') as HTMLElement)
      return screen
        .getByRole('link', { name: /Bill of materials/ })
        .closest('div.fixed') as HTMLElement
    }
    expect(openPanel().style.left).toBe('15rem')

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppSidebar collapsed onToggleCollapsed={() => {}} mobileOpen={false} onNavigate={() => {}} />
      </MemoryRouter>,
    )
    expect(openPanel().style.left).toBe('4.25rem')
  })

  it('sizes the mega menu to its columns instead of a fixed three', () => {
    renderSidebar()
    fireEvent.mouseEnter(screen.getByRole('link', { name: /Masters/ }).closest('li') as HTMLElement)
    const grid = screen.getByRole('link', { name: /Bill of materials/ }).closest('div.grid') as HTMLElement
    expect(grid.getAttribute('style')).toContain('minmax(200px, max-content)')
    expect(grid.className).not.toContain('grid-cols-')
    const panel = grid.parentElement as HTMLElement
    expect(panel.className).toContain('w-max')
    expect(panel.className).toContain('max-w-[calc(100vw-2rem)]')
  })

  it('offers a collapse control', () => {
    const onToggleCollapsed = vi.fn()
    renderSidebar({ onToggleCollapsed })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(onToggleCollapsed).toHaveBeenCalledOnce()
  })
})
