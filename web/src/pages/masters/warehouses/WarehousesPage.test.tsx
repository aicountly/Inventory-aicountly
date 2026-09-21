import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Warehouse, WarehouseSummary } from '../../../services/masters'

/**
 * The Warehouses screen, end to end against stubbed endpoints.
 *
 * What these hold is the part a redesign is most likely to break quietly:
 *
 *  - the KPI strip reads the company summary, not the page of rows, so it
 *    cannot become the arithmetic of whatever the table happens to be showing;
 *  - stock comes from ONE warehouse-stock call however many warehouses there
 *    are — the N+1 this screen is explicitly not allowed to have;
 *  - a user without the stock report's permission never triggers that call and
 *    never sees a quantity invented in its place;
 *  - create, edit and delete still go through the same config and the same API
 *    they always did.
 */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  listCalls: [] as unknown[],
  reportCalls: [] as string[],
  created: [] as Record<string, unknown>[],
  updated: [] as [number, Record<string, unknown>][],
  removed: [] as number[],
  summaryCalls: 0,
}))

interface SheetPayload {
  rows: Record<string, { text: string; value: unknown }>[]
  columns: { key: string; label: string; format?: string }[]
}

const exportTabularPdf = vi.fn(async (_p: SheetPayload) => {})

vi.mock('../../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: (p: SheetPayload) => exportTabularPdf(p),
  printTabular: vi.fn(() => true),
}))

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
  }),
}))
vi.mock('../../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd' }))
vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => (typeof key === 'string' ? [key] : key).some((k) => h.permissions.has(k)),
    loading: false,
  }),
  useCan: () => true,
}))
vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const ROWS: Warehouse[] = [
  {
    warehouse_id: 1,
    warehouse_name: 'Main',
    warehouse_code: 'MAIN',
    warehouse_group_id: null,
    parent_warehouse_id: null,
    warehouse_type: 'standard',
    is_default: 1,
    allow_negative: null,
    address: { city: 'New Delhi', state: 'Delhi', country: 'India' },
    contact: null,
    bo_id: 0,
    is_active: 1,
    capacity_units: 50000,
    area: 2500,
    area_unit: 'sq_ft',
    latitude: null,
    longitude: null,
    updated_at: '2026-07-07 15:09:00',
  },
  {
    warehouse_id: 2,
    warehouse_name: 'Transit hub',
    warehouse_code: null,
    warehouse_group_id: null,
    parent_warehouse_id: null,
    warehouse_type: 'transit',
    is_default: 0,
    allow_negative: 0,
    address: null,
    contact: null,
    bo_id: 2,
    is_active: 0,
    capacity_units: null,
    area: null,
    area_unit: null,
    latitude: null,
    longitude: null,
    updated_at: '2026-07-06 09:00:00',
  },
]

const SUMMARY: WarehouseSummary = {
  total: 12,
  active: 10,
  inactive: 2,
  defaults: 1,
  capacity: {
    units: 250000,
    configured: 8,
    area: 14000,
    area_configured: 8,
    area_by_unit: [{ unit: 'sq_ft', area: 14000, count: 8 }],
  },
  geo: { with_coordinates: 0 },
  by_type: [{ warehouse_type: 'standard', count: 9, active: 8 }],
  by_location: [{ country: 'India', state: 'Delhi', city: 'New Delhi', count: 5, active: 5 }],
}

vi.mock('../../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/masters')>()
  return {
    ...actual,
    warehousesApi: {
      list: async (query: unknown) => {
        h.listCalls.push(query)
        return { data: ROWS, meta: { total: ROWS.length, limit: 50, offset: 0 } }
      },
      get: async () => ROWS[0],
      create: async (body: Record<string, unknown>) => {
        h.created.push(body)
        return ROWS[0]
      },
      update: async (id: number, body: Record<string, unknown>) => {
        h.updated.push([id, body])
        return ROWS[0]
      },
      remove: async (id: number) => {
        h.removed.push(id)
      },
      summary: async () => {
        h.summaryCalls += 1
        return SUMMARY
      },
    },
    locationsApi: { ...actual.locationsApi, list: async () => ({ data: [], meta: { total: 4, limit: 1, offset: 0 } }) },
  }
})

vi.mock('../../../services/reportsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/reportsApi')>()
  return {
    ...actual,
    fetchReport: async (path: string) => {
      h.reportCalls.push(path)
      return {
        data: [],
        meta: { total: 1, limit: 1, offset: 0 },
        report: path,
        summary: {
          rows: 1,
          closing_qty: 16240,
          closing_value: 1248000,
          by_warehouse: [{ warehouse_id: 1, warehouse_name: 'Main', closing_qty: 16240, closing_value: 1248000 }],
          to: '2026-09-18',
        },
      }
    },
  }
})

vi.mock('../../../services/settingsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/settingsApi')>()
  return { ...actual, settingsApi: { ...actual.settingsApi, get: async () => ({ base_currency_code: 'INR' }) } }
})

const { WarehousesPage } = await import('./WarehousesPage')

const READ = ['masters.warehouses.read', 'masters.locations.read']
const WRITE = [...READ, 'masters.warehouses.write', 'masters.warehouses.delete']
const STOCK = 'reports.warehouse_stock.read'

/** The cell as the TABLE renders it — "Main" also labels a donut slice. */
function inTable(text: string): HTMLElement {
  const body = document.querySelector('tbody')
  expect(body).toBeTruthy()
  return within(body as HTMLElement).getByText(text)
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/masters/warehouses']}>
      <WarehousesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.permissions = new Set([...WRITE, STOCK])
  h.listCalls = []
  h.reportCalls = []
  h.created = []
  h.updated = []
  h.removed = []
  h.summaryCalls = 0
  exportTabularPdf.mockClear()
})

/** Drive the export menu to the PDF sheet and hand back what it was given. */
async function sheet(): Promise<SheetPayload> {
  fireEvent.click(screen.getByRole('button', { name: /export/i }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /PDF/ }))
  await waitFor(() => expect(exportTabularPdf).toHaveBeenCalledOnce())
  return exportTabularPdf.mock.calls[0][0]
}

describe('the exported sheet', () => {
  it('carries every column the table shows, with no blank cell under a header', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    const payload = await sheet()

    const keys = payload.columns.map((c) => c.key)
    expect(keys).toContain('capacity_units')
    expect(keys).toContain('location')
    expect(keys).toContain('stock_qty')
    expect(keys).toContain('utilisation')

    // The defect this guards: a column whose value resolver names no field
    // resolves to '' and the sheet ships a silently empty column.
    const blanks = payload.columns.filter((c) => (payload.rows[0][c.key]?.text ?? '') === '')
    expect(blanks.map((c) => `${c.key} (${c.label})`)).toEqual([])
  })

  it('writes the same figures the screen shows', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    const row = (await sheet()).rows[0]

    expect(row.capacity_units.text).toContain('50,000')
    expect(row.location.text).toBe('New Delhi, Delhi')
    expect(row.stock_qty.text).toContain('16,240')
    expect(row.utilisation.text).toBe('32.5%')
  })

  it('says "Not configured" for the warehouse with no capacity, rather than 0%', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    const rows = (await sheet()).rows

    expect(rows[1].capacity_units.text).toBe('Not configured')
    expect(rows[1].utilisation.text).toBe('Not configured')
  })

  it('omits the stock columns entirely from a user who may not read the report', async () => {
    h.permissions = new Set(WRITE)
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    const payload = await sheet()

    const keys = payload.columns.map((c) => c.key)
    expect(keys).not.toContain('stock_qty')
    expect(keys).not.toContain('stock_value')
    expect(keys).toContain('capacity_units')
  })
})

describe('the Warehouses screen', () => {
  it('renders the rows the API returned', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    expect(inTable('Transit hub')).toBeTruthy()
  })

  it('takes the KPI figures from the company summary, not the rows on screen', async () => {
    mount()
    await waitFor(() => expect(h.summaryCalls).toBe(1))
    // Two rows are rendered; the strip must still report the company's twelve.
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy())
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('asks for warehouse stock exactly once, however many warehouses there are', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    expect(h.reportCalls).toEqual(['warehouse-stock'])
  })

  it('says "Not configured" rather than 0 for a warehouse with no capacity', async () => {
    mount()
    await waitFor(() => expect(inTable('Transit hub')).toBeTruthy())
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0)
  })

  it('keeps the negative-stock policy on screen', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    expect(inTable('Company policy')).toBeTruthy()
    expect(inTable('Blocked')).toBeTruthy()
  })

  it('prints an em dash for a warehouse with no code instead of inventing one', async () => {
    mount()
    await waitFor(() => expect(inTable('Transit hub')).toBeTruthy())
    const body = document.querySelector('tbody') as HTMLElement
    expect(within(body).getAllByText('—').length).toBeGreaterThan(0)
  })

  describe('without the stock report permission', () => {
    beforeEach(() => {
      h.permissions = new Set(WRITE)
    })

    it('never calls the report, and shows no quantity in its place', async () => {
      mount()
      await waitFor(() => expect(inTable('Main')).toBeTruthy())
      expect(h.reportCalls).toEqual([])
      expect(screen.queryByText(/16,240/)).toBeNull()
    })
  })

  it('opens the create form with the sections the warehouse model now carries', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Basic information' })).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Location' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Capacity' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Inventory controls' })).toBeTruthy()
    expect(screen.getByLabelText(/Maximum stock units/)).toBeTruthy()
  })

  it('creates through the existing API, with a blank capacity sent as null not 0', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /new warehouse/i }))
    await waitFor(() => expect(screen.getByLabelText(/Warehouse name/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/Warehouse name/), { target: { value: 'Nagpur depot' } })
    fireEvent.click(screen.getByRole('button', { name: /create warehouse/i }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({ warehouse_name: 'Nagpur depot', capacity_units: null, area: null })
  })

  it('deactivates a warehouse through the same update endpoint', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Actions for Main/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }))
    await waitFor(() => expect(h.updated).toHaveLength(1))
    expect(h.updated[0]).toEqual([1, { is_active: 0 }])
  })

  it('deletes through the same endpoint, behind a confirmation', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Actions for Main/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Delete warehouse?')).toBeTruthy())
    // The default warehouse says so before it is removed.
    expect(screen.getByText(/currently configured as the default warehouse/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete warehouse' }))
    await waitFor(() => expect(h.removed).toEqual([1]))
  })

  it('hides every write action from a read-only user', async () => {
    h.permissions = new Set([...READ, STOCK])
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /new warehouse/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Actions for Main/i }))
    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('focuses its own search box on "/" rather than opening the command palette', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    const box = screen.getByLabelText('Search warehouses')
    expect(document.activeElement).not.toBe(box)
    fireEvent.keyDown(window, { key: '/' })
    await waitFor(() => expect(document.activeElement).toBe(box))
  })

  it('opens the create form on "n" when the user may write', async () => {
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    fireEvent.keyDown(window, { key: 'n' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Basic information' })).toBeTruthy())
  })

  it('leaves "n" alone for a read-only user', async () => {
    h.permissions = new Set([...READ, STOCK])
    mount()
    await waitFor(() => expect(inTable('Main')).toBeTruthy())
    fireEvent.keyDown(window, { key: 'n' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('heading', { name: 'Basic information' })).toBeNull()
  })

  it('refuses the screen to a user with no warehouse read permission', () => {
    h.permissions = new Set()
    mount()
    expect(screen.getByText(/do not have permission to view warehouses/i)).toBeTruthy()
  })
})
