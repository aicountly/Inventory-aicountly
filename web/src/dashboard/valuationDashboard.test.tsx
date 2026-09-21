import { createElement } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Valuation dashboard, driven the way a person drives it.
 *
 * The pure models are covered in valuationHealth/valuationMethods/valuationModel
 * and the components in valuationRender. What is left — and what this file is
 * for — is the behaviour that only exists once they are wired together: the
 * ageing toggle actually changing the figures, the run-valuation confirmation
 * refusing to fire twice, an empty scope choosing an explanation over a page of
 * zeros, and a failed request reaching the reader in their own words.
 */

const permissions = { value: new Set<string>() }
const toastSuccess = vi.fn()
const enqueueRecalc = vi.fn()
const exportPdf = vi.fn()

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    companyName: 'Acme Traders',
    fy: { label: '2026-27' },
    branch: null,
    status: 'ready',
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    fyRange: { from: '2026-04-01', to: '2027-03-31' },
    boId: 0,
  }),
}))
vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({
    can: (key: string | readonly string[]) =>
      typeof key === 'string' ? permissions.value.has(key) : key.some((k) => permissions.value.has(k)),
    loading: false,
    member: null,
  }),
  useAccessOptional: () => null,
  useCan: (key: string) => permissions.value.has(key),
}))
vi.mock('../../ui/ToastContext', () => ({ useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), notify: vi.fn() }) }))
vi.mock('../ui/ToastContext', () => ({ useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), notify: vi.fn() }) }))
vi.mock('./dashboardExport', () => ({ exportDashboardPdf: exportPdf }))
vi.mock('../services/valuationApi', async (io) => ({
  ...(await io<typeof import('../services/valuationApi')>()),
  valuationApi: { enqueueRecalc },
}))

const ALL = [
  'dashboard.read',
  'reports.stock_summary.read',
  'reports.stock_ageing.read',
  'reports.warehouse_stock.read',
  'reports.movement_analysis.read',
  'reports.near_expiry.read',
  'reports.valuation.read',
  'valuation.recalculate',
]

/** Figures chosen so value and quantity give visibly different shares. */
const state = {
  stockValue: 4_872_320,
  stockItems: 24,
  fail: false as boolean | 'context',
}

vi.mock('./dashboardApi', () => ({
  WIDGET_ROWS: 6,
  fetchStockValue: async (asOf: string) => {
    if (state.fail === 'context') {
      const { ApiError } = await import('../services/api')
      throw new ApiError(400, 'context_required', 'Company context required (cmp_id, fy_id, bo_id)')
    }
    const closing = asOf === '2026-09-19' ? state.stockValue : 4_350_000
    return {
      summary: { items: state.stockItems, opening_qty: 0, in_qty: 0, out_qty: 0, closing_qty: state.stockItems === 0 ? 0 : 4820, closing_value: closing, from: null, to: asOf },
      topItems: state.stockItems === 0 ? [] : [{ item_id: 1, item_name: 'Widget', item_alias: null, item_sku: 'W1', unit_id: 1, unit_symbol: 'Nos', item_grp_id: null, stock_cat_id: null, opening_qty: 0, in_qty: 0, out_qty: 0, closing_qty: 10, unit_cost: 100, closing_value: 900_000, valuation_method_applied: 'FIFO' }],
      total: state.stockItems,
    }
  },
  fetchAgeing: async () => ({
    items: 24,
    total_qty: 4820,
    total_value: 4_872_320,
    // 0-30 holds 39% of the value but only 20% of the quantity.
    buckets: { '0_30': { qty: 964, value: 1_892_450 }, '31_60': { qty: 1240, value: 1_240_230 }, '61_90': { qty: 800, value: 812_600 }, '91_180': { qty: 1446, value: 510_320 }, '180_plus': { qty: 370, value: 416_720 } },
    bucket_labels: { '0_30': '0–30 days', '31_60': '31–60 days', '61_90': '61–90 days', '91_180': '91–180 days', '180_plus': '180+ days' },
    as_of: '2026-09-19',
  }),
  fetchWarehouseSplit: async () => ({
    rows: 2,
    closing_qty: 4820,
    closing_value: 4_872_320,
    by_warehouse: [
      { warehouse_id: 1, warehouse_name: 'Main Warehouse', closing_qty: 2800, closing_value: 2_840_120 },
      { warehouse_id: 2, warehouse_name: 'Secondary Warehouse', closing_qty: 2020, closing_value: 2_032_200 },
    ],
    to: '2026-09-19',
  }),
  fetchMovementMix: async () => ({
    from: '2026-04-01',
    to: '2026-09-19',
    thresholds: { fast_days: 30, slow_days: 60, dead_days: 180 },
    by_class: {
      fast: { items: state.stockItems === 0 ? 0 : 18, on_hand: 4200, period_out_qty: 2100 },
      slow: { items: state.stockItems === 0 ? 0 : 4, on_hand: 420, period_out_qty: 40 },
      non_moving: { items: 0, on_hand: 0, period_out_qty: 0 },
      dead: { items: 0, on_hand: 0, period_out_qty: 0 },
    },
  }),
  fetchExpiry: async () => ({
    summary: { as_of: '2026-09-19', days: 30, until: '2026-10-19', include_expired: true, batches: 0, items: 0, on_hand: 0, expired_batches: 0, expired_qty: 0 },
    rows: [],
    expiringSoon: 0,
    expired: 0,
  }),
  fetchMethodComparison: async () => [
    { method: 'AS_PER_MASTER', summary: { as_of: '2026-09-19', method: 'AS_PER_MASTER', total_qty: 4820, total_value: 4_872_320, item_count: 24 } },
    { method: 'FIFO', summary: { as_of: '2026-09-19', method: 'FIFO', total_qty: 4820, total_value: 4_872_320, item_count: 24 } },
    { method: 'LIFO', summary: null },
    { method: 'WAC', summary: { as_of: '2026-09-19', method: 'WAC', total_qty: 4820, total_value: 4_855_210, item_count: 24 } },
  ],
}))

vi.mock('./aggregatesApi', async (io) => ({
  ...(await io<typeof import('./aggregatesApi')>()),
  fetchValuationBridge: async () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0, timezone: 'Asia/Kolkata' },
    meta: { generated_at: '2026-09-19T10:24:00Z', status: 'ready' },
    data: {
      from: '2026-04-01', to: '2026-09-19', warehouse_id: null,
      opening: { value: 4_230_600, state: 'ready', definition: 'Opening at cost.' },
      closing: { value: 4_872_320, state: 'ready', definition: 'Closing at cost.' },
      components: {
        inward: { net: 2_840_120, gross_in: 2_840_120, gross_out: 0, movements: 212 },
        outward: { net: -1_810_450, gross_in: 0, gross_out: 1_810_450, movements: 184 },
        transfer: { net: 0, gross_in: 0, gross_out: 0, movements: 0 },
        adjustment: { net: -387_950, gross_in: 0, gross_out: 387_950, movements: 9 },
        other: { net: 0, gross_in: 0, gross_out: 0, movements: 0 },
      },
      reversals: { net: 0, movements: 0 },
      revaluations: { net: 0, movements: 0 },
      unvalued_movements: 0,
      definition: 'Opening + receipts − issues ± adjustments = closing.',
    },
  }),
}))

const setAsOf = vi.fn()
const setWarehouseId = vi.fn()

function scopeStub() {
  return {
    view: 'valuation', setView: () => {}, scopeKey: '1:3:0', scope: { cmp_id: 1, fy_id: 3, bo_id: 0 }, ready: true,
    asOf: '2026-09-19', setAsOf, period: { from: '2026-04-01', to: '2026-09-19' },
    warehouses: [
      { warehouse_id: 1, warehouse_name: 'Main Warehouse', warehouse_code: 'MW', warehouse_type: 'standard', is_default: 1, bo_id: 0, is_active: 1 },
      { warehouse_id: 2, warehouse_name: 'Secondary Warehouse', warehouse_code: 'SW', warehouse_type: 'standard', is_default: 0, bo_id: 0, is_active: 1 },
    ],
    warehousesLoading: false, selectedWarehouseId: null, effectiveWarehouseId: null, setWarehouseId,
    warehouseDropped: false, itemId: null, setItemId: () => {}, preserved: {},
  }
}

async function mount() {
  const { default: Page } = await import('./pages/ValuationDashboard')
  const { viewById } = await import('./views')
  return render(
    createElement(MemoryRouter, null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createElement(Page as any, { scope: scopeStub() as any, view: viewById('valuation') })),
  )
}

beforeEach(() => {
  permissions.value = new Set(ALL)
  state.stockValue = 4_872_320
  state.stockItems = 24
  state.fail = false
  toastSuccess.mockReset()
  exportPdf.mockReset()
  enqueueRecalc.mockReset()
  enqueueRecalc.mockResolvedValue({ job_id: 42, status: 'COMPLETED', dry_run: true, revised_line_count: 7, cogs_delta: 1234 })
  setAsOf.mockReset()
  setWarehouseId.mockReset()
  try {
    window.sessionStorage.clear()
  } catch {
    /* ignored */
  }
})

describe('the ageing toggle', () => {
  it('re-splits the buckets by quantity and relabels the centre', async () => {
    await mount()
    // The donut draws each bucket twice: once in the legend and once in the
    // sr-only table that is the chart's accessible equivalent.
    await screen.findAllByText('0–30 days')

    // By value the newest bucket is the largest share.
    expect(screen.getAllByText('Total value').length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹18.92 L').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Quantity' }))

    await waitFor(() => expect(screen.getAllByText('Total quantity').length).toBeGreaterThan(0))
    // The same bucket, now measured in units — and the value figure is gone
    // from the headline rather than relabelled as a quantity.
    expect(screen.getAllByText('964 units').length).toBeGreaterThan(0)
    expect(screen.getByText('Quantity-wise ageing distribution')).toBeTruthy()
  })

  it('remembers the choice for the session', async () => {
    const view = await mount()
    await screen.findAllByText('0–30 days')
    fireEvent.click(screen.getByRole('tab', { name: 'Quantity' }))
    await waitFor(() => expect(screen.getAllByText('Total quantity').length).toBeGreaterThan(0))
    view.unmount()

    await mount()
    await waitFor(() => expect(screen.getAllByText('Total quantity').length).toBeGreaterThan(0))
  })
})

describe('run valuation', () => {
  it('is not offered without the recalculate permission', async () => {
    permissions.value = new Set(ALL.filter((p) => p !== 'valuation.recalculate'))
    await mount()
    expect(screen.queryByRole('button', { name: /run valuation/i })).toBeNull()
  })

  it('confirms before it runs, and defaults to a dry run', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))

    const dialog = await screen.findByRole('dialog')
    // Nothing has been asked of the server just by opening the dialog.
    expect(enqueueRecalc).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('tab', { name: 'Dry run' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).getByText(/writes nothing/i)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /run dry run/i }))
    await waitFor(() => expect(enqueueRecalc).toHaveBeenCalledTimes(1))
    expect(enqueueRecalc).toHaveBeenCalledWith({ from_date: '2026-04-01', dry_run: true, run_now: true })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('warns about Books before a live run, and sends dry_run false', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Live' }))
    expect(within(dialog).getByText(/publishes the resulting/i)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /run live recalculation/i }))
    await waitFor(() => expect(enqueueRecalc).toHaveBeenCalledWith({ from_date: '2026-04-01', dry_run: false, run_now: true }))
  })

  it('cannot be submitted twice by a double click', async () => {
    // The second submission would be a second live re-costing, and a live run
    // publishes COGS revisions to Books.
    let release: (v: unknown) => void = () => {}
    enqueueRecalc.mockImplementation(() => new Promise((r) => { release = r }))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /run dry run/i })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(enqueueRecalc).toHaveBeenCalledTimes(1)

    release({ job_id: 1, status: 'COMPLETED', dry_run: true, revised_line_count: 0, cogs_delta: 0 })
  })

  it('reports a failure in the dialog rather than losing it', async () => {
    const { ApiError } = await import('../services/api')
    enqueueRecalc.mockRejectedValue(new ApiError(409, 'conflict', 'A recalculation is already running for this company.'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /run dry run/i }))

    await waitFor(() => expect(within(dialog).getByText(/already running/i)).toBeTruthy())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('an empty scope', () => {
  it('explains itself instead of drawing charts full of zeros', async () => {
    state.stockItems = 0
    state.stockValue = 0
    await mount()

    await screen.findByText(/No stock value for this date and warehouse/i)
    expect(screen.queryByText('Inventory value bridge')).toBeNull()
    expect(screen.queryByText('Ageing of remaining stock')).toBeNull()
    // And it offers the ways out, as links into screens that exist.
    expect(screen.getByRole('link', { name: 'View stock balances' }).getAttribute('href')).toBe('/registers/stock-balances')
    expect(screen.getByRole('link', { name: 'Add opening stock' }).getAttribute('href')).toBe('/items')
  })

  it('still draws the dashboard when the value is nil but items have moved', async () => {
    // Closing value of zero with stock that has moved is an anomaly, not an
    // empty warehouse; hiding the dashboard would hide it.
    state.stockItems = 0
    state.stockValue = 0
    const mod = await import('./dashboardApi')
    vi.spyOn(mod, 'fetchMovementMix').mockResolvedValue({
      from: '2026-04-01', to: '2026-09-19',
      thresholds: { fast_days: 30, slow_days: 60, dead_days: 180 },
      by_class: { fast: { items: 0, on_hand: 0, period_out_qty: 0 }, slow: { items: 1, on_hand: -1, period_out_qty: 0 }, non_moving: { items: 0, on_hand: 0, period_out_qty: 0 }, dead: { items: 0, on_hand: 0, period_out_qty: 0 } },
    })
    await mount()
    await screen.findByText('Movement classification')
    expect(screen.queryByText(/No stock value for this date and warehouse/i)).toBeNull()
  })
})

describe('a failed request', () => {
  it('never shows the reader the server’s own words', async () => {
    state.fail = 'context'
    await mount()

    await waitFor(() => expect(screen.getAllByText(/Select a company and financial year/i).length).toBeGreaterThan(0))
    expect(document.body.textContent).not.toContain('cmp_id')
    expect(document.body.textContent).not.toContain('fy_id')
    expect(document.body.textContent).not.toContain('bo_id')
  })

  it('keeps every other card working when one source fails', async () => {
    state.fail = 'context'
    await mount()
    // The bridge, ageing and warehouse cards do not depend on the stock
    // summary and must still render their own figures.
    // Each card is fed by its own request, so awaiting one of them says nothing
    // about whether the others have rendered. Asserting on the bridge and then
    // reading the warehouse and ageing cards synchronously passes on a machine
    // where all three settle in the same tick and fails on a loaded CI runner
    // where they do not — which is how this test went red on main while passing
    // locally five runs out of five. Each assertion now waits for its own card.
    await screen.findByText('Inventory value bridge')
    // Also an <option> in the warehouse filter, hence the plural query.
    expect((await screen.findAllByText('Main Warehouse')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Fast moving')).toBeTruthy()
  })
})

describe('filters', () => {
  it('hands a new date and warehouse back to the URL-owned scope', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('Figures as at date'), { target: { value: '2026-08-31' } })
    expect(setAsOf).toHaveBeenCalledWith('2026-08-31')

    fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: '2' } })
    expect(setWarehouseId).toHaveBeenCalledWith(2)
  })
})

describe('the method comparison', () => {
  it('shows a method that did not answer as unavailable, beside the ones that did', async () => {
    await mount()
    await screen.findByText('Valuation method comparison')
    await waitFor(() => expect(screen.getByText('Weighted average')).toBeTruthy())
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.getByText('Current basis')).toBeTruthy()
    expect(screen.getByText(/could not be valued at this date/i)).toBeTruthy()
  })
})

describe('the PDF export', () => {
  it('heads the ageing columns with the basis the reader is on', async () => {
    await mount()
    await screen.findAllByText('0–30 days')

    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))
    await waitFor(() => expect(exportPdf).toHaveBeenCalled())
    const byValue = exportPdf.mock.calls[0][0]
    const ageingTable = byValue.tables.find((t: { title: string }) => t.title.startsWith('Ageing'))
    expect(ageingTable.columns).toEqual(['Age bucket', 'Value at cost', 'Share', 'Quantity'])

    // Switch the toggle and the sheet has to follow it: the rows are built from
    // the chosen basis, so a fixed "Value at cost" heading would print unit
    // counts under it.
    fireEvent.click(screen.getByRole('tab', { name: 'Quantity' }))
    await waitFor(() => expect(screen.getAllByText('Total quantity').length).toBeGreaterThan(0))
    exportPdf.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))
    await waitFor(() => expect(exportPdf).toHaveBeenCalled())

    const byQty = exportPdf.mock.calls[0][0]
    const qtyTable = byQty.tables.find((t: { title: string }) => t.title.startsWith('Ageing'))
    expect(qtyTable.columns).toEqual(['Age bucket', 'Quantity', 'Share', 'Value at cost'])
    expect(qtyTable.title).toContain('quantity')
  })

  it('carries the scope and says net realizable value is not reported', async () => {
    await mount()
    await screen.findAllByText('0–30 days')
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))
    await waitFor(() => expect(exportPdf).toHaveBeenCalled())

    const options = exportPdf.mock.calls[0][0]
    expect(options).toMatchObject({
      companyName: 'Acme Traders',
      fyLabel: '2026-27',
      branchLabel: 'All branches',
      warehouseLabel: 'All warehouses',
      asOf: '2026-09-19',
    })
    expect(options.notes.join(' ')).toContain('Net realizable value is not reported')
  })
})

describe('the run-valuation date', () => {
  it('will not submit a date outside the open year', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /run dry run/i })
    expect(confirm.hasAttribute('disabled')).toBe(false)

    // `min`/`max` on a date input outside a form are advisory; a typed or
    // pasted date has to be rejected here, because a live run re-costs the
    // year and publishes to Books.
    fireEvent.change(within(dialog).getByLabelText('Recalculate from date'), { target: { value: '2025-01-01' } })
    expect(within(dialog).getByText(/Pick a date between/i)).toBeTruthy()
    expect(confirm.hasAttribute('disabled')).toBe(true)

    fireEvent.click(confirm)
    expect(enqueueRecalc).not.toHaveBeenCalled()
  })

  it('will not submit a date after the figures on the page', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Recalculate from date'), { target: { value: '2026-12-31' } })
    expect(within(dialog).getByRole('button', { name: /run dry run/i }).hasAttribute('disabled')).toBe(true)
  })

  it('will not submit an emptied date', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /run valuation/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Recalculate from date'), { target: { value: '' } })
    expect(within(dialog).getByRole('button', { name: /run dry run/i }).hasAttribute('disabled')).toBe(true)
  })
})
