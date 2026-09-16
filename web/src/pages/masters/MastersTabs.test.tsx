import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * The tab row has two homes and must never appear in both at once.
 *
 * MastersLayout wraps every `/masters/*` screen, including the landing page,
 * and the landing page places the same tabs below its summary cards. If the
 * layout also drew them there, that screen would carry two identical rows.
 */

const h = vi.hoisted(() => ({ permissions: null as Set<string> | null, loading: false }))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => {
      if (h.permissions === null) return true
      return (typeof key === 'string' ? [key] : key).some((k) => h.permissions!.has(k))
    },
    loading: h.loading,
  }),
}))

const { MastersLayout } = await import('./MastersLayout')
const { MastersTabs } = await import('./MastersTabs')
const { MASTER_NAV } = await import('../../config/navRegistry')

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="masters" element={<MastersLayout />}>
          <Route index element={<p>landing</p>} />
          <Route path="brands" element={<p>brands screen</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const tabRows = () => screen.queryAllByRole('navigation', { name: 'Inventory masters' })

describe('MastersLayout', () => {
  it('leaves the tabs to the landing page on the index route', () => {
    renderAt('/masters')
    expect(screen.getByText('landing')).toBeTruthy()
    expect(tabRows()).toHaveLength(0)
  })

  it('draws them for every other master screen', () => {
    renderAt('/masters/brands')
    expect(screen.getByText('brands screen')).toBeTruthy()
    expect(tabRows()).toHaveLength(1)
  })
})

describe('MastersTabs', () => {
  function renderTabs(url = '/masters') {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <MastersTabs />
      </MemoryRouter>,
    )
  }

  it('opens Overview plus every master, on the routes the registry declares', () => {
    h.permissions = null
    renderTabs()
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Overview', ...MASTER_NAV.map((m) => m.label)])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/masters',
      ...MASTER_NAV.map((m) => m.path),
    ])
  })

  it('marks the tab you are on', () => {
    h.permissions = null
    renderTabs('/masters/brands')
    expect(screen.getByRole('link', { name: 'Brands' }).className).toContain('border-primary')
    expect(screen.getByRole('link', { name: 'Overview' }).className).toContain('border-transparent')
  })

  it('drops a master the profile cannot read', () => {
    h.permissions = new Set(
      MASTER_NAV.filter((m) => m.permissionSlug !== 'brands').map((m) => `masters.${m.permissionSlug}.read`),
    )
    renderTabs()
    expect(screen.queryByRole('link', { name: 'Brands' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Overview' })).toBeTruthy()
  })

  it('shows the full row while permissions are still loading, rather than growing into place', () => {
    h.permissions = new Set()
    h.loading = true
    renderTabs()
    expect(screen.getAllByRole('link')).toHaveLength(MASTER_NAV.length + 1)
    h.loading = false
  })
})
