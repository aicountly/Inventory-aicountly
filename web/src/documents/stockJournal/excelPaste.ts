/**
 * Pasting a block of spreadsheet cells into the stock journal.
 *
 * Two pure stages, so both are unit tested and neither needs a DOM:
 *   1. `parseGrid` turns the clipboard text into a rectangle of cells and works
 *      out whether the first row is a header.
 *   2. `resolveRows` turns those cells into draft lines, reporting per row what
 *      it could not resolve.
 *
 * Nothing is inserted until the user confirms the preview, and a row that fails
 * to resolve is shown with its reason rather than dropped — a paste that
 * silently imports 47 of 50 lines is how a stock take goes wrong quietly.
 */

import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { toNumber } from '../../utils/format'

export type PasteColumn = 'item' | 'warehouse' | 'batch' | 'direction' | 'qty' | 'rate' | 'remarks'

export interface ParsedGrid {
  /** Column index → what it holds, once a header row is recognised. */
  columns: Record<PasteColumn, number>
  /** Data rows only — the header row, when there was one, is removed. */
  rows: string[][]
  /** True when row 1 was consumed as a header. */
  hadHeader: boolean
  width: number
}

/** Column order assumed when the paste carries no header row. */
export const DEFAULT_COLUMN_ORDER: readonly PasteColumn[] = ['item', 'warehouse', 'batch', 'direction', 'qty', 'rate', 'remarks']

const HEADER_ALIASES: Record<PasteColumn, readonly string[]> = {
  item: ['item', 'item code', 'itemcode', 'code', 'sku', 'item sku', 'barcode', 'upc', 'item name', 'product'],
  warehouse: ['warehouse', 'wh', 'store', 'location', 'godown'],
  batch: ['batch', 'batch no', 'batchno', 'lot', 'serial', 'batch / serial', 'batch/serial'],
  direction: ['direction', 'dir', 'dir.', 'in/out', 'movement', 'type'],
  qty: ['qty', 'quantity', 'units', 'nos'],
  rate: ['rate', 'price', 'cost', 'unit cost', 'unit rate'],
  remarks: ['remarks', 'remark', 'note', 'notes', 'narration', 'reason'],
}

function normaliseHeader(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[₹*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function headerToColumn(cell: string): PasteColumn | null {
  const n = normaliseHeader(cell)
  if (!n) return null
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [PasteColumn, readonly string[]][]) {
    if (aliases.includes(n)) return key
  }
  return null
}

/**
 * Split the clipboard text into cells.
 *
 * Tab-separated is what a spreadsheet actually puts on the clipboard, so it wins
 * whenever a tab is present; comma-separated is accepted for text pasted out of
 * a CSV file. Quoted CSV fields are honoured so a remark containing a comma
 * survives.
 */
export function splitRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const useTabs = lines.some((l) => l.includes('\t'))
  return lines.map((line) => (useTabs ? line.split('\t').map((c) => c.trim()) : splitCsvLine(line)))
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  out.push(cell.trim())
  return out
}

export function parseGrid(text: string): ParsedGrid {
  const rows = splitRows(text)
  const empty: ParsedGrid = { columns: {} as Record<PasteColumn, number>, rows: [], hadHeader: false, width: 0 }
  if (rows.length === 0) return empty

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const first = rows[0]
  const mapped = first.map(headerToColumn)
  // A header row is one where most cells name a column we know. Two matches is
  // enough to be sure — "Item, Qty" is a perfectly ordinary header.
  const hadHeader = mapped.filter(Boolean).length >= 2

  const columns = {} as Record<PasteColumn, number>
  if (hadHeader) {
    mapped.forEach((col, i) => {
      if (col && columns[col] === undefined) columns[col] = i
    })
  } else {
    DEFAULT_COLUMN_ORDER.forEach((col, i) => {
      if (i < width) columns[col] = i
    })
  }

  return { columns, rows: hadHeader ? rows.slice(1) : rows, hadHeader, width }
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

export interface ResolveContext {
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  /**
   * Items already looked up by the caller, keyed by `itemKey()` of every string
   * they can be named by (SKU, barcode, name). Async work stays out of here so
   * the resolver is pure.
   */
  items: ReadonlyMap<string, ItemSearchRow>
}

export interface ResolvedRow {
  /** 1-based, counting the header row as row 1 when there was one. */
  rowNumber: number
  raw: string[]
  item: ItemSearchRow | null
  warehouseId: number | null
  warehouseName: string
  batchText: string
  direction: 'in' | 'out' | null
  qty: string
  rate: string
  remarks: string
  /** Blocking problems: the row cannot be inserted. */
  errors: string[]
  /** Non-blocking: the row inserts, with a note. */
  notes: string[]
}

export interface ResolveResult {
  rows: ResolvedRow[]
  okCount: number
  errorCount: number
  /** Every distinct item token the grid names, for the caller to look up. */
  itemTokens: string[]
}

/** How an item string is keyed for lookup: case and punctuation insensitive. */
export function itemKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

const IN_WORDS = new Set(['in', 'inward', 'receipt', 'receive', 'add', 'plus', '+', 'increase', 'excess'])
const OUT_WORDS = new Set(['out', 'outward', 'issue', 'issued', 'remove', 'minus', '-', 'decrease', 'shortage'])

export function parseDirection(value: string): 'in' | 'out' | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (IN_WORDS.has(v)) return 'in'
  if (OUT_WORDS.has(v)) return 'out'
  return null
}

/** Every item token in the grid, so the caller can resolve them in one request. */
export function itemTokensOf(grid: ParsedGrid): string[] {
  const at = grid.columns.item
  if (at === undefined) return []
  const seen = new Set<string>()
  for (const row of grid.rows) {
    const token = (row[at] ?? '').trim()
    if (token) seen.add(token)
  }
  return [...seen]
}

function findWarehouse(name: string, warehouses: readonly FormOptionWarehouse[]): FormOptionWarehouse | null {
  const n = itemKey(name)
  if (!n) return null
  return (
    warehouses.find((w) => itemKey(w.warehouse_name) === n) ??
    warehouses.find((w) => w.warehouse_code && itemKey(w.warehouse_code) === n) ??
    null
  )
}

export function resolveRows(grid: ParsedGrid, ctx: ResolveContext): ResolveResult {
  const cell = (row: string[], col: PasteColumn): string => {
    const at = grid.columns[col]
    return at === undefined ? '' : (row[at] ?? '').trim()
  }
  const offset = grid.hadHeader ? 2 : 1

  const rows: ResolvedRow[] = grid.rows.map((raw, i) => {
    const errors: string[] = []
    const notes: string[] = []

    const itemToken = cell(raw, 'item')
    const item = itemToken ? (ctx.items.get(itemKey(itemToken)) ?? null) : null
    if (!itemToken) errors.push('No item code or name in this row.')
    else if (!item) errors.push(`No item matches "${itemToken}".`)

    const warehouseToken = cell(raw, 'warehouse')
    let warehouseId = ctx.defaultWarehouseId
    let warehouseName = ''
    if (warehouseToken) {
      const found = findWarehouse(warehouseToken, ctx.warehouses)
      if (found) {
        warehouseId = found.warehouse_id
        warehouseName = found.warehouse_name
      } else {
        errors.push(`No warehouse matches "${warehouseToken}".`)
        warehouseId = null
      }
    } else if (warehouseId === null) {
      errors.push('No warehouse in this row and no default warehouse is set.')
    } else {
      warehouseName = ctx.warehouses.find((w) => w.warehouse_id === warehouseId)?.warehouse_name ?? ''
      notes.push('Warehouse taken from the header default.')
    }

    const directionToken = cell(raw, 'direction')
    let direction = parseDirection(directionToken)
    if (!direction) {
      if (directionToken) errors.push(`"${directionToken}" is not a direction — use In or Out.`)
      else {
        direction = 'out'
        notes.push('No direction given; defaulted to Out.')
      }
    }

    const qtyToken = cell(raw, 'qty')
    const qty = toNumber(qtyToken.replace(/,/g, ''))
    if (qtyToken === '') errors.push('No quantity in this row.')
    else if (qty === null) errors.push(`"${qtyToken}" is not a number.`)
    else if (qty <= 0) errors.push('Quantity must be greater than zero.')

    const rateToken = cell(raw, 'rate')
    const rate = rateToken === '' ? null : toNumber(rateToken.replace(/[,₹]/g, ''))
    if (rateToken !== '' && rate === null) errors.push(`"${rateToken}" is not a rate.`)
    else if (rate !== null && rate < 0) errors.push('Rate cannot be negative.')

    const batchText = cell(raw, 'batch')
    if (batchText && item && !Number(item.track_batch) && !Number(item.track_serial)) {
      notes.push('Batch / serial ignored: this item is not tracked.')
    }
    if (batchText && item && (Number(item.track_batch) === 1 || Number(item.track_serial) === 1)) {
      notes.push('Select the batch or serials on the row after inserting.')
    }
    if (!batchText && item && Number(item.track_batch) === 1) {
      notes.push('Batch tracked: pick a batch on the row after inserting.')
    }
    if (!batchText && item && Number(item.track_serial) === 1) {
      notes.push('Serial tracked: pick serial numbers on the row after inserting.')
    }

    return {
      rowNumber: i + offset,
      raw,
      item,
      warehouseId,
      warehouseName,
      batchText,
      direction,
      qty: qty !== null && qty > 0 ? String(qty) : qtyToken,
      rate: rate !== null && rate >= 0 ? String(rate) : '',
      remarks: cell(raw, 'remarks'),
      errors,
      notes,
    }
  })

  return {
    rows,
    okCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    itemTokens: itemTokensOf(grid),
  }
}

/** The template a user can copy into a spreadsheet before filling it in. */
export const PASTE_TEMPLATE_HEADERS: readonly string[] = ['Item Code / SKU', 'Warehouse', 'Batch / Serial', 'Direction', 'Qty', 'Rate', 'Remarks']
