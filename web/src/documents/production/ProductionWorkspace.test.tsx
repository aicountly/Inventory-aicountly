import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { draftFromDocument } from '../formModel'
import { specForCode } from '../registry'
import { ProductionWorkspace } from './ProductionWorkspace'

/*
 * The production cockpit, end to end against mocked APIs.
 *
 * What these tests hold is the contract the screen makes with the rest of Inventory: the BOM is
 * exploded by the server, shortages are read from live balances rather than assumed, the payload
 * that leaves the screen is the one the generic document editor would have sent, and a run the
 * server would refuse is stopped here with the reason named instead of being sent and rejected.
 */

const SPEC = specForCode('PRODUCTION')!

const BOM = {
  bom_id: 7,
  bom_name: 'Office chair - standard',
  finished_item_id: 99,
  finished_item_name: 'Office chair',
  finished_item_sku: 'CH-001',
  yield_qty: 1,
  yield_unit_id: 5,
  yield_unit_symbol: 'Nos',
  is_active: 1,
  lines: [
    { bom_line_id: 1, item_id: 1, qty: 4, unit_id: 5, line_kind: 'component', item_name: 'Screw M6', item_sku: 'SC-6', unit_symbol: 'Nos' },
    { bom_line_id: 2, item_id: 2, qty: 1.25, unit_id: 5, line_kind: 'component', item_name: 'Wooden panel', item_sku: 'WP-1', unit_symbol: 'Nos' },
  ],
}

const explodeBom = vi.fn(async (_id: number, body: { production_qty: number; warehouse_id?: number | null }) => ({
  document_type: 'PRODUCTION',
  document_date: '',
  lines: [
    { item_id: 1, unit_id: 5, warehouse_id: body.warehouse_id ?? 1, qty: 4 * body.production_qty, rate: 0, amount: 0, direction: 'out', metadata: { bom_line_id: 1, line_kind: 'component' } },
    { item_id: 2, unit_id: 5, warehouse_id: body.warehouse_id ?? 1, qty: 1.25 * body.production_qty, rate: 0, amount: 0, direction: 'out', metadata: { bom_line_id: 2, line_kind: 'component' } },
    { item_id: 99, unit_id: 5, warehouse_id: body.warehouse_id ?? 1, qty: body.production_qty, rate: 0, amount: 0, direction: 'in', metadata: { line_kind: 'finished', bom_id: 7 } },
  ],
}))

const item = (id: number, name: string) => ({
  item_id: id,
  item_name: name,
  item_alias: null,
  print_name: null,
  item_sku: null,
  item_upc: null,
  hsn_sac: null,
  mrp: null,
  unit_id: 5,
  unit_symbol: 'Nos',
  track_batch: 0,
  track_serial: 0,
  valuation_method: null,
  default_warehouse_id: null,
  units: [{ unit_id: 5, is_default: 1, conversion_factor: 1, uom_role: null, unit_symbol: 'Nos', unit_name: 'Numbers' }],
})

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, profile: { profile_name: 'Owner' } }),
  useCan: () => true,
}))
vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({ scope: { cmp_id: 1, fy_id: 1, bo_id: 0 }, companyName: 'Acme', fy: null, branch: null }),
}))
vi.mock('../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme · FY 2026-27 · All branches' }))
vi.mock('../useReferenceData', () => ({
  useReferenceData: () => ({
    warehouses: [
      { warehouse_id: 1, warehouse_name: 'Main', warehouse_code: null, warehouse_type: 'store', is_default: 1, bo_id: 0 },
      { warehouse_id: 2, warehouse_name: 'Overflow', warehouse_code: null, warehouse_type: 'store', is_default: 0, bo_id: 0 },
    ],
    units: [],
    defaultWarehouseId: 1,
    warehouseName: (id: number | null) => (id === 1 ? 'Main' : id === 2 ? 'Overflow' : ''),
    unitSymbol: () => 'Nos',
    loading: false,
    error: null,
    reload: () => {},
  }),
}))
vi.mock('../../services/lookupApi', () => ({
  lookupApi: {
    boms: async () => ({ data: [{ bom_id: 7, bom_name: 'Office chair - standard', finished_item_id: 99, finished_item_name: 'Office chair', finished_item_sku: 'CH-001', yield_qty: 1, yield_unit_id: 5, yield_unit_symbol: 'Nos', is_active: 1, line_count: 2 }], total: 1, limit: 100, offset: 0 }),
    bom: async () => BOM,
    explodeBom: (...args: unknown[]) => (explodeBom as unknown as (...a: unknown[]) => unknown)(...args),
    itemsByIds: async () => [item(1, 'Screw M6'), item(2, 'Wooden panel'), item(99, 'Office chair')],
    searchItems: async () => [],
    batches: async () => ({ data: [], total: 0, limit: 200, offset: 0 }),
    serials: async () => ({ data: [], total: 0, limit: 500, offset: 0 }),
  },
}))
vi.mock('../../services/stockApi', () => ({
  availabilityApi: {
    forItems: async () => [
      { item_id: 1, warehouse_id: 1, available: 1250 },
      { item_id: 2, warehouse_id: 1, available: 1 },
      { item_id: 2, warehouse_id: 2, available: 40 },
    ],
  },
}))
vi.mock('../../services/valuationApi', () => ({
  valuationApi: {
    unitCosts: async () => [
      { item_id: 1, unit_cost: 1.5, valuation_method_applied: 'FIFO' },
      { item_id: 2, unit_cost: 850, valuation_method_applied: 'FIFO' },
    ],
  },
}))

const negativeStockPolicy = { value: 'block' }
vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    get: async () => ({ cmp_id: 1, base_currency_code: 'INR', negative_stock_policy: negativeStockPolicy.value, fefo_enabled: 0, default_valuation_method: 'FIFO', valuation_scope: 'company', approval_required: 0, cogs_revision_mode: 'inline', settings: {} }),
  },
}))

const create = vi.fn(async (_payload: unknown) => ({ document_id: 55, document_no: 'PRD-000124', status: 'DRAFT', lines: [] }))
const post = vi.fn(async (_id: number, _options: unknown) => ({ document_id: 55, document_no: 'PRD-000124', status: 'POSTED', lines: [], warnings: [] }))
vi.mock('../../services/documentsApi', () => ({
  documentsApi: {
    list: async () => ({ data: [], total: 0, limit: 8, offset: 0 }),
    get: async () => ({ document_id: 1, metadata: {} }),
    create: (...args: unknown[]) => (create as unknown as (...a: unknown[]) => unknown)(...args),
    post: (...args: unknown[]) => (post as unknown as (...a: unknown[]) => unknown)(...args),
    update: async () => ({ document_id: 55, lines: [] }),
    auditTrail: async () => ({ data: [], total: 0, limit: 200, offset: 0 }),
  },
  newIdempotencyKey: () => 'test-key',
}))

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <ProductionWorkspace spec={SPEC} onSaved={vi.fn()} onNew={vi.fn()} />
    </MemoryRouter>,
  )
}

/** Choose the only BOM on offer and wait for the server explosion to land. */
async function pickBom() {
  const select = await screen.findByRole('combobox', { name: /Bill of materials/ })
  fireEvent.change(select, { target: { value: '7' } })
  await waitFor(() => expect(screen.getByText('Wooden panel')).toBeTruthy(), { timeout: 5000 })
}

beforeEach(() => {
  explodeBom.mockClear()
  create.mockClear()
  post.mockClear()
  negativeStockPolicy.value = 'block'
})

describe('before anything is chosen', () => {
  it('is a finished screen, not a blank one', async () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'New production' })).toBeTruthy()
    expect(screen.getByText('Consume components from a bill of materials and receive finished goods.')).toBeTruthy()
    expect(screen.getByText('Waiting for BOM')).toBeTruthy()
    expect(screen.getByText(/Select a finished item and a bill of materials/)).toBeTruthy()
    expect(await screen.findByText('No BOM selected')).toBeTruthy()
  })

  it('says what it cannot know yet instead of showing a zero', () => {
    renderWorkspace()
    // The KPI caption and the table's empty state both say it — neither shows a fabricated zero.
    expect(screen.getAllByText('No components yet').length).toBeGreaterThan(0)
    expect(screen.getByText('Enter a run quantity')).toBeTruthy()
  })
})

describe('once a bill of materials is chosen', () => {
  it('explodes it on the server and lists what the run consumes', async () => {
    renderWorkspace()
    await pickBom()
    expect(explodeBom).toHaveBeenCalled()
    expect(explodeBom.mock.calls[0][1]).toMatchObject({ production_qty: 1, warehouse_id: 1 })
    expect(screen.getByText('Screw M6')).toBeTruthy()
    // The finished line is a movement, not a component: the consumption table holds two rows.
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('reads availability per warehouse and names the shortage', async () => {
    renderWorkspace()
    await pickBom()
    await waitFor(() => expect(screen.getByText('Insufficient')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('Short by 0.25')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Available in 1 other warehouse/ })).toBeTruthy()
  })

  it('costs the components from the valuation engine, and never calls the difference profit', async () => {
    renderWorkspace()
    await pickBom()
    // 4 × 1.50 + 1.25 × 850 = 1,068.50
    await waitFor(() => expect(screen.getAllByText(/1,068\.50/).length).toBeGreaterThan(0), { timeout: 5000 })
    expect(screen.getByText('Expected value add')).toBeTruthy()
    expect(screen.queryByText(/profit/i)).toBeNull()
  })
})

describe('posting', () => {
  it('stops a run the server would refuse, and does not send it', async () => {
    renderWorkspace()
    await pickBom()
    await waitFor(() => expect(screen.getByText('Insufficient')).toBeTruthy(), { timeout: 5000 })

    fireEvent.click(screen.getByRole('button', { name: 'Save & post' }))

    expect(await screen.findByText('Production cannot be posted')).toBeTruthy()
    expect(screen.getByText(/Wooden panel is short by 0.25 in Main/)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('treats the same shortage as a warning where the company allows negative stock', async () => {
    negativeStockPolicy.value = 'warn'
    renderWorkspace()
    await pickBom()
    await waitFor(() => expect(screen.getByText('Insufficient')).toBeTruthy(), { timeout: 5000 })

    fireEvent.click(screen.getByRole('button', { name: 'Save & post' }))
    await waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 })
    expect(post).toHaveBeenCalledWith(55, { negativeOverride: false })
  })

  it('saves a draft through the shared document payload', async () => {
    renderWorkspace()
    await pickBom()
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 })
    const payload = create.mock.calls[0][0] as {
      document_type: string
      lines: { item_id: number; direction?: string; qty: number }[]
      metadata: Record<string, unknown>
    }
    expect(payload.document_type).toBe('PRODUCTION')
    expect(payload.lines.map((l) => [l.item_id, l.direction, l.qty])).toEqual([
      [1, 'out', 4],
      [2, 'out', 1.25],
      [99, 'in', 1],
    ])
    expect(payload.metadata).toMatchObject({ bom_id: 7, production_qty: 1, warehouse_id: 1 })
  })

  it('cannot be submitted twice by a double click', async () => {
    renderWorkspace()
    await pickBom()
    const button = screen.getByRole('button', { name: 'Save draft' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(create).toHaveBeenCalled(), { timeout: 5000 })
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('reopening a saved draft', () => {
  /** A draft whose screw line was adjusted by hand from 16 to 20 before it was saved. */
  function storedDraft() {
    const line = (item_id: number, name: string, qty: number, direction: 'in' | 'out', kind: string) => ({
      line_id: item_id,
      document_id: 55,
      item_id,
      item_name: name,
      item_label: name,
      item_sku: null,
      warehouse_id: 1,
      dest_warehouse_id: null,
      location_id: null,
      batch_id: null,
      unit_id: 5,
      unit_symbol: 'Nos',
      direction,
      qty,
      conversion_factor: 1,
      base_qty: qty,
      source_transaction_rate: null,
      source_transaction_amount: null,
      valuation_rate: null,
      valuation_amount: null,
      valuation_method_applied: null,
      landed_cost_amount: null,
      book_qty: null,
      physical_qty: null,
      sort_order: item_id,
      metadata: { line_kind: kind },
      serials: [],
    })
    return {
      document_id: 55,
      document_type: 'PRODUCTION',
      document_no: 'PRD-000124',
      document_date: '2026-09-18',
      status: 'DRAFT',
      version: 1,
      currency_code: 'INR',
      metadata: { bom_id: 7, production_qty: 4, finished_rate: 0, warehouse_id: 1 },
      narration: null,
      lines: [line(1, 'Screw M6', 20, 'out', 'component'), line(2, 'Wooden panel', 5, 'out', 'component'), line(99, 'Office chair', 4, 'in', 'finished')],
    }
  }

  it('never re-scales the stored lines behind the user', async () => {
    const doc = storedDraft() as unknown as Parameters<typeof draftFromDocument>[0]
    const initial = draftFromDocument(doc, SPEC)
    render(
      <MemoryRouter>
        <ProductionWorkspace spec={SPEC} documentId={55} initial={initial} document={doc as never} onSaved={vi.fn()} onNew={vi.fn()} />
      </MemoryRouter>,
    )
    // The hand-typed 20 is still there long after the debounce that would have re-exploded.
    await waitFor(() => expect(screen.getByText('Screw M6')).toBeTruthy(), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(explodeBom).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Required quantity for Screw M6') as HTMLInputElement).value).toBe('20')
  })

  it('keeps the warehouse the run was saved with', async () => {
    const doc = storedDraft() as unknown as Parameters<typeof draftFromDocument>[0]
    render(
      <MemoryRouter>
        <ProductionWorkspace spec={SPEC} documentId={55} initial={draftFromDocument(doc, SPEC)} document={doc as never} onSaved={vi.fn()} onNew={vi.fn()} />
      </MemoryRouter>,
    )
    const warehouse = (await screen.findByLabelText(/Finished warehouse/)) as HTMLSelectElement
    expect(warehouse.value).toBe('1')
  })

  it('re-explodes once the run quantity is changed on purpose', async () => {
    const doc = storedDraft() as unknown as Parameters<typeof draftFromDocument>[0]
    render(
      <MemoryRouter>
        <ProductionWorkspace spec={SPEC} documentId={55} initial={draftFromDocument(doc, SPEC)} document={doc as never} onSaved={vi.fn()} onNew={vi.fn()} />
      </MemoryRouter>,
    )
    const qty = await screen.findByLabelText(/Production quantity/)
    fireEvent.change(qty, { target: { value: '8' } })
    await waitFor(() => expect(explodeBom).toHaveBeenCalled(), { timeout: 5000 })
    expect(explodeBom.mock.calls[0][1]).toMatchObject({ production_qty: 8 })
  })
})
