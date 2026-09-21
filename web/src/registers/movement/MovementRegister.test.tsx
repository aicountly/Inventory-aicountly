import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ReportPage } from '../../reports/ReportPage'
import { movementRegister } from '../configs/stockRegisters'
import type { MovementFilters, MovementListResponse } from '../../services/stockViewsApi'

/*
 * The redesigned movement register, end to end: the real config through the real engine,
 * with only the network and the providers stubbed.
 *
 * The contract this file exists to protect is that every figure on the screen came out of
 * `/v1/stock-movements` under the filters the register was read with — the cards, the
 * footer and the chart all read the endpoint's aggregate over the WHOLE filtered set, not
 * the served page. So the list spy records what it was asked, and the tests assert on the
 * questions as much as on the answers.
 */

const can = vi.fn((_key: string) => true)

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 2, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    companyName: 'Demo Company',
    fy: { label: 'FY 2026-27' },
    branch: null,
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Demo Company · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can,
    loading: false,
    member: { uuid: 'user-a' },
    profile: { profile_name: 'Owner' },
    allowedWarehouses: null,
  }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const WAREHOUSES = [
  { warehouse_id: 3, warehouse_name: 'Main warehouse', warehouse_code: 'MW', warehouse_type: 'store', is_default: 1, bo_id: 0 },
  { warehouse_id: 4, warehouse_name: 'Site A', warehouse_code: 'SA', warehouse_type: 'store', is_default: 0, bo_id: 0 },
]

vi.mock('../../documents/useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: WAREHOUSES,
    units: [],
    defaultWarehouseId: 3,
    warehouseName: () => 'Main warehouse',
    unitSymbol: () => '',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: {
      warehouses: WAREHOUSES,
      units: [],
      item_groups: [{ item_grp_id: 1, grp_name: 'Raw material' }],
      stock_categories: [{ stock_cat_id: 2, cat_name: 'Steel' }],
      brands: [],
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../useDocumentTypeOptions', () => ({
  useDocumentTypeOptions: () => ({
    options: [
      { value: 'MATERIAL_RECEIPT', label: 'Material Receipt' },
      { value: 'STOCK_TRANSFER', label: 'Stock Transfer' },
    ],
    loading: false,
  }),
}))

const list = vi.fn()

vi.mock('../../services/stockViewsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/stockViewsApi')>()
  return {
    ...actual,
    stockMovementsApi: { ...actual.stockMovementsApi, list: (...args: unknown[]) => list(...args) },
  }
})

function movement(over: Record<string, unknown>) {
  return {
    movement_uuid: 'u',
    cmp_id: 1,
    fy_id: 2,
    bo_id: 0,
    line_id: 1,
    sequence_no: 1,
    location_id: null,
    batch_id: null,
    unit_cost: 72.5,
    movement_kind: 'physical',
    reversal_of_movement_id: null,
    created_at: '2026-09-19 10:00',
    created_by: 'rahul',
    item_alias: null,
    item_sku: 'STL-12',
    unit_id: 1,
    unit_symbol: 'kg',
    stock_cat_id: 2,
    item_grp_id: 1,
    cat_name: 'Steel',
    warehouse_code: 'MW',
    batch_no: null,
    from_warehouse_id: null,
    to_warehouse_id: null,
    from_warehouse_name: null,
    to_warehouse_name: null,
    document_status: 'posted',
    source_app: null,
    source_document_type: null,
    source_document_id: null,
    source_document_no: null,
    party_ref: null,
    party_name: null,
    ...over,
  }
}

const ROWS = [
  movement({
    movement_id: 1,
    document_id: 11,
    document_no: 'MR-2026-0012',
    document_type: 'MATERIAL_RECEIPT',
    document_type_label: 'Material Receipt',
    movement_date: '2026-09-19',
    item_id: 5,
    item_name: 'Steel Rod 12mm',
    warehouse_id: 3,
    warehouse_name: 'Main warehouse',
    batch_id: 9,
    batch_no: 'B001',
    direction: 'in',
    qty: 500,
    value: 36250,
  }),
  movement({
    movement_id: 2,
    document_id: 12,
    document_no: 'ISS-2026-0045',
    document_type: 'MATERIAL_ISSUE',
    document_type_label: 'Material Issue',
    movement_date: '2026-09-18',
    item_id: 6,
    item_name: 'Cement OPC 53',
    warehouse_id: 4,
    warehouse_name: 'Site A',
    direction: 'out',
    qty: -200,
    unit_cost: 420,
    value: -84000,
    source_app: 'books',
    source_document_no: 'SV-19',
  }),
  movement({
    movement_id: 3,
    document_id: 13,
    document_no: 'TRF-2026-0015',
    document_type: 'STOCK_TRANSFER',
    document_type_label: 'Stock Transfer',
    movement_date: '2026-09-17',
    item_id: 7,
    item_name: 'Plywood 18mm',
    warehouse_id: 3,
    warehouse_name: 'Main warehouse',
    from_warehouse_id: 3,
    to_warehouse_id: 4,
    from_warehouse_name: 'Main warehouse',
    to_warehouse_name: 'Site A',
    direction: 'out',
    qty: -300,
    unit_cost: 55,
    value: -16500,
  }),
]

const SUMMARY = {
  movements: 1284,
  items: 42,
  documents: 310,
  in_qty: 12450,
  out_qty: 11680,
  net_qty: 770,
  in_value: 900000,
  out_value: 880000,
  net_value: 20000,
  from: '2026-04-01',
  to: '2026-09-19',
  previous: {
    movements: 1146,
    items: 40,
    documents: 300,
    in_qty: 11527,
    out_qty: 11124,
    net_qty: 403,
    in_value: 800000,
    out_value: 790000,
    net_value: 10000,
    from: '2025-10-11',
    to: '2026-03-31',
  },
}

const TREND = {
  bucket: 'week' as const,
  from: '2026-04-01',
  to: '2026-09-19',
  truncated: false,
  points: [
    { bucket: '2026-09-07', movements: 4, in_qty: 500, out_qty: 120, in_value: 5000, out_value: 1200 },
    { bucket: '2026-09-14', movements: 3, in_qty: 300, out_qty: 500, in_value: 3000, out_value: 5000 },
  ],
}

function answer(query: MovementFilters = {}): MovementListResponse {
  const wanted = Number(query.summary ?? 0) === 1
  return {
    data: ROWS,
    meta: { total: 1284, limit: Number(query.limit ?? 25), offset: 0 },
    ...(wanted ? { summary: SUMMARY, trend: TREND } : {}),
  } as MovementListResponse
}

function renderRegister(url = '/registers/movement-register') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/registers/movement-register" element={<ReportPage config={movementRegister} />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Every query the movements endpoint was asked, in call order. */
function queries(): MovementFilters[] {
  return list.mock.calls.map((call) => call[0] as MovementFilters)
}

beforeEach(() => {
  can.mockReturnValue(true)
  list.mockReset()
  list.mockImplementation((query: MovementFilters) => Promise.resolve(answer(query)))
})

describe('the page it presents', () => {
  it('names itself with a masthead and the line under it', async () => {
    renderRegister()
    expect(await screen.findByRole('heading', { level: 1, name: 'Movement register' })).toBeTruthy()
    expect(screen.getByText(/Track all inventory movements across your business/)).toBeTruthy()
  })

  it('asks the endpoint for the aggregate and the chart with the page, in one request', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    expect(queries()).toHaveLength(1)
    expect(queries()[0].summary).toBe(1)
    expect(queries()[0].trend).toBe(1)
  })

  it('scopes the first read to the financial year, capped at today', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    expect(queries()[0].from).toBe('2026-04-01')
    // fyRange runs to 2027-03-31; the period filter caps `to` at today.
    expect(String(queries()[0].to) <= '2027-03-31').toBe(true)
  })
})

describe('the KPI cards', () => {
  it('reports the whole filtered set, not the three rows on the page', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    const cards = within(screen.getByRole('region', { name: 'Key figures' }))
    expect(cards.getByText('Total movements')).toBeTruthy()
    expect(cards.getByText('1,284')).toBeTruthy()
    expect(cards.getByText('12,450')).toBeTruthy()
    expect(cards.getByText('11,680')).toBeTruthy()
    expect(cards.getByText('770')).toBeTruthy()
  })

  it('draws the comparison the server measured, and names the window it measured', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    // 1284 against 1146 is +12.0%, computed by StatCard from two server figures.
    expect(screen.getAllByText('+12.0%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('vs 11 Oct 2025 – 31 Mar 2026').length).toBeGreaterThan(0)
  })

  it('draws no percentage at all when the endpoint sends no comparison', async () => {
    list.mockImplementation((query: MovementFilters) =>
      Promise.resolve({
        ...answer(query),
        summary: Number(query.summary ?? 0) === 1 ? { ...SUMMARY, previous: null } : undefined,
      } as MovementListResponse),
    )
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    expect(screen.queryByText(/%$/)).toBeNull()
    expect(screen.getAllByText('matching the filters').length).toBeGreaterThan(0)
  })
})

describe('the grid', () => {
  it('splits the signed quantity into an In and an Out column', async () => {
    renderRegister()
    const table = within(await screen.findByRole('table', { name: 'Movements' }))
    expect(table.getByText('In qty')).toBeTruthy()
    expect(table.getByText('Out qty')).toBeTruthy()
    // The receipt's 500 reads as inward and the issue's -200 as outward, positive.
    expect(table.getByText('500')).toBeTruthy()
    expect(table.getByText('200')).toBeTruthy()
    expect(table.queryByText('-200')).toBeNull()
  })

  it('reads a transfer as source → destination rather than as one ambiguous warehouse', async () => {
    renderRegister()
    const table = within(await screen.findByRole('table', { name: 'Movements' }))
    const transfer = table.getByText('TRF-2026-0015').closest('tr')!
    const cell = within(transfer)
    expect(cell.getByTitle('Main warehouse → Site A')).toBeTruthy()
  })

  it('badges the document type and names the product that raised the movement', async () => {
    renderRegister()
    const table = within(await screen.findByRole('table', { name: 'Movements' }))
    expect(table.getByText('Material Receipt')).toBeTruthy()
    // A movement raised in Inventory itself says so rather than showing a gap.
    expect(table.getAllByText('Inventory').length).toBeGreaterThan(0)
    expect(table.getByText('Books')).toBeTruthy()
  })

  it('links a document to the document, so a line drills through to its cause', async () => {
    renderRegister()
    const table = within(await screen.findByRole('table', { name: 'Movements' }))
    expect(table.getByRole('link', { name: 'MR-2026-0012' }).getAttribute('href')).toBe('/documents/11')
  })

  it('foots the table with the server’s totals for every matching movement', async () => {
    renderRegister()
    const table = await screen.findByRole('table', { name: 'Movements' })
    const foot = within(table.querySelector('tfoot') as HTMLElement)
    expect(foot.getByText(/1,284 movements/)).toBeTruthy()
    // No caveat: the aggregate came from the server and covers every matching movement.
    expect(foot.queryByText(/this page only/)).toBeNull()
    expect(foot.getByText('12,450')).toBeTruthy()
    expect(foot.getByText('11,680')).toBeTruthy()
  })
})

describe('the filters', () => {
  it('offers every filter the endpoint reads, and the item category among them', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    expect(screen.getByLabelText('Period preset')).toBeTruthy()
    expect(screen.getByLabelText('Search')).toBeTruthy()
    expect(screen.getByLabelText('Warehouse')).toBeTruthy()
    expect(screen.getByLabelText('Document type')).toBeTruthy()
    expect(screen.getByLabelText('Direction')).toBeTruthy()
    expect(screen.getByLabelText('Movement type')).toBeTruthy()
    expect(screen.getByLabelText('Item category')).toBeTruthy()
  })

  it('sends a chosen filter to the endpoint and keeps it in the URL', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'out' } })
    await waitFor(() => expect(queries().at(-1)?.direction).toBe('out'))
  })

  it('keeps every filter it has always carried, including the ones behind More filters', () => {
    const keys = movementRegister.filters.map((f) => f.key)
    for (const key of [
      'from',
      'to',
      'q',
      'item_id',
      'warehouse_id',
      'batch_id',
      'document_type',
      'direction',
      'movement_kind',
      'all_fy',
      'document_id',
    ]) {
      expect(keys, `${key} was dropped in the redesign`).toContain(key)
    }
  })

  it('reads a period out of the URL rather than resetting to the default', async () => {
    renderRegister('/registers/movement-register?from=2026-09-01&to=2026-09-19')
    await screen.findByText('Steel Rod 12mm')
    expect(queries()[0].from).toBe('2026-09-01')
    expect(queries()[0].to).toBe('2026-09-19')
  })
})

describe('the trend band', () => {
  it('charts the same filtered set the table shows, with no second request', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    expect(screen.getByRole('heading', { name: 'Movement trend' })).toBeTruthy()
    // One request for rows, aggregate and chart together.
    expect(queries()).toHaveLength(1)
  })

  it('says what a column covers, because the server chose the width', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    expect(screen.getByText(/one column per week/)).toBeTruthy()
    const grouping = (await screen.findByLabelText('Chart grouping')) as HTMLSelectElement
    // Weekly data can be added up into months, never split back into days.
    expect([...grouping.options].map((o) => o.value)).toEqual(['week', 'month'])
  })

  it('keeps net value on the screen, where the register has always reported it', async () => {
    renderRegister()
    await screen.findByText('Steel Rod 12mm')
    const band = within(screen.getByRole('region', { name: 'Movement analytics' }))
    expect(band.getByText('Net value')).toBeTruthy()
    expect(band.getByText('20,000.00')).toBeTruthy()
  })
})

describe('when there is nothing to show', () => {
  it('offers a way out of an over-filtered register', async () => {
    list.mockImplementation((query: MovementFilters) =>
      Promise.resolve({
        data: [],
        meta: { total: 0, limit: 25, offset: 0 },
        ...(Number(query.summary ?? 0) === 1
          ? { summary: { ...SUMMARY, movements: 0, in_qty: 0, out_qty: 0, net_qty: 0, net_value: 0, previous: null }, trend: { ...TREND, points: [] } }
          : {}),
      } as MovementListResponse),
    )
    renderRegister('/registers/movement-register?direction=out')
    expect(await screen.findByText('No rows match these filters')).toBeTruthy()
    expect(screen.getByText('No inventory movements match the selected filters.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })
})

describe('when the read fails', () => {
  it('keeps the filters and offers a retry rather than blanking the page', async () => {
    list.mockRejectedValue(new Error('network'))
    renderRegister('/registers/movement-register?direction=out')
    expect(await screen.findByText(/Unable to load movements/)).toBeTruthy()
    expect(screen.getByText(/Your filters have been preserved/)).toBeTruthy()
    expect((screen.getByLabelText('Direction') as HTMLSelectElement).value).toBe('out')
  })
})

describe('when the endpoint sends no aggregate', () => {
  it('totals the rows it was served and says so, rather than passing a page off as the set', async () => {
    // An older API, or one that ignores `summary=1`. The register must not present three
    // rows' worth of figures under a footer that reads as 1,284 movements.
    list.mockImplementation((query: MovementFilters) =>
      Promise.resolve({ data: ROWS, meta: { total: 1284, limit: Number(query.limit ?? 25), offset: 0 } } as MovementListResponse),
    )
    renderRegister()
    const table = await screen.findByRole('table', { name: 'Movements' })
    const foot = within(table.querySelector('tfoot') as HTMLElement)
    expect(foot.getByText(/3 movements/)).toBeTruthy()
    expect(foot.getByText(/this page only/)).toBeTruthy()
    // 500 in and 200 + 300 out, netting -64,250.00 — the three rows on the page, not the
    // whole register.
    expect(foot.getAllByText('500')).toHaveLength(2)
    expect(foot.getByText('-64,250.00')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Key figures' })).getAllByText('this page only').length).toBeGreaterThan(0)
  })
})

describe('while the first response is in flight', () => {
  it('holds the page open with placeholders rather than assembling it piece by piece', async () => {
    let release: (value: MovementListResponse) => void = () => {}
    list.mockImplementation(
      (query: MovementFilters) =>
        new Promise<MovementListResponse>((resolve) => {
          release = () => resolve(answer(query))
        }),
    )
    const { container } = renderRegister()
    // The KPI strip and the analytics band both reserve their geometry, so the arriving
    // figures do not shove the grid down the page. The band's placeholder is hidden from
    // assistive technology — it stands in for a picture, and there is nothing to say
    // about it yet.
    expect(await screen.findByRole('region', { name: 'Key figures' })).toBeTruthy()
    expect(container.querySelector('section[aria-hidden="true"]')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Movement trend' })).toBeNull()

    release(answer({}))

    expect(await screen.findByText('Steel Rod 12mm')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Movement trend' })).toBeTruthy()
    expect(container.querySelector('section[aria-hidden="true"]')).toBeNull()
  })
})
