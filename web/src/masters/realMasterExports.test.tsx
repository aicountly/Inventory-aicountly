import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CrudApi } from '../services/masters'
import type { MasterConfig } from './types'

/**
 * The REAL master configs, through the real `MasterPage`, into the real sheet.
 *
 * `MasterPage.export.test.tsx` proves the mounting works, but it does so over a
 * hand-written four-column config whose every column resolves from a top-level
 * scalar — the one shape that cannot fail. The defect this file exists to catch
 * shipped through that green run: `ItemsListPage` declared a `tracking` column
 * (computed from three flags — no such field) and an `on_hand` column (the
 * figure is nested at `stock.on_hand`), neither with an `exportValue`. The
 * screen was right and every CSV, spreadsheet and letterheaded print sheet
 * carried two silently empty columns, one of them a stock quantity.
 *
 * The type system cannot help: `MasterColumn.key` is `string`, not `keyof T`,
 * so a key naming no field compiles. So the guard is this: render each real
 * config over a fully-populated row and require every exported cell to carry
 * something. A blank under a header that promises a figure is a wrong number on
 * a document that carries the company's GSTIN.
 */

interface SheetPayload {
  title: string
  rows: Record<string, { text: string; value: unknown }>[]
  columns: { key: string; label: string; format?: string; align?: string }[]
}

const exportTabularPdf = vi.fn(async (_p: SheetPayload) => {})

vi.mock('../export/documentExport', () => ({
  exportTabularExcel: vi.fn(async () => {}),
  exportTabularPdf: (p: SheetPayload) => exportTabularPdf(p),
  printTabular: vi.fn(() => true),
}))

vi.mock('../company/CompanyContext', () => ({
  useCompany: () => ({
    scope: { cmp_id: 1, fy_id: 3, bo_id: 0 },
    companyName: 'Acme Ltd',
    addressLines: [],
    gstin: '27AAAAA0000A1Z5',
    logo: null,
  }),
}))

vi.mock('../company/useScopeLabel', () => ({ useScopeLabel: () => 'Acme Ltd · FY 2026-27' }))

vi.mock('../access/AccessContext', () => ({
  useAccess: () => ({ can: () => true, loading: false, member: { uuid: 'user-a' } }),
  useCan: () => true,
}))

vi.mock('../ui/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('../hooks/useFormOptions', () => ({
  useFormOptions: () => ({ options: null, loading: false, error: null, reload: vi.fn() }),
  invalidateFormOptions: vi.fn(),
}))

const { MasterPage } = await import('./MasterPage')
const { itemsConfig } = await import('../pages/items/ItemsListPage')
const { warehousesConfig, batchesConfig } = await import('./configs')
const { serialsConfig } = await import('../pages/masters/SerialsPage')

/** The config as declared, with its API swapped for one row of known data. */
function withRow<T>(config: MasterConfig<T>, row: T): MasterConfig<T> {
  const api: CrudApi<T> = {
    list: async () => ({ data: [row], meta: { total: 1, limit: 50, offset: 0 } }),
    get: async () => row,
    create: async () => row,
    update: async () => row,
    remove: async () => {},
  }
  return { ...config, api, needsFormOptions: false }
}

async function sheetFor<T>(config: MasterConfig<T>, row: T, firstCellText: string) {
  render(
    <MemoryRouter initialEntries={[`/masters/${config.slug}`]}>
      <MasterPage config={withRow(config, row)} />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText(firstCellText)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /export/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /PDF/ }))
  await waitFor(() => expect(exportTabularPdf).toHaveBeenCalledOnce())
  return exportTabularPdf.mock.calls[0][0]
}

const AUDIT = { created_at: '2026-01-02 08:00:00', updated_at: '2026-09-14 11:02:30', created_by: 'u1', updated_by: 'u1' }

const ITEM = {
  item_id: 7214,
  item_name: 'Steel Rod 12mm',
  item_alias: 'SR12',
  print_name: 'Steel Rod 12mm',
  item_type: 'stock',
  item_sku: 'SR-12',
  item_upc: '8901234567890',
  hsn_sac: '7214',
  mrp: 1234.5,
  unit_id: 1,
  stock_cat_id: 2,
  item_grp_id: 3,
  brand_id: 4,
  valuation_method: 'fifo',
  track_batch: 1,
  track_serial: 0,
  track_expiry: 1,
  is_active: 1,
  unit_symbol: 'Nos',
  unit_name: 'Numbers',
  grp_name: 'Raw material',
  cat_name: 'Metals',
  brand_name: 'Tata',
  stock: { on_hand: 412.5, reserved: 0, available: 412.5 },
  ...AUDIT,
}

const WAREHOUSE = {
  warehouse_id: 3,
  warehouse_name: 'Main store',
  warehouse_code: 'MS',
  warehouse_group_id: 1,
  parent_warehouse_id: null,
  warehouse_type: 'bonded',
  is_default: 1,
  allow_negative: 0,
  address: null,
  contact: null,
  bo_id: 2,
  is_active: 1,
  ...AUDIT,
}

const BATCH = {
  batch_id: 55,
  item_id: 7214,
  batch_no: 'B-0091',
  lot_no: 'L-7',
  mfg_date: '2026-02-01',
  expiry_date: '2027-02-01',
  warranty_months: 12,
  status: 'quarantine',
  attributes: null,
  item_name: 'Steel Rod 12mm',
  item_sku: 'SR-12',
  unit_id: 1,
  unit_symbol: 'Nos',
  stock: { on_hand: 60, reserved: 0, available: 60 },
  ...AUDIT,
}

const SERIAL = {
  serial_id: 91,
  item_id: 7214,
  serial_no: 'SN-0001',
  batch_id: 55,
  warehouse_id: 3,
  location_id: 8,
  status: 'in_stock',
  unit_cost: 812.25,
  warranty_until: '2027-02-01',
  attributes: null,
  item_name: 'Steel Rod 12mm',
  item_sku: 'SR-12',
  warehouse_name: 'Main store',
  batch_no: 'B-0091',
  location_code: 'A-01-02',
  ...AUDIT,
}

/**
 * The cell as the TABLE renders it.
 *
 * Scoped to the table body on purpose: several of these masters offer a status
 * filter whose dropdown carries the same words, and a document-wide query would
 * match the <option> instead of the cell it is meant to be comparing.
 */
function inTable(text: string): HTMLElement {
  const body = document.querySelector('tbody')
  expect(body).toBeTruthy()
  return within(body as HTMLElement).getByText(text)
}

beforeEach(() => {
  exportTabularPdf.mockClear()
})

describe('every real master exports every column it shows', () => {
  const cases: [string, MasterConfig<never>, unknown, string][] = [
    ['items', itemsConfig as unknown as MasterConfig<never>, ITEM, 'Steel Rod 12mm'],
    ['warehouses', warehousesConfig as unknown as MasterConfig<never>, WAREHOUSE, 'Main store'],
    ['batches', batchesConfig as unknown as MasterConfig<never>, BATCH, 'B-0091'],
    ['serials', serialsConfig as unknown as MasterConfig<never>, SERIAL, 'SN-0001'],
  ]

  it.each(cases)('%s: no column comes out blank on the sheet', async (_name, config, row, first) => {
    const sheet = await sheetFor(config, row as never, first)

    expect(sheet.columns.length).toBeGreaterThan(3)
    const blanks = sheet.columns.filter((c) => (sheet.rows[0][c.key]?.text ?? '') === '')
    expect(blanks.map((c) => `${c.key} (${c.label})`)).toEqual([])
  })
})

describe('the Items sheet reproduces the Items screen', () => {
  it('writes the tracking modes and the stock on hand, not two empty columns', async () => {
    const sheet = await sheetFor(itemsConfig, ITEM, 'Steel Rod 12mm')
    const row = sheet.rows[0]

    // Exactly what the table renders for the same row.
    expect(inTable('Batch, Expiry')).toBeTruthy()
    expect(row.tracking.text).toBe('Batch, Expiry')

    // A quantity, formatted as the screen formats it, and numeric underneath so
    // a spreadsheet can total the column.
    expect(inTable('412.5')).toBeTruthy()
    expect(row.on_hand.text).toBe('412.5')
    expect(row.on_hand.value).toBe(412.5)
    expect(sheet.columns.find((c) => c.key === 'on_hand')?.format).toBe('qty')
  })

  it('prints MRP as money, the way the screen does', async () => {
    const sheet = await sheetFor(itemsConfig, ITEM, 'Steel Rod 12mm')

    // The screen renders formatMoney(r.mrp). A sheet that printed "1234.5"
    // under MRP is an unformatted price on a letterheaded document, and an
    // Excel cell typed as text that will not sum.
    expect(sheet.columns.find((c) => c.key === 'mrp')?.format).toBe('amount')
    expect(sheet.rows[0].mrp.text).toBe('1,234.50')
  })
})

describe('a status badge exports the words it shows, not the raw token', () => {
  it('batches: "Quarantine", never `quarantine`', async () => {
    const sheet = await sheetFor(batchesConfig, BATCH, 'B-0091')
    expect(inTable('Quarantine')).toBeTruthy()
    expect(sheet.rows[0].status.text).toBe('Quarantine')
  })

  it('serials: "In stock", never `in_stock`', async () => {
    const sheet = await sheetFor(serialsConfig, SERIAL, 'SN-0001')
    expect(inTable('In stock')).toBeTruthy()
    expect(sheet.rows[0].status.text).toBe('In stock')
  })
})
