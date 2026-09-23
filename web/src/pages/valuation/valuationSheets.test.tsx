import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CostLayerRow, CostLayersResponse, RecalcJob } from '../../services/valuationApi'
import { pickExport, clickPrint } from '../../test/exportMenu'

/**
 * The two valuation screens that had no export at all. What is worth pinning
 * here is the content of the sheet: the columns whose value is not the raw
 * field (kind, source document, trigger, scope) and the money columns, which on
 * these screens are cost — not a price anybody was charged.
 */

interface SheetPayload {
  title: string
  companyName?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  summaryCards?: { label: string; value: string }[]
  footerNotes?: string[]
}

const printTabular = vi.fn((_p: SheetPayload) => true)
const downloadCsv = vi.fn((_filename: string, _csv: string) => {})

vi.mock('../../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: vi.fn(async () => {}),
  printTabular: (p: SheetPayload) => printTabular(p),
}))

vi.mock('../../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/csv')>()
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloadCsv(filename, csv) }
})

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    // The cost-layers period picker is built from the selected year, so the
    // range is part of the scope this screen reads.
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    fy: { fy_id: 3, label: 'FY 2026-27' },
    branch: null,
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../services/registersApi', () => ({
  fetchRegistersSummary: async () => ({
    as_on: '2026-09-01',
    fy: { from: '2026-04-01', to: '2027-03-31' },
    currency: 'INR',
    items: null,
    warehouses: null,
    locations: null,
    movements: null,
    stock_value: { amount: 1234567, as_of: '2026-08-31', source: 'reconciliation' },
  }),
}))

vi.mock('../../services/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/items')>()
  return {
    ...actual,
    itemsApi: { ...actual.itemsApi, get: async () => ({ item_id: 12, unit_symbol: 'Pcs' }) },
  }
})

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' }, allowedWarehouses: null }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: { warehouses: [], units: [] }, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: { itemsByIds: async () => [{ item_id: 12, item_name: 'Widget A', item_sku: 'W-A', unit_id: 1, unit_symbol: 'Pcs' }] },
}))

const costLayers = vi.fn()
const recalcJobs = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return {
    ...actual,
    valuationApi: {
      ...actual.valuationApi,
      costLayers: (...args: unknown[]) => costLayers(...args),
      recalcJobs: (...args: unknown[]) => recalcJobs(...args),
      snapshot: async () => ({
        data: [
          {
            item_id: 12,
            item_name: 'Widget A',
            item_alias: null,
            item_sku: 'W-A',
            unit_symbol: 'Pcs',
            closing_qty: 1200,
            unit_cost: 25.5,
            stock_value: 30600,
            valuation_method_applied: 'FIFO',
          },
        ],
        meta: { total: 1, limit: 1, offset: 0 },
        summary: { as_of: '2026-09-01', method: 'FIFO', total_qty: 1200, total_value: 30600, item_count: 1 },
      }),
      revisions: async () => ({ data: [], meta: { total: 0, limit: 5, offset: 0 } }),
    },
  }
})

const { CostLayersPage } = await import('./CostLayersPage')
const { RecalculationsPage } = await import('./RecalculationsPage')

function layer(id: number): CostLayerRow {
  return {
    layer_id: id,
    fy_id: 3,
    item_id: 12,
    warehouse_id: 4,
    batch_id: null,
    layer_kind: 'receipt',
    qty_received: 100,
    qty_remaining: 40,
    unit_cost: 25.5,
    received_at: '2026-06-01',
    source_document_id: 700 + id,
    source_line_id: 1,
    created_at: '2026-06-01 10:00:00',
    warehouse_name: 'Central store',
    source_document_no: `GRN-${id}`,
    source_document_type: 'goods_receipt',
    source_document_date: '2026-06-01',
    qty_consumed: 60,
    remaining_value: 1020,
    consumptions: [
      { consumption_id: 1, layer_id: id, document_id: 5, line_id: 1, movement_id: 1, qty: 60, unit_cost: 25.5, amount: 1530, created_at: null, document_no: 'DN-5', document_type: 'delivery_note', document_date: '2026-07-01', document_status: 'POSTED' },
    ],
  }
}

function job(id: number): RecalcJob {
  return {
    job_id: id,
    cmp_id: 1,
    fy_id: 3,
    from_date: '2026-04-01',
    item_id: null,
    item_name: null,
    status: 'COMPLETED',
    dry_run: false,
    trigger_kind: 'backdated_receipt',
    trigger_document_id: 88,
    trigger_document_no: 'GRN-88',
    affected_line_count: 120,
    revised_line_count: 44,
    cogs_delta: -2550.75,
    failure_reason: null,
    created_at: '2026-09-01 08:00:00',
    started_at: '2026-09-01 08:00:05',
    finished_at: '2026-09-01 08:00:40',
  } as RecalcJob
}

const LAYERS = Array.from({ length: 30 }, (_, i) => layer(i + 1))
const JOBS = Array.from({ length: 30 }, (_, i) => job(i + 1))

beforeEach(() => {
  printTabular.mockClear()
  downloadCsv.mockClear()
  costLayers.mockReset()
  recalcJobs.mockReset()
  costLayers.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 100)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    const response: CostLayersResponse = {
      data: LAYERS.slice(offset, offset + limit),
      meta: { total: LAYERS.length, limit, offset },
      item: { item_id: 12, item_name: 'Widget A', item_alias: null, item_sku: 'W-A', unit_id: 1, valuation_method: 'FIFO' },
      summary: { open_qty: 1200, open_value: 30600, backorder_qty: 0 },
    }
    return response
  })
  recalcJobs.mockImplementation(async (query: Record<string, unknown> = {}) => {
    const limit = Number(query.limit ?? 50)
    const page = Number(query.page ?? 1)
    const offset = (page - 1) * limit
    return { data: JOBS.slice(offset, offset + limit), meta: { total: JOBS.length, limit, offset } }
  })
})

describe('CostLayersPage export', () => {
  it('writes every layer with its kind, source document and cost', async () => {
    render(
      <MemoryRouter initialEntries={['/valuation/cost-layers?item_id=12&limit=25']}>
        <CostLayersPage />
      </MemoryRouter>,
    )
    await pickExport(/CSV/)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const lines = downloadCsv.mock.calls[0][1].trim().split('\r\n')
    expect(lines[0]).toBe(
      'Layer date,Receipt ref,Warehouse,Batch / lot,Qty in (Pcs),Qty out (Pcs),Balance qty (Pcs),Unit cost (valuation),Remaining value (valuation),Status',
    )
    expect(lines).toHaveLength(31)
    // The state is a badge on screen; the sheet says the word. The item and
    // issue-count columns are off by default — every row carries the same item,
    // and the consumption trail is read by opening a layer.
    expect(lines[1]).toBe('2026-06-01,GRN-1,Central store,,100,60,40,25.5,1020,Partially consumed')
  })

  it('carries the item summary onto the sheet and says where the detail went', async () => {
    render(
      <MemoryRouter initialEntries={['/valuation/cost-layers?item_id=12&limit=25']}>
        <CostLayersPage />
      </MemoryRouter>,
    )
    await clickPrint()
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.summaryCards?.map((c) => `${c.label}: ${c.value}`)).toEqual([
      'Open qty: 1,200',
      'Open value: 30,600.00',
      'Backorder qty: 0',
    ])
    expect(sheet.footerNotes?.join(' ')).toContain('open a layer to read its consumption trail')
    expect(sheet.rows).toHaveLength(30)
  })
})

describe('RecalculationsPage export', () => {
  it('writes every job, naming the COGS delta as a valuation figure', async () => {
    render(
      <MemoryRouter initialEntries={['/valuation/recalculations?limit=25']}>
        <RecalculationsPage />
      </MemoryRouter>,
    )
    await pickExport(/CSV/)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())

    const lines = downloadCsv.mock.calls[0][1].trim().split('\r\n')
    expect(lines[0]).toContain('COGS delta (valuation)')
    expect(lines).toHaveLength(31)
    // Mode, scope and trigger read as words, not as `false`, `null` and a token.
    expect(lines[1]).toContain('Live')
    expect(lines[1]).toContain('All items')
    expect(lines[1]).toContain('Backdated receipt · GRN-88')
  })
})
