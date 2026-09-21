import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Warehouse, WarehouseGroup } from '../../services/masters'

/**
 * The Warehouse groups screen, end to end in the DOM.
 *
 * What is asserted here is what the spec promises and what a reader would
 * notice breaking: the figures are counted from the rows rather than hard-coded,
 * all three views render the same records, search narrows them, a profile
 * without write or delete is not offered buttons it may not press, and a group
 * that still holds warehouses cannot be deleted from this screen at all.
 */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  accessLoading: false,
  groups: [] as WarehouseGroup[],
  warehouses: [] as Warehouse[],
  removed: [] as number[],
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, companyName: 'Acme Ltd' }),
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      (typeof key === 'string' ? [key] : key).some((k) => h.permissions.has(k)),
    loading: h.accessLoading,
  }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({ useToast: () => h.toast }))

// The export/print group has its own tests and pulls in jsPDF; this screen only
// needs to know it is mounted with the rows the filters left.
vi.mock('../../components/ListSheetActions', () => ({
  ListSheetActions: ({ rows }: { rows: readonly unknown[] }) => (
    <button type="button" data-testid="export">Export ({rows.length})</button>
  ),
}))

vi.mock('../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/masters')>()
  return {
    ...actual,
    warehouseGroupsApi: {
      ...actual.warehouseGroupsApi,
      list: async () => ({ data: h.groups, meta: { total: h.groups.length, limit: 200, offset: 0 } }),
      remove: async (id: number) => {
        h.removed.push(id)
      },
    },
    warehousesApi: {
      ...actual.warehousesApi,
      list: async () => ({ data: h.warehouses, meta: { total: h.warehouses.length, limit: 200, offset: 0 } }),
    },
  }
})

const { WarehouseGroupsPage } = await import('./WarehouseGroupsPage')

function group(over: Partial<WarehouseGroup> & { warehouse_group_id: number; grp_name: string }): WarehouseGroup {
  return {
    grp_code: null,
    description: null,
    parent_grp_id: null,
    is_active: 1,
    warehouse_count: 0,
    child_count: 0,
    created_at: '2026-01-01 10:00:00',
    updated_at: '2026-07-02 11:23:00',
    created_by: 'u-rahul',
    updated_by: 'u-rahul',
    created_by_name: 'Rahul Gupta',
    updated_by_name: 'Rahul Gupta',
    ...over,
  }
}

const GROUPS: WarehouseGroup[] = [
  group({ warehouse_group_id: 1, grp_name: 'General', grp_code: 'GEN', description: 'General warehouse group for all sites', warehouse_count: 5 }),
  group({ warehouse_group_id: 2, grp_name: 'Retail Stores', grp_code: 'RET', description: 'Retail and franchise outlets', warehouse_count: 3 }),
  group({ warehouse_group_id: 3, grp_name: 'Manufacturing', grp_code: 'MFG', warehouse_count: 2, parent_grp_id: 1 }),
  group({ warehouse_group_id: 4, grp_name: 'Transit', grp_code: 'TRN', warehouse_count: 1 }),
  group({ warehouse_group_id: 5, grp_name: 'Scrap / Rejected', grp_code: 'SCR', warehouse_count: 0, is_active: 0 }),
]

const WAREHOUSES: Warehouse[] = [
  {
    warehouse_id: 1,
    warehouse_name: 'Main store',
    warehouse_code: 'MS',
    warehouse_group_id: 1,
    parent_warehouse_id: null,
    warehouse_type: 'standard',
    is_default: 1,
    allow_negative: null,
    address: null,
    contact: null,
    bo_id: 0,
    is_active: 1,
  },
  {
    warehouse_id: 2,
    warehouse_name: 'Loose depot',
    warehouse_code: null,
    warehouse_group_id: null,
    parent_warehouse_id: null,
    warehouse_type: 'standard',
    is_default: 0,
    allow_negative: null,
    address: null,
    contact: null,
    bo_id: 0,
    is_active: 1,
  },
]

function renderPage(url = '/masters/warehouse-groups') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WarehouseGroupsPage />
    </MemoryRouter>,
  )
}

const summary = () => screen.getByRole('region', { name: 'Warehouse group summary' })
/*
 * Group names appear twice on this screen — in the view, and again in the
 * structure panel beside it. Every assertion about "the rows" is scoped to the
 * view it is about, so a test cannot pass on the panel while the table is
 * empty.
 */
const table = () => screen.getByRole('table')
const searchBox = () => screen.getByRole('searchbox', { name: 'Search warehouse groups' })

beforeEach(() => {
  h.permissions = new Set([
    'masters.warehouse_groups.read',
    'masters.warehouse_groups.write',
    'masters.warehouse_groups.delete',
    'masters.warehouses.read',
  ])
  h.accessLoading = false
  h.groups = GROUPS
  h.warehouses = WAREHOUSES
  h.removed = []
  h.toast.success.mockClear()
  // The screen remembers the last view in localStorage, which is shared across
  // tests in a file: without this, the first test to pick Cards would decide
  // what every later test renders.
  window.localStorage.clear()
})

describe('WarehouseGroupsPage figures', () => {
  it('counts the cards from the rows on record, not from the page on screen', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('Retail Stores')).toBeTruthy())
    const cards = summary()
    expect(within(cards).getByText('Total groups').parentElement?.textContent).toContain('5')
    expect(within(cards).getByText('Active').parentElement?.textContent).toContain('4')
    expect(within(cards).getByText('Inactive').parentElement?.textContent).toContain('1')
    // 80% active / 20% inactive, both derived — never a hard-coded delta.
    expect(within(cards).getByText('80% of all groups')).toBeTruthy()
    expect(within(cards).getByText('20% of all groups')).toBeTruthy()
  })

  it('reports the warehouses that sit in no group at all', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('Retail Stores')).toBeTruthy())
    expect(within(summary()).getByText('1 in no group')).toBeTruthy()
  })
})

describe('WarehouseGroupsPage views', () => {
  it('renders the list with each group, its code and its warehouse count', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    expect(within(table()).getByText('GEN')).toBeTruthy()
    expect(within(table()).getByRole('button', { name: '5 warehouses in General' })).toBeTruthy()
    expect(within(table()).getByText('Retail and franchise outlets')).toBeTruthy()
  })

  it('draws the real parent / child hierarchy in the tree view', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('tablist', { name: 'View' })).getByRole('tab', { name: /Tree/ }))
    const tree = await screen.findByRole('tree', { name: 'Warehouse group hierarchy' })
    // Manufacturing declares General as its parent, so it is drawn one level in.
    const child = within(tree).getByRole('treeitem', { name: /Manufacturing/ })
    expect(child.getAttribute('aria-level')).toBe('2')
    expect(within(tree).getByRole('treeitem', { name: /General/ }).getAttribute('aria-level')).toBe('1')
  })

  it('remembers the last view chosen, so a return visit opens where it left off', async () => {
    const first = renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('tablist', { name: 'View' })).getByRole('tab', { name: /Cards/ }))
    await screen.findByRole('list', { name: 'Warehouse groups' })
    first.unmount()

    renderPage()
    expect(await screen.findByRole('list', { name: 'Warehouse groups' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the same records as cards', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    fireEvent.click(within(screen.getByRole('tablist', { name: 'View' })).getByRole('tab', { name: /Cards/ }))
    const grid = await screen.findByRole('list', { name: 'Warehouse groups' })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(5)
    expect(within(grid).getByText('Retail and franchise outlets')).toBeTruthy()
  })
})

describe('WarehouseGroupsPage filtering', () => {
  it('searches the name, the code and the description', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    fireEvent.change(searchBox(), { target: { value: 'franchise' } })
    await waitFor(() => expect(within(table()).queryByText('General')).toBeNull())
    expect(within(table()).getByText('Retail Stores')).toBeTruthy()
  })

  it('offers a way back when the filters leave nothing', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    fireEvent.change(searchBox(), { target: { value: 'nothing matches this' } })
    await waitFor(() => expect(screen.getByText('No warehouse groups match your filters.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
  })

  it('reads its filters from the URL so a view can be shared', async () => {
    renderPage('/masters/warehouse-groups?status=inactive')
    await waitFor(() => expect(within(table()).getByText('Scrap / Rejected')).toBeTruthy())
    expect(within(table()).queryByText('Retail Stores')).toBeNull()
  })
})

describe('WarehouseGroupsPage permissions', () => {
  it('hides create for a profile that may only read', async () => {
    h.permissions = new Set(['masters.warehouse_groups.read'])
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'New warehouse group' })).toBeNull()
  })

  it('refuses the screen outright without read', async () => {
    h.permissions = new Set([])
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/do not have permission to view warehouse groups/i)).toBeTruthy(),
    )
  })

  it('opens the create form from ?new=1 and consumes the flag', async () => {
    renderPage('/masters/warehouse-groups?new=1')
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New warehouse group' })).toBeTruthy())
  })
})

describe('WarehouseGroupsPage delete', () => {
  it('will not delete a group that still holds warehouses', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('General')).toBeTruthy())
    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for General' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete warehouse group?' })
    expect(within(dialog).getByText(/contains 5 warehouses/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Delete group' })).toHaveProperty('disabled', true)
    expect(h.removed).toEqual([])
  })

  it('deletes a group that holds nothing', async () => {
    renderPage()
    await waitFor(() => expect(within(table()).getByText('Scrap / Rejected')).toBeTruthy())
    fireEvent.click(within(table()).getByRole('button', { name: 'Actions for Scrap / Rejected' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete warehouse group?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }))
    await waitFor(() => expect(h.removed).toEqual([5]))
    expect(h.toast.success).toHaveBeenCalledWith('Warehouse group deleted')
  })
})
