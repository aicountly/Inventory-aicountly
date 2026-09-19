import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type {
  CostLayerRow,
  CostLayersResponse,
  RecalcJob,
  ValuationSnapshotResponse,
} from '../../services/valuationApi'

/**
 * The cost-layer workspace.
 *
 * What is worth pinning here is not the layout — it is the handful of places
 * where the screen could quietly lie: a chip that asks the server for rows it
 * has just excluded, a rail that describes the item from a filtered page, and
 * the write actions appearing for someone who may not perform them.
 */

let canRecalculate = true

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: null,
    logo: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({
  useScopeLabel: () => 'Acme Ltd · FY 2026-27 · All branches',
}))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({
    can: () => true,
    loading: false,
    member: { uuid: 'user-a' },
    allowedWarehouses: null,
  }),
  useCan: () => canRecalculate,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({
    options: { warehouses: [{ warehouse_id: 4, warehouse_name: 'Central store', warehouse_code: 'CS', bo_id: 0 }], units: [] },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  invalidateFormOptions: vi.fn(),
}))

const batches = vi.fn(async () => ({ data: [], meta: { total: 0, limit: 50, offset: 0 } }))

vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    itemsByIds: async () => [
      { item_id: 12, item_name: 'Paracetamol 500mg', item_sku: 'PCM500', unit_id: 1, unit_symbol: 'Nos' },
    ],
    batches: (...args: unknown[]) => batches(...(args as [])),
  },
}))

const costLayers = vi.fn()
const snapshot = vi.fn()
const recalcJobs = vi.fn()
const revisions = vi.fn()

vi.mock('../../services/valuationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/valuationApi')>()
  return {
    ...actual,
    valuationApi: {
      ...actual.valuationApi,
      costLayers: (...args: unknown[]) => costLayers(...args),
      snapshot: (...args: unknown[]) => snapshot(...args),
      recalcJobs: (...args: unknown[]) => recalcJobs(...args),
      revisions: (...args: unknown[]) => revisions(...args),
    },
  }
})

const { CostLayersPage } = await import('./CostLayersPage')

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
    received_at: '2026-04-12',
    source_document_id: 700,
    source_line_id: 1,
    created_at: '2026-04-12 10:05:00',
    warehouse_name: 'Central store',
    source_document_no: 'GRN-2026-0412',
    source_document_type: 'goods_receipt',
    source_document_date: '2026-04-12',
    qty_consumed: 400,
    remaining_value: 750,
    consumptions: [
      {
        consumption_id: 1,
        layer_id: 1,
        document_id: 5,
        line_id: 1,
        movement_id: 1,
        qty: 400,
        unit_cost: 1.25,
        amount: 500,
        created_at: null,
        document_no: 'SO-2026-0412',
        document_type: 'delivery_note',
        document_date: '2026-04-12',
        document_status: 'POSTED',
      },
    ],
    ...over,
  }
}

const LAYERS = [
  layer(),
  layer({ layer_id: 2, source_document_no: 'GRN-2026-0408', qty_remaining: 0, qty_consumed: 1000, remaining_value: 0, received_at: '2026-04-08', consumptions: [] }),
]

function costLayersResponse(rows: CostLayerRow[]): CostLayersResponse {
  return {
    data: rows,
    meta: { total: rows.length, limit: 50, offset: 0 },
    item: { item_id: 12, item_name: 'Paracetamol 500mg', item_alias: null, item_sku: 'PCM500', unit_id: 1, valuation_method: 'FIFO' },
    summary: { open_qty: 600, open_value: 750, backorder_qty: 0 },
  }
}

const SNAPSHOT: ValuationSnapshotResponse = {
  data: [
    {
      item_id: 12,
      item_name: 'Paracetamol 500mg',
      item_alias: null,
      item_sku: 'PCM500',
      unit_id: 1,
      unit_symbol: 'Nos',
      valuation_method: 'FIFO',
      closing_qty: 600,
      unit_cost: 1.25,
      stock_value: 750,
      valuation_method_applied: 'FIFO',
    },
  ],
  meta: { total: 1, limit: 1, offset: 0 },
  summary: { as_of: '2026-09-19', method: 'AS_PER_MASTER', total_qty: 600, total_value: 750, item_count: 1 },
}

const JOB: RecalcJob = {
  job_id: 7,
  status: 'COMPLETED',
  from_date: '2026-04-01',
  dry_run: false,
  item_id: null,
  item_name: null,
  cogs_delta: -250,
  affected_line_count: 120,
  revised_line_count: 44,
  failure_reason: null,
  trigger_kind: 'backdated_receipt',
  created_at: '2026-04-14 11:32:00',
  finished_at: '2026-04-14 11:32:40',
} as RecalcJob

beforeEach(() => {
  canRecalculate = true
  window.localStorage.clear()
  costLayers.mockReset()
  snapshot.mockReset()
  recalcJobs.mockReset()
  revisions.mockReset()
  batches.mockClear()
  costLayers.mockImplementation(async () => costLayersResponse(LAYERS))
  snapshot.mockImplementation(async () => SNAPSHOT)
  recalcJobs.mockImplementation(async () => ({ data: [JOB], meta: { total: 1, limit: 5, offset: 0 } }))
  revisions.mockImplementation(async () => ({ data: [], meta: { total: 0, limit: 10, offset: 0 } }))
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CostLayersPage />
    </MemoryRouter>,
  )
}

/*
 * A receipt reference legitimately appears twice — once as the row's link and
 * once in the activity rail — so every assertion about a layer is scoped to the
 * grid. Waiting on the un-scoped text would pass on the rail alone and say
 * nothing about whether the table rendered at all.
 */
async function grid(): Promise<HTMLElement> {
  return (await screen.findByRole('table')) as HTMLElement
}

describe('CostLayersPage', () => {
  it('asks for an item before it asks the server for layers', async () => {
    renderAt('/valuation/cost-layers')
    expect(
      await screen.findByText('Select an item to inspect its valuation layers'),
    ).toBeTruthy()
    // `item_id` is required by the endpoint; firing without one would only ever
    // come back 422.
    expect(costLayers).not.toHaveBeenCalled()
  })

  it('shows the layers, the item snapshot and the distribution once an item is chosen', async () => {
    renderAt('/valuation/cost-layers?item_id=12')

    expect(within(await grid()).getByText('GRN-2026-0412')).toBeTruthy()
    expect(screen.getByText('Item snapshot')).toBeTruthy()
    expect(screen.getByText('Cost layer distribution')).toBeTruthy()
    expect(screen.getByText('Recent valuation activity')).toBeTruthy()

    /*
     * One part-consumed layer and one fully consumed one, both received at
     * 1,000 x 1.25. Measured on REMAINING value the closed half would be 0% and
     * the band would report the item as wholly part-consumed; measured at
     * receipt it reports the even split that actually happened.
     *
     * Read off the band's own accessible name, which is what a screen reader
     * gets — the figures and the label have to be the same thing.
     */
    expect(
      screen.getByRole('img', { name: 'Partially consumed 50 percent, Closed 50 percent' }),
    ).toBeTruthy()
  })

  it('reads the rail from every layer, not from the filtered page', async () => {
    renderAt('/valuation/cost-layers?item_id=12')
    await grid()
    await waitFor(() => expect(costLayers.mock.calls.length).toBeGreaterThan(1))

    const queries = costLayers.mock.calls.map((c) => c[0] as Record<string, unknown>)
    // The page query honours the open-only toggle; the rail's does not, or a
    // reader ticking a box would be told 100% of the item's value is open.
    expect(queries.some((q) => q.open_only === 1)).toBe(true)
    expect(queries.some((q) => q.open_only === 0 && q.limit === 500)).toBe(true)
  })

  it('turns the open-only filter OFF for the closed chip', async () => {
    /*
     * The server reads `open_only` as `qty_remaining > 0`. "Closed" with the
     * toggle left on asks for rows it has just been told to exclude.
     */
    renderAt('/valuation/cost-layers?item_id=12&quick=closed')
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('GRN-2026-0408')).toBeTruthy(),
    )

    const pageQueries = costLayers.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((q) => q.limit !== 500)
    expect(pageQueries.length).toBeGreaterThan(0)
    expect(pageQueries.every((q) => q.open_only === 0)).toBe(true)
  })

  it('asks the server for backorder layers when the negative chip is on', async () => {
    renderAt('/valuation/cost-layers?item_id=12&quick=negative')
    await screen.findByText('Valuation layers', { exact: false })

    const pageQueries = costLayers.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((q) => q.limit !== 500)
    expect(pageQueries.every((q) => q.layer_kind === 'backorder' && q.open_only === 0)).toBe(true)
  })

  it('opens the layer beside the grid with its consumption history', async () => {
    renderAt('/valuation/cost-layers?item_id=12')
    fireEvent.click(within(await grid()).getByText('12 Apr 2026'))

    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Layer overview')).toBeTruthy()
    expect(within(drawer).getByText('Consumed by')).toBeTruthy()
    expect(within(drawer).getByText('SO-2026-0412')).toBeTruthy()
    expect(within(drawer).getByText('Audit history')).toBeTruthy()
  })

  it('offers export and review to a reader, and withholds the write actions', async () => {
    canRecalculate = false
    renderAt('/valuation/cost-layers?item_id=12')
    await grid()

    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /review exceptions/i })).toBeTruthy()
    // Recalculation and revision both write valuation; neither is offered
    // without `valuation.recalculate`.
    expect(screen.queryByRole('button', { name: /^recalculate$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /create revision/i })).toBeNull()
  })

  it('names the exceptions it found on the review button', async () => {
    costLayers.mockImplementation(async () =>
      costLayersResponse([layer({ layer_id: 3, qty_remaining: -40, layer_kind: 'backorder' })]),
    )
    renderAt('/valuation/cost-layers?item_id=12')

    const button = await screen.findByRole('button', { name: /review exceptions/i })
    await waitFor(() => expect(within(button).getByText('1')).toBeTruthy())

    fireEvent.click(button)
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Negative stock layer')).toBeTruthy()
  })
})
