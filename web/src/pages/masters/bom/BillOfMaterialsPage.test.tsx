import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Bom, BomSummary } from '../../../services/masters'

/**
 * The bill-of-materials workspace, from the endpoints up.
 *
 * Only the services and the two contexts are faked; the real hooks, the real
 * table and the real presentation rules all run, because what is worth
 * protecting lives between them: that the KPI strip prints what the summary
 * endpoint said and an em dash when it said nothing, that a cost that could not
 * be read never becomes a zero, that an API failure is not dressed up as an
 * empty company, that the list asks for its component previews in ONE request,
 * and that a profile which may not write is not shown buttons the server would
 * refuse.
 */

const h = vi.hoisted(() => {
  const state = {
    permissions: null as Set<string> | null,
    accessLoading: false,
    rows: [] as unknown[],
    total: 0,
    listError: null as Error | null,
    summary: null as unknown,
    summaryError: null as Error | null,
    listCalls: [] as Record<string, unknown>[],
  }
  return { state }
})

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Aicountly Interactive Services',
    addressLines: [],
    gstin: '',
    logo: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Demo · FY 2026-27' }))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) => {
      if (h.state.permissions === null) return true
      const keys = typeof key === 'string' ? [key] : key
      return keys.some((k) => h.state.permissions!.has(k))
    },
    loading: h.state.accessLoading,
  }),
  useCan: () => true,
}))

vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      item_groups: [{ item_grp_id: 4, grp_name: 'Furniture', grp_alias: null, is_primary: 1, parent_grp_id: null }],
      stock_categories: [],
      brands: [],
      units: [],
      warehouses: [],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invalidateFormOptions: vi.fn(),
}))

vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../../services/masters', () => ({
  bomApi: {
    list: async (query: Record<string, unknown>) => {
      h.state.listCalls.push(query)
      if (h.state.listError) throw h.state.listError
      return { data: h.state.rows, meta: { total: h.state.total, limit: 50, offset: 0 } }
    },
    summary: async () => {
      if (h.state.summaryError) throw h.state.summaryError
      return h.state.summary
    },
    get: async () => h.state.rows[0],
    cost: async () => null,
    costPreview: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => {},
    duplicate: async () => ({}),
    setActive: async () => ({}),
  },
}))

const { BillOfMaterialsPage } = await import('./BillOfMaterialsPage')

function bom(over: Partial<Bom> = {}): Bom {
  return {
    bom_id: 1,
    bom_code: 'BOM-001',
    bom_name: 'Office Chair - Standard',
    finished_item_id: 900,
    yield_qty: 1,
    yield_unit_id: 1,
    is_active: 1,
    finished_item_name: 'Office Chair',
    finished_item_sku: 'ITM-CH-001',
    finished_item_is_active: 1,
    finished_item_group_name: 'Furniture',
    yield_unit_symbol: 'pc',
    line_count: 6,
    component_count: 6,
    updated_at: '2026-09-16 11:02:30',
    updated_by_name: 'Rahul Gupta',
    components_preview: [
      { item_id: 1, item_name: 'Wooden seat', item_sku: 'WS-1', qty: 1, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
      { item_id: 2, item_name: 'Metal leg', item_sku: 'ML-1', qty: 4, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
      { item_id: 3, item_name: 'Screw', item_sku: 'SC-1', qty: 16, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
      { item_id: 4, item_name: 'Armrest', item_sku: 'AR-1', qty: 2, unit_symbol: 'pc', scrap_percent: 0, item_is_active: 1 },
    ],
    ...over,
  }
}

const SUMMARY: BomSummary = {
  total: 24,
  active: 20,
  inactive: 4,
  average_components: 6.8,
  component_lines: 163,
  linked_finished_items: 18,
  linked_finished_items_active: 16,
  created_last_30_days: 4,
  created_previous_30_days: 1,
  estimated_material_cost: 1246000,
  costed_boms: 18,
  partially_costed_boms: 2,
  currency: 'INR',
}

function mount(path = '/masters/bill-of-materials') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BillOfMaterialsPage />
    </MemoryRouter>,
  )
}

/*
 * SmartTable paints its header the moment the page mounts and carries
 * `aria-busy` until the first page of rows lands, so finding the table proves
 * only that the header exists. Every test below then reaches straight for row
 * content, and on a slow runner that race is lost: CI failed here looking for
 * a row checkbox against a still-busy table. Wait for the table to go idle.
 */
async function loadedTable(): Promise<HTMLElement> {
  await screen.findByRole('table', { name: /bills of materials/i })
  return waitFor(() => {
    const table = screen.getByRole('table', { name: /bills of materials/i })
    expect(table.getAttribute('aria-busy')).toBeNull()
    return table
  })
}

beforeEach(() => {
  h.state.permissions = null
  h.state.accessLoading = false
  h.state.rows = []
  h.state.total = 0
  h.state.listError = null
  h.state.summary = SUMMARY
  h.state.summaryError = null
  h.state.listCalls = []
})

describe('the populated screen', () => {
  beforeEach(() => {
    h.state.rows = [bom()]
    h.state.total = 24
  })

  it('renders the hero, the six figures and the row', async () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Bill of Materials', level: 1 })).toBeTruthy()

    const strip = await screen.findByRole('region', { name: 'Bill of materials summary' })
    expect(within(strip).getByText('24')).toBeTruthy()
    expect(within(strip).getByText('20')).toBeTruthy()
    // 20 of 24 — a share the page computes, not one the API sent.
    expect(within(strip).getByText('83% of all bills')).toBeTruthy()
    expect(within(strip).getByText('6.8')).toBeTruthy()
    expect(within(strip).getByText('₹ 12.46 L')).toBeTruthy()
    expect(within(strip).getByText('+4')).toBeTruthy()

    const table = await loadedTable()
    expect(within(table).getByText('BOM-001')).toBeTruthy()
    expect(within(table).getByText('Office Chair - Standard')).toBeTruthy()
    expect(within(table).getByText('ITM-CH-001')).toBeTruthy()
    expect(within(table).getByText('by Rahul Gupta')).toBeTruthy()
  })

  /*
   * Six components, three chips, `+3 more`. The count comes from
   * `component_count`, so a BOM whose preview was capped server-side still
   * reports how many it really has.
   */
  it('shows three component chips and a +N button for the rest', async () => {
    mount()
    const table = await loadedTable()
    expect(within(table).getByRole('button', { name: 'Wooden seat · 1 pc' })).toBeTruthy()
    expect(within(table).getByRole('button', { name: '+3 more' })).toBeTruthy()
  })

  it('opens the remaining components in a popover', async () => {
    mount()
    const table = await loadedTable()
    fireEvent.click(within(table).getByRole('button', { name: '+3 more' }))
    const popover = await screen.findByRole('dialog', { name: /Components of Office Chair - Standard/ })
    expect(within(popover).getByText('6 components')).toBeTruthy()
    expect(within(popover).getByText('Armrest')).toBeTruthy()
    // Four previewed of six: the popover says so rather than implying it holds them all.
    expect(within(popover).getByText(/2 more — open the bill/)).toBeTruthy()
  })

  it('asks for the component previews in the same request as the rows', async () => {
    mount()
    await loadedTable()
    expect(h.state.listCalls[0]).toMatchObject({ with_preview: 1 })
  })

  it('marks a bill whose component has been deactivated as needing review', async () => {
    const preview = bom().components_preview!
    h.state.rows = [bom({ components_preview: [{ ...preview[0], item_is_active: 0 }, ...preview.slice(1)] })]
    mount()
    const table = await loadedTable()
    expect(within(table).getByLabelText(/Needs review\. Component "Wooden seat" is inactive\./)).toBeTruthy()
  })

  it('narrows the list by status through the URL', async () => {
    mount()
    await loadedTable()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } })
    await waitFor(() => {
      expect(h.state.listCalls.at(-1)).toMatchObject({ status: 'active' })
    })
  })

  it('searches after the typing stops, not on every keystroke', async () => {
    mount()
    await loadedTable()
    const before = h.state.listCalls.length
    const box = screen.getByLabelText('Search bills of materials')
    fireEvent.change(box, { target: { value: 'c' } })
    fireEvent.change(box, { target: { value: 'ch' } })
    fireEvent.change(box, { target: { value: 'chair' } })
    expect(h.state.listCalls.length).toBe(before)
    await waitFor(() => {
      expect(h.state.listCalls.at(-1)).toMatchObject({ q: 'chair' })
    })
  })

  it('switches to the card view and back', async () => {
    mount()
    await loadedTable()
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Office Chair - Standard', level: 3 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await loadedTable()
  })

  it('offers bulk actions once rows are ticked', async () => {
    mount()
    const table = await loadedTable()
    fireEvent.click(within(table).getByLabelText('Select Office Chair - Standard'))
    expect(await screen.findByText('1 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Deactivate/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Clear selection/ }))
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
  })

  /*
   * The screen this replaced had Refresh, Export and Print in its header. A
   * redesign that quietly dropped one of them would take a capability away
   * from people who use it daily.
   */
  it('keeps refresh, export and print', async () => {
    mount()
    await loadedTable()
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Export$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Print/ })).toBeTruthy()
  })

  it('opens the export menu from the BOM report tile', async () => {
    mount()
    await loadedTable()
    fireEvent.click(screen.getByRole('button', { name: /BOM report/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /PDF/ })).toBeTruthy()
  })

  it('confirms before deactivating and says what will not change', async () => {
    mount()
    const table = await loadedTable()
    fireEvent.click(within(table).getByRole('button', { name: /More actions for Office Chair/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Deactivate BOM?')).toBeTruthy()
    expect(within(dialog).getByText(/Historical records will not be changed/)).toBeTruthy()
  })
})

describe('the empty company', () => {
  it('offers the three ways in, and template shapes', async () => {
    mount()
    const heading = await screen.findByText('No bills of materials yet')
    const empty = within(heading.closest('div')!.parentElement as HTMLElement)
    expect(empty.getByRole('button', { name: /Create your first BOM/ })).toBeTruthy()
    expect(empty.getByRole('button', { name: /^Import BOM$/ })).toBeTruthy()
    expect(empty.getByRole('button', { name: /Create with AI/ })).toBeTruthy()
    expect(empty.getByRole('button', { name: /Manufactured product/ })).toBeTruthy()
  })

  /*
   * "No bills yet" and "no bills match these filters" are different facts. A
   * company with 200 bills told to create its first one has been lied to.
   */
  it('says something different when the filters are what emptied the list', async () => {
    mount('/masters/bill-of-materials?q=nothing-matches-this')
    expect(await screen.findByText('No bills of materials match these filters')).toBeTruthy()
    expect(screen.queryByText('No bills of materials yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await screen.findByText('No bills of materials yet')
  })
})

describe('when something is unavailable', () => {
  /*
   * An API failure and a zero-record company look the same to a reader unless
   * the screen distinguishes them, and "you have no bills of materials" is a
   * statement about their data that the app is in no position to make when the
   * request failed.
   */
  it('reports a failed list rather than showing an empty one', async () => {
    h.state.listError = new Error('Could not reach the Inventory API.')
    mount()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Could not load bills of materials')).toBeTruthy()
    expect(within(alert).getByText('Could not reach the Inventory API.')).toBeTruthy()
    expect(screen.queryByText('No bills of materials yet')).toBeNull()
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('prints an em dash for figures the summary could not supply', async () => {
    h.state.summaryError = new Error('down')
    h.state.rows = [bom()]
    h.state.total = 1
    mount()
    const strip = await screen.findByRole('region', { name: 'Bill of materials summary' })
    expect(within(strip).getAllByText('—').length).toBeGreaterThan(0)
  })

  /*
   * A material cost of ₹0 is a claim: it says these bills cost nothing to
   * build. When nothing could be priced the card has to say so in words.
   */
  it('says "Cost unavailable" rather than printing a zero', async () => {
    h.state.summary = { ...SUMMARY, estimated_material_cost: null, costed_boms: 0 }
    mount()
    const strip = await screen.findByRole('region', { name: 'Bill of materials summary' })
    expect(within(strip).getByText('Cost unavailable')).toBeTruthy()
    expect(within(strip).getByText('no component has a cost yet')).toBeTruthy()
  })
})

describe('permissions', () => {
  it('hides create, import and delete from a read-only profile', async () => {
    h.state.permissions = new Set(['masters.bill_of_materials.read'])
    h.state.rows = [bom()]
    h.state.total = 1
    mount()
    await loadedTable()

    expect(screen.queryByRole('button', { name: /New bill of materials/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /More actions for Office Chair/ }))
    expect(await screen.findByRole('menuitem', { name: 'View details' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).toBeNull()
  })

  it('refuses the screen to a profile that cannot read bills', async () => {
    h.state.permissions = new Set<string>()
    mount()
    expect(
      await screen.findByText(/do not have permission to view bills of materials/),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('the AI drawer', () => {
  it('opens, and says plainly that drafting is not switched on', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Create with AI/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Create BOM with AI' })
    expect(within(drawer).getByText('AI drafting is not available yet')).toBeTruthy()
    // The two starting points that need no AI stay offered.
    expect(within(drawer).getByText('Copy an existing bill')).toBeTruthy()
    expect(within(drawer).getByText('Start from a template')).toBeTruthy()
    // And the review notice is there before anything can be saved.
    expect(within(drawer).getByText(/AI suggestions may require review/)).toBeTruthy()
  })
})
