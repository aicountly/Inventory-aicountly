import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The Locations workspace, from the list endpoint up.
 *
 * Only the services are faked. The real `useListParams`, the real stats model
 * and the real table all run, because the properties worth protecting are the
 * ones between them: that the KPI strip counts the WHOLE company rather than
 * the visible page, that WAREHOUSE and PARENT print names instead of the
 * foreign keys this screen was built to stop showing, and that a filter
 * reaches the query the server is asked for.
 */

const h = vi.hoisted(() => {
  const state = {
    rows: [] as Record<string, unknown>[],
    warehouses: [] as Record<string, unknown>[],
    permissions: null as Set<string> | null,
    fail: false,
    /** Every query the page sent, newest last. */
    queries: [] as Record<string, unknown>[],
    updated: [] as { id: number; body: Record<string, unknown> }[],
  }
  return { state }
})

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, companyName: 'Demo Company' }),
}))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => {
      if (h.state.permissions === null) return true
      const keys = typeof key === 'string' ? [key] : key
      return keys.some((k) => h.state.permissions!.has(k))
    },
    loading: false,
  }),
}))

vi.mock('../../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    locationsApi: {
      list: async (query: Record<string, unknown>) => {
        h.state.queries.push(query)
        if (h.state.fail) throw new Error('locations are down')
        const rows = h.state.rows
        return { data: rows, meta: { total: rows.length, limit: 50, offset: 0 } }
      },
      create: async () => ({}),
      update: async (id: number, body: Record<string, unknown>) => {
        h.state.updated.push({ id, body })
        return {}
      },
      remove: async () => undefined,
    },
  }
})

vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: { warehouses: h.state.warehouses, item_groups: [], stock_categories: [], brands: [], units: [] },
    loading: false,
    error: null,
    reload: () => {},
  }),
  invalidateFormOptions: () => {},
}))

vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }),
}))

// The sheet actions drag in jspdf/xlsx and the print pipeline; none of that is
// what this file is testing.
vi.mock('../../../components/ListSheetActions', () => ({
  ListSheetActions: () => <button type="button">Export</button>,
}))

const { LocationsPage } = await import('./LocationsPage')

function loc(id: number, over: Record<string, unknown> = {}) {
  return {
    location_id: id,
    warehouse_id: 1,
    parent_location_id: null,
    location_code: `L${id}`,
    location_name: `Location ${id}`,
    location_type: 'bin',
    is_active: 1,
    updated_at: '2026-09-01 10:00:00',
    ...over,
  }
}

function renderPage(path = '/masters/locations') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.state.rows = []
  h.state.warehouses = [
    { warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'MAIN', warehouse_type: 'standard', is_default: 1, bo_id: 0 },
    { warehouse_id: 2, warehouse_name: 'Overflow Store', warehouse_code: 'OVF', warehouse_type: 'standard', is_default: 0, bo_id: 0 },
  ]
  h.state.permissions = null
  h.state.fail = false
  h.state.queries = []
  h.state.updated = []
})

/**
 * One KPI card's text. Scoped to the strip's own region, because "Active" is
 * also what every status badge in the table below says.
 */
async function kpiCard(label: string): Promise<string> {
  const strip = await screen.findByRole('region', { name: 'Location statistics' })
  const el = within(strip).getByText(label)
  return el.closest('div')!.parentElement!.textContent ?? ''
}

describe('LocationsPage — KPIs', () => {
  it('counts the whole company, not the visible page', async () => {
    h.state.rows = [
      loc(1, { warehouse_id: 1 }),
      loc(2, { warehouse_id: 1, is_active: 0 }),
      loc(3, { warehouse_id: 2 }),
    ]
    renderPage()

    expect(await kpiCard('Total locations')).toContain('3')
    expect(await kpiCard('Active')).toContain('2')
    expect(await kpiCard('Inactive')).toContain('1')

    // Both of the company's two warehouses are covered.
    expect(await kpiCard('Warehouses covered')).toContain('of 2 warehouses')
  })

  it('reports percentages of the real total', async () => {
    h.state.rows = [loc(1), loc(2), loc(3), loc(4, { is_active: 0 })]
    renderPage()
    expect(await kpiCard('Active')).toContain('75% of total')
  })

  it('shows zeros, not a skeleton, for a company with no locations', async () => {
    renderPage()
    expect(await kpiCard('Total locations')).toContain('0')
    expect(await kpiCard('Total locations')).toContain('None created yet')
  })
})

describe('LocationsPage — table', () => {
  it('prints the warehouse name, never the foreign key', async () => {
    h.state.rows = [loc(1, { warehouse_id: 2 })]
    renderPage()

    await waitFor(() => expect(screen.getAllByText('Overflow Store').length).toBeGreaterThan(0))
    expect(screen.queryByText('#2')).toBeNull()
    expect(screen.queryByText('Warehouse #2')).toBeNull()
  })

  it('names the parent location instead of its id', async () => {
    h.state.rows = [
      loc(1, { location_code: 'Z1', location_name: 'Zone A', location_type: 'zone' }),
      loc(2, { location_code: 'B1', location_name: 'Bin 1', parent_location_id: 1 }),
    ]
    renderPage()

    await waitFor(() => expect(screen.getByText('Z1 · Zone A')).toBeTruthy())
    expect(screen.queryByText('#1')).toBeNull()
  })

  it('shows the ancestor path under the name', async () => {
    h.state.rows = [
      loc(1, { location_code: 'Z1', location_type: 'zone' }),
      loc(2, { location_code: 'R1', location_type: 'rack', parent_location_id: 1 }),
      loc(3, { location_code: 'B1', parent_location_id: 2 }),
    ]
    renderPage()
    await waitFor(() => expect(screen.getByText('Z1 › R1')).toBeTruthy())
  })

  it('marks a top-level row rather than leaving the cell blank', async () => {
    h.state.rows = [loc(1)]
    renderPage()
    await waitFor(() => expect(screen.getByText('— Top level —')).toBeTruthy())
  })
})

describe('LocationsPage — empty states', () => {
  it('invites the first location when the company has warehouses', async () => {
    renderPage()
    expect(await screen.findByText('Create your first location')).toBeTruthy()
  })

  it('sends the user to warehouses first when there are none', async () => {
    h.state.warehouses = []
    renderPage()
    expect(await screen.findByText('Create a warehouse first')).toBeTruthy()
    expect(screen.getByText('Go to warehouses').getAttribute('href')).toBe('/masters/warehouses')
  })

  it('offers to clear filters when a filter emptied the list', async () => {
    renderPage('/masters/locations?location_type=zone')
    expect(await screen.findByText('No locations match these filters')).toBeTruthy()
  })
})

describe('LocationsPage — filters', () => {
  it('sends the type filter to the server', async () => {
    h.state.rows = [loc(1)]
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'rack' } })

    await waitFor(() => {
      expect(h.state.queries.some((q) => q.location_type === 'rack')).toBe(true)
    })
  })

  it('leaves the estate walk unfiltered so the KPIs keep counting everything', async () => {
    h.state.rows = [loc(1)]
    renderPage('/masters/locations?status=inactive')
    await waitFor(() => expect(h.state.queries.length).toBeGreaterThan(1))
    // The table's query carries the status; the stats walk never does.
    expect(h.state.queries.some((q) => q.status === 'inactive')).toBe(true)
    expect(h.state.queries.some((q) => q.status === undefined && q.limit === 500)).toBe(true)
  })
})

describe('LocationsPage — permissions', () => {
  it('hides create and select when the profile can only read', async () => {
    h.state.rows = [loc(1)]
    h.state.permissions = new Set(['masters.locations.read'])
    renderPage()

    await waitFor(() => expect(screen.getAllByText('Main Warehouse').length).toBeGreaterThan(0))
    expect(screen.queryByText('New location')).toBeNull()
    expect(screen.queryByLabelText('Select L1')).toBeNull()
  })

  it('lets a writer select rows and deactivate them in bulk', async () => {
    h.state.rows = [loc(1), loc(2)]
    renderPage()

    const box = await screen.findByLabelText('Select L1')
    fireEvent.click(box)

    expect(await screen.findByText('1 selected')).toBeTruthy()
    fireEvent.click(screen.getByText('Deactivate'))

    await waitFor(() => expect(h.state.updated).toHaveLength(1))
    // A partial body: MasterController::update merges it over the stored row.
    expect(h.state.updated[0]).toEqual({ id: 1, body: { is_active: 0 } })
  })
})

describe('LocationsPage — failure', () => {
  it('reports a dead list endpoint with a retry instead of an empty table', async () => {
    h.state.fail = true
    renderPage()
    expect(await screen.findByText('Could not load locations')).toBeTruthy()
  })
})
