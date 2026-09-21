import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CostLayerRow, CostLayersResponse } from '../../../services/valuationApi'

/**
 * What the cost-layers screen promises a reader.
 *
 * The four claims pinned here are the ones that would quietly become false:
 * that a figure nobody can compute renders as a dash rather than a zero, that
 * the derived panels say how far their reading goes, that a quick filter is a
 * server query and not a sift of the page, and that a failed request says so
 * instead of showing an empty table.
 */

vi.mock('../../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: vi.fn(() => true),
}))

vi.mock('../../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    fy: { fy_id: 3, label: 'FY 2026-27' },
    branch: null,
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' }, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: { warehouses: [], units: [] }, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

vi.mock('../../../services/lookupApi', () => ({
  lookupApi: {
    itemsByIds: async () => [{ item_id: 12, item_name: 'Paracetamol 500mg', item_sku: 'PCM500', unit_id: 1, unit_symbol: 'Pcs' }],
    batches: async () => ({ data: [], meta: { total: 0, limit: 200, offset: 0 } }),
  },
}))

vi.mock('../../../services/registersApi', () => ({
  fetchRegistersSummary: async () => ({
    as_on: '2026-09-01',
    fy: { from: '2026-04-01', to: '2027-03-31' },
    currency: 'INR',
    items: null,
    warehouses: null,
    locations: null,
    movements: null,
    stock_value: { amount: 247832560, as_of: '2026-08-31', source: 'reconciliation' },
  }),
}))

vi.mock('../../../services/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/items')>()
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, get: async () => ({ item_id: 12, unit_symbol: 'Pcs', cat_name: 'Analgesics' }) },
  }
})

const costLayers = vi.fn()

vi.mock('../../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/valuationApi')>()
  return {
    ...actual,
    valuationApi: {
      ...actual.valuationApi,
      costLayers: (...args: unknown[]) => costLayers(...args),
      recalcJobs: async () => ({ data: [], meta: { total: 0, limit: 5, offset: 0 } }),
      revisions: async () => ({ data: [], meta: { total: 0, limit: 5, offset: 0 } }),
      snapshot: async () => ({
        data: [
          {
            item_id: 12,
            item_name: 'Paracetamol 500mg',
            item_alias: null,
            item_sku: 'PCM500',
            unit_symbol: 'Pcs',
            closing_qty: 600,
            unit_cost: 1.42,
            stock_value: 852,
            valuation_method_applied: 'FIFO',
          },
        ],
        meta: { total: 1, limit: 1, offset: 0 },
        summary: { as_of: '2026-09-01', method: 'FIFO', total_qty: 600, total_value: 852, item_count: 1 },
      }),
    },
  }
})

const { CostLayersPage } = await import('../CostLayersPage')

function layer(over: Partial<CostLayerRow> = {}): CostLayerRow {
  return {
    layer_id: 1,
    fy_id: 3,
    item_id: 12,
    warehouse_id: 4,
    batch_id: null,
    layer_kind: 'receipt',
    qty_received: 1000,
    qty_remaining: 600,
    unit_cost: 1.25,
    received_at: '2026-04-12 10:05:00',
    source_document_id: 501,
    source_line_id: 1,
    created_at: '2026-04-12 10:05:00',
    warehouse_name: 'Main Warehouse',
    source_document_no: 'GRN-2026-0412',
    source_document_type: 'goods_receipt',
    source_document_date: '2026-04-12',
    qty_consumed: 400,
    remaining_value: 750,
    consumptions: [],
    ...over,
  }
}

function response(rows: CostLayerRow[]): CostLayersResponse {
  return {
    data: rows,
    meta: { total: rows.length, limit: 25, offset: 0 },
    item: {
      item_id: 12,
      item_name: 'Paracetamol 500mg',
      item_alias: null,
      item_sku: 'PCM500',
      unit_id: 1,
      valuation_method: 'FIFO',
    },
    summary: {
      open_qty: 600,
      open_value: 750,
      backorder_qty: 0,
      layer_count: 3,
      received_qty: 3000,
      received_value: 4000,
      unit_cost_min: 1.2,
      unit_cost_max: 1.3,
      unit_cost_avg: 1.25,
      first_received_at: '2026-04-01 00:00:00',
      last_received_at: '2026-04-12 10:05:00',
    },
    distribution: {
      layer_count: 3,
      total_qty: 3000,
      total_value: 4000,
      buckets: [
        { status: 'open', layer_count: 1, qty: 1000, value: 1250 },
        { status: 'partial', layer_count: 1, qty: 1000, value: 1250 },
        { status: 'closed', layer_count: 1, qty: 1000, value: 1500 },
        { status: 'negative', layer_count: 0, qty: 0, value: 0 },
      ],
    },
  }
}

beforeEach(() => {
  costLayers.mockReset()
  costLayers.mockImplementation(async () => response([layer()]))
  window.localStorage.clear()
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CostLayersPage />
    </MemoryRouter>,
  )
}

describe('CostLayersPage', () => {
  it('asks for an item before it asks the API for anything', async () => {
    renderAt('/valuation/cost-layers')
    await waitFor(() => expect(screen.getByText(/Select an item to inspect its valuation layers/i)).toBeTruthy())
    expect(costLayers).not.toHaveBeenCalled()
    // The item-scoped cards have no figure yet, and say so rather than showing a zero.
    expect(screen.getAllByText('Choose an item to read this').length).toBeGreaterThan(0)
  })

  it('reads the company stock value from the registers summary, not from the rows', async () => {
    renderAt('/valuation/cost-layers')
    await waitFor(() => expect(screen.getByText(/Whole company as at/i)).toBeTruthy())
    expect(screen.getByText('₹ 24.78 Cr')).toBeTruthy()
  })

  it('sends every filter to the server and draws the layers it returns', async () => {
    renderAt('/valuation/cost-layers?item_id=12&period=2026-04')
    await waitFor(() => expect(screen.getByText('GRN-2026-0412')).toBeTruthy())

    const query = costLayers.mock.calls[0][0] as Record<string, unknown>
    expect(query).toMatchObject({ item_id: '12', from: '2026-04-01', to: '2026-04-30', open_only: 1 })
    // The state badge in the row, not the chip above it or the legend beside it.
    expect(within(screen.getByRole('table')).getByText('Partially consumed')).toBeTruthy()
  })

  it('turns a quick filter into a server query rather than sifting the page', async () => {
    renderAt('/valuation/cost-layers?item_id=12')
    await waitFor(() => expect(screen.getByText('GRN-2026-0412')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Negative layers' }))

    await waitFor(() => {
      const last = costLayers.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(last.status).toBe('negative')
    })
  })

  it('counts the exceptions it found and says how far it looked', async () => {
    costLayers.mockImplementation(async () =>
      response([layer(), layer({ layer_id: 2, qty_remaining: -40, qty_received: null, layer_kind: 'backorder' })]),
    )
    renderAt('/valuation/cost-layers?item_id=12')

    await waitFor(() => expect(screen.getByRole('button', { name: /Review exceptions/i })).toBeTruthy())
    expect(screen.getByRole('button', { name: /Review exceptions 1/i })).toBeTruthy()

    // The insight leads with the negative balance, and the card states its scope.
    expect(screen.getByText(/carr(y|ies) a negative balance/i)).toBeTruthy()
    expect(screen.getByText(/Worked out on this device from the 2 layers currently loaded/i)).toBeTruthy()
  })

  it('says nothing stood out rather than inventing an observation', async () => {
    renderAt('/valuation/cost-layers?item_id=12')
    await waitFor(() => expect(screen.getByText(/Nothing stood out in the 1 layer read/i)).toBeTruthy())
  })

  it('reports a failed request instead of showing an empty table', async () => {
    costLayers.mockImplementation(async () => {
      throw new Error('boom')
    })
    renderAt('/valuation/cost-layers?item_id=12')
    await waitFor(() => expect(screen.getByText('Unable to load valuation layers')).toBeTruthy())
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('dates the figures from the last good fetch, and says so when one fails', async () => {
    renderAt('/valuation/cost-layers?item_id=12')
    await waitFor(() => expect(screen.getByText('Live data')).toBeTruthy())
    expect(screen.getByText(/last updated/i)).toBeTruthy()
  })

  it('marks the grid stale rather than current when a RELOAD fails', async () => {
    /*
     * The page keeps the previous rows on screen when a request dies, which is
     * right — but a stale grid that still reads "Live data" is the one state
     * this badge exists to prevent.
     *
     * It has to be a reload, not a first load: with nothing ever fetched there
     * is no "last good data" to be showing, and the badge correctly renders
     * nothing at all.
     */
    renderAt('/valuation/cost-layers?item_id=12')
    await waitFor(() => expect(screen.getByText('Live data')).toBeTruthy())

    costLayers.mockImplementation(async () => {
      throw new Error('boom')
    })
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(screen.getByText('Showing last good data')).toBeTruthy())
    // The stamp must not move on a failure, or the badge dates the new empty
    // screen by the old fetch.
    expect(screen.getByText(/last updated/i)).toBeTruthy()
  })

  it('splits the distribution over every layer state, not the filtered page', async () => {
    renderAt('/valuation/cost-layers?item_id=12&status=open')
    await waitFor(() => expect(screen.getByText('Cost layer distribution')).toBeTruthy())
    // One layer came back under `status=open`, but the bar still describes all
    // three states — that is the whole reason the server sends it separately.
    const bar = screen.getByRole('img', { name: /per cent/i })
    expect(bar.getAttribute('aria-label')).toContain('Open')
    expect(bar.getAttribute('aria-label')).toContain('Partially consumed')
    expect(bar.getAttribute('aria-label')).toContain('Closed')
    expect(screen.getByText(/the open-layer toggle and the state filter do not narrow it/i)).toBeTruthy()
  })
})
