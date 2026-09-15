import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Bom } from '../../services/masters'

/**
 * A bill of materials opened in Inventory can be printed.
 *
 * The Books BOM print is gone; this is where it went. What these tests hold is
 * that it is a REAL print of a REAL bill — the company's letterhead, the bill's
 * own lines, the effective quantities a production run will move — and that it
 * goes through the same tabular sheet builder as every register and master
 * list, rather than a third print path of its own.
 */

interface SheetPayload {
  title: string
  companyName?: string
  gstin?: string
  addressLines?: string[]
  scopeLabel?: string
  metaLines?: string[]
  summaryCards?: { label: string; value: string; tone?: string }[]
  footerNotes?: string[]
  orientation?: string
  columns: { key: string; label: string }[]
  rows: Record<string, { text: string; value: unknown }>[]
  totalsRow: unknown
  filenameBase: string
}

const exportTabularPdf = vi.fn(async (_p: SheetPayload) => {})
const printTabular = vi.fn((_p: SheetPayload) => true)
const exportTabularExcel = vi.fn(async (_p: SheetPayload) => {})

vi.mock('../../export/documentExport', () => ({
  exportTabularExcel: (p: SheetPayload) => exportTabularExcel(p),
  exportTabularPdf: (p: SheetPayload) => exportTabularPdf(p),
  printTabular: (p: SheetPayload) => printTabular(p),
}))

vi.mock('../../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: ['12 Industrial Estate', 'Pune 411 019'],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
  }),
}))

vi.mock('../../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd · FY 2026-27 · Head office' }))

vi.mock('../../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: { units: [{ unit_id: 1, unit_name: 'Numbers', unit_symbol: 'Nos' }] }, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

vi.mock('../../services/items', () => ({ itemsApi: { search: async () => [] } }))

const BOM: Bom = {
  bom_id: 12,
  bom_name: 'Chair BOM',
  finished_item_id: 10,
  yield_qty: 2,
  yield_unit_id: 1,
  is_active: 1,
  finished_item_name: 'Chair',
  finished_item_sku: 'CH-1',
  finished_item_unit_id: 1,
  yield_unit_symbol: 'Nos',
  line_count: 2,
  updated_at: '2026-09-14 11:30:00',
  lines: [
    { bom_line_id: 1, item_id: 2, qty: 4, unit_id: 7, line_kind: 'component', scrap_percent: 0, sort_order: 0, item_name: 'Leg', item_sku: 'LG-1', unit_symbol: 'Nos' },
    { bom_line_id: 2, item_id: 3, qty: 1.5, unit_id: 8, line_kind: 'component', scrap_percent: 10, sort_order: 1, item_name: 'Seat board', item_sku: null, unit_symbol: 'Kg' },
  ],
}

const get = vi.fn(async (_id: number) => BOM)

vi.mock('../../services/masters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/masters')>()
  return { ...actual, bomApi: { ...actual.bomApi, get: (id: number) => get(id) } }
})

const { BomFormPage } = await import('./BomFormPage')

function renderBom(url = '/masters/bill-of-materials/12') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/masters/bill-of-materials/new" element={<BomFormPage />} />
        <Route path="/masters/bill-of-materials/:id" element={<BomFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.getByDisplayValue('Chair BOM')).toBeTruthy())
}

beforeEach(() => {
  printTabular.mockClear()
  exportTabularPdf.mockClear()
  exportTabularExcel.mockClear()
  get.mockClear()
})

describe('printing a bill of materials from Inventory', () => {
  it('offers print and the export menu once the bill has loaded', async () => {
    renderBom()
    await waitForLoaded()
    expect(screen.getByRole('button', { name: /print/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
    expect(labels.some((l) => l.includes('PDF'))).toBe(true)
  })

  it('prints a letterheaded sheet of the bill, not the browser’s picture of the form', async () => {
    renderBom()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.companyName).toBe('Acme Ltd')
    expect(sheet.gstin).toBe('27AAAAA0000A1Z5')
    expect(sheet.addressLines).toEqual(['12 Industrial Estate', 'Pune 411 019'])
    expect(sheet.title).toBe('Chair BOM')
    expect(sheet.metaLines).toContain('Finished item: Chair (CH-1)')
    expect(sheet.orientation).toBe('portrait')
    expect(sheet.filenameBase).toContain('bill-of-materials-12')
  })

  it('puts every line of the bill on the sheet, with the effective quantity', async () => {
    renderBom()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())

    const sheet = printTabular.mock.calls[0][0]
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.rows.map((r) => r.item.text)).toEqual(['Leg', 'Seat board'])
    // 1.5 with 10% scrap is what one run consumes. A sheet that printed 1.5
    // would understate every purchase planned from it.
    expect(sheet.rows[1].effective_qty.text).toBe('1.65')
    expect(sheet.totalsRow).toBeNull()
  })

  it('downloads the same sheet as a PDF', async () => {
    renderBom()
    await waitForLoaded()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /PDF/ }))
    await waitFor(() => expect(exportTabularPdf).toHaveBeenCalledOnce())
    expect(exportTabularPdf.mock.calls[0][0].title).toBe('Chair BOM')
  })

  it('binds Ctrl+P to the sheet rather than to the app’s own DOM', async () => {
    renderBom()
    await waitForLoaded()
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    await waitFor(() => expect(printTabular).toHaveBeenCalledOnce())
  })

  it('offers nothing to print on a bill that has not been saved yet', async () => {
    renderBom('/masters/bill-of-materials/new')
    await waitFor(() => expect(screen.getByText('New bill of materials')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /print/i })).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
})
