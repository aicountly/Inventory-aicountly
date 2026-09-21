/**
 * Pure helpers behind the Opening Stock workspace (summary strip, quick
 * actions, copy / import modals, validation drawer). No React, no API calls —
 * everything here takes data it is handed and returns data, so the fiddly
 * matching and validation rules are unit-tested directly rather than only
 * through a rendered modal.
 */

import type { ItemSearchRow } from '../../services/lookupApi'
import type { FormOptionWarehouse } from '../../services/items'
import type { StockBalanceGridRow } from '../../services/stockViewsApi'
import { toCsv } from '../../utils/csv'
import { toNumber } from '../../utils/format'
import { unitOptionsFrom } from '../LineEditor'
import { isBlankLine, lineAmount, newLine, validateDraft } from '../formModel'
import type { HeaderDraft, LineDraft } from '../formModel'
import type { DocumentTypeSpec } from '../registry'

/** Where "Copy from" / "Fetch from closing stock" pulls candidate lines from. */
export type CopySource = 'previous_document' | 'closing_stock'

// ---- Template / import column mapping --------------------------------------

export const IMPORT_TEMPLATE_COLUMNS = [
  'Item Code',
  'Item Name',
  'Warehouse',
  'Batch',
  'Serial Number',
  'Unit',
  'Quantity',
  'Rate',
  'Expiry Date',
  'Narration',
] as const

/** Header-only CSV a user fills in and re-uploads via Import CSV. */
export function buildImportTemplateCsv(): string {
  return toCsv([], IMPORT_TEMPLATE_COLUMNS.map((header) => ({ header, value: () => '' })))
}

const HEADER_ALIASES: Record<string, string[]> = {
  code: ['item code', 'code', 'sku'],
  name: ['item name', 'item', 'name'],
  warehouse: ['warehouse', 'warehouse name'],
  batch: ['batch', 'batch no', 'batch number'],
  serial: ['serial number', 'serial', 'serials'],
  unit: ['unit'],
  qty: ['quantity', 'qty'],
  rate: ['rate'],
  expiry: ['expiry date', 'expiry'],
  narration: ['narration', 'description', 'notes'],
}

function pickField(record: Record<string, string>, key: keyof typeof HEADER_ALIASES): string {
  const wanted = HEADER_ALIASES[key]
  const hit = Object.keys(record).find((h) => wanted.includes(h.trim().toLowerCase()))
  return hit ? (record[hit] ?? '').trim() : ''
}

/** Case/code-insensitive match against the warehouses already loaded for this branch. */
export function matchWarehouseByName(name: string, warehouses: readonly FormOptionWarehouse[]): number | null {
  const n = name.trim().toLowerCase()
  if (!n) return null
  const hit = warehouses.find((w) => w.warehouse_name.trim().toLowerCase() === n || (w.warehouse_code ?? '').trim().toLowerCase() === n)
  return hit?.warehouse_id ?? null
}

/** Exact SKU match first (the code a spreadsheet is most likely to carry), then exact name, else the lone search hit. */
export function matchItemFromSearch(rows: readonly ItemSearchRow[], code: string, name: string): ItemSearchRow | null {
  const c = code.trim().toLowerCase()
  const n = name.trim().toLowerCase()
  if (c) {
    const bySku = rows.find((r) => (r.item_sku ?? '').trim().toLowerCase() === c)
    if (bySku) return bySku
  }
  if (n) {
    const byName = rows.find((r) => r.item_name.trim().toLowerCase() === n)
    if (byName) return byName
  }
  return rows.length === 1 ? rows[0] : null
}

export interface ImportRow {
  rowNumber: number
  itemCode: string
  itemName: string
  warehouseName: string
  batchNo: string
  serialNumbers: string
  unitSymbol: string
  expiryDate: string
  narration: string
  quantity: number | null
  rate: number | null
  warehouseId: number | null
  /** Set once the modal has searched for a match; null until then or if nothing matched. */
  item: ItemSearchRow | null
  errors: string[]
  warnings: string[]
}

/**
 * One CSV data row → an `ImportRow`, resolving everything that does not need
 * a network call (numbers, the warehouse column). `item` starts null — the
 * modal fills it in from a live item search, because that is the one part of
 * this mapping that cannot be pure.
 */
export function buildImportRow(record: Record<string, string>, rowNumber: number, warehouses: readonly FormOptionWarehouse[], defaultWarehouseId: number | null): ImportRow {
  const itemCode = pickField(record, 'code')
  const itemName = pickField(record, 'name')
  const warehouseName = pickField(record, 'warehouse')
  const quantity = toNumber(pickField(record, 'qty'))
  const rate = toNumber(pickField(record, 'rate'))
  const errors: string[] = []
  const warnings: string[] = []

  if (!itemCode && !itemName) errors.push('No item code or item name.')
  if (quantity === null || quantity <= 0) errors.push('Quantity must be greater than zero.')

  let warehouseId = defaultWarehouseId
  if (warehouseName) {
    const matched = matchWarehouseByName(warehouseName, warehouses)
    if (matched === null) {
      warnings.push(`Warehouse "${warehouseName}" was not found — using the default warehouse.`)
    } else {
      warehouseId = matched
    }
  }
  if (warehouseId === null) warnings.push('No warehouse resolved — set a Default Warehouse or add one to the file.')

  return {
    rowNumber,
    itemCode,
    itemName,
    warehouseName,
    batchNo: pickField(record, 'batch'),
    serialNumbers: pickField(record, 'serial'),
    unitSymbol: pickField(record, 'unit'),
    expiryDate: pickField(record, 'expiry'),
    narration: pickField(record, 'narration'),
    quantity,
    rate,
    warehouseId,
    item: null,
    errors,
    warnings,
  }
}

export type ImportRowStatus = 'error' | 'unresolved' | 'ok'

export function importRowStatus(row: Pick<ImportRow, 'errors' | 'item'>): ImportRowStatus {
  if (row.errors.length > 0) return 'error'
  if (!row.item) return 'unresolved'
  return 'ok'
}

// ---- LineDraft construction --------------------------------------------------

/** A picked search result → a new draft line, the same shape LineEditor builds when a row is picked by hand. */
export function lineFromItemRow(spec: DocumentTypeSpec, defaultWarehouseId: number | null, row: ItemSearchRow, overrides: Partial<LineDraft> = {}): LineDraft {
  const units = unitOptionsFrom(row)
  const def = units.find((u) => u.is_default) ?? units[0]
  return newLine(spec, {
    item_id: row.item_id,
    item_name: row.print_name || row.item_name,
    item_sku: row.item_sku,
    track_batch: Number(row.track_batch) === 1,
    track_serial: Number(row.track_serial) === 1,
    units,
    unit_id: def?.unit_id ?? row.unit_id ?? null,
    warehouse_id: row.default_warehouse_id ?? defaultWarehouseId,
    ...overrides,
  })
}

/** A resolved import row → a draft line: quantity, rate and warehouse come from the file, not the defaults. */
export function lineFromImportRow(spec: DocumentTypeSpec, defaultWarehouseId: number | null, row: ImportRow): LineDraft | null {
  if (!row.item) return null
  const qty = row.quantity !== null ? String(row.quantity) : ''
  const rate = row.rate !== null ? String(row.rate) : ''
  return lineFromItemRow(spec, defaultWarehouseId, row.item, {
    warehouse_id: row.warehouseId,
    batch_no: row.batchNo || null,
    qty,
    rate,
    amount: row.rate !== null ? String(lineAmount(qty, rate) ?? '') : '',
    description: row.narration || '',
  })
}

/**
 * A batch and an expiry date belong to the batch master, not the line, and a
 * serial has to be an existing (or freshly registered) serial record — none of
 * that is safe to fabricate from a spreadsheet cell during preview, before the
 * user has confirmed anything. These name what the row asked for that the
 * import cannot apply automatically, so the preview can say so instead of
 * silently dropping it.
 */
export function importRowNotes(row: Pick<ImportRow, 'batchNo' | 'serialNumbers' | 'expiryDate' | 'item'>): string[] {
  const notes: string[] = []
  if (row.batchNo && row.item?.track_batch) notes.push(`Batch "${row.batchNo}" was not assigned automatically — pick or create it on this line after import.`)
  if (row.serialNumbers && row.item?.track_serial) notes.push('Serial numbers were not assigned automatically — add them on this line after import.')
  if (row.expiryDate) notes.push('Expiry date is set on the batch, not the line — apply it when creating the batch.')
  return notes
}

/** A current stock-balance row → a draft line. `item` is the batch-resolved item (for units); undefined leaves them empty. */
export function lineFromStockBalance(spec: DocumentTypeSpec, row: StockBalanceGridRow, item: ItemSearchRow | undefined): LineDraft {
  const units = item ? unitOptionsFrom(item) : []
  const def = units.find((u) => u.is_default) ?? units[0]
  const qty = toNumber(row.on_hand_qty)
  return newLine(spec, {
    item_id: row.item_id,
    item_name: item?.print_name || item?.item_name || row.item_name || `Item #${row.item_id}`,
    item_sku: item?.item_sku ?? row.item_sku ?? null,
    track_batch: item ? Number(item.track_batch) === 1 : !!row.batch_id,
    track_serial: item ? Number(item.track_serial) === 1 : false,
    units,
    unit_id: def?.unit_id ?? null,
    warehouse_id: row.warehouse_id,
    batch_id: row.batch_id,
    batch_no: row.batch_no,
    qty: qty !== null ? String(qty) : '',
  })
}

// ---- Duplicate detection ----------------------------------------------------

/** Indexes of every item that shares its signature with an earlier one (both the first and the repeats). `null` signatures never match anything, including each other. */
export function duplicateSignatureIndexes<T>(items: readonly T[], signature: (item: T) => string | null): Set<number> {
  const seen = new Map<string, number>()
  const dups = new Set<number>()
  items.forEach((item, i) => {
    const sig = signature(item)
    if (sig === null) return
    const first = seen.get(sig)
    if (first !== undefined) {
      dups.add(first)
      dups.add(i)
    } else {
      seen.set(sig, i)
    }
  })
  return dups
}

function lineSignature(l: LineDraft): string | null {
  return l.item_id === null ? null : `${l.item_id}|${l.warehouse_id ?? ''}|${l.batch_id ?? ''}`
}

/** Draft line keys that share item + warehouse + batch with another non-blank line. */
export function findDuplicateLineKeys(lines: readonly LineDraft[]): Set<string> {
  const active = lines.filter((l) => !isBlankLine(l))
  const dupIdx = duplicateSignatureIndexes(active, lineSignature)
  const keys = new Set<string>()
  dupIdx.forEach((i) => keys.add(active[i].key))
  return keys
}

// ---- Validation report -------------------------------------------------------

export interface ValidationReport {
  errors: string[]
  warnings: string[]
  suggestions: string[]
}

/**
 * Errors are exactly what `validateDraft` would reject the save for.
 * Warnings and suggestions are extra, softer reads of the same in-memory
 * lines — real signal, never a guess about data the form does not have.
 */
export function buildValidationReport(header: HeaderDraft, lines: LineDraft[], spec: DocumentTypeSpec, warehouses: readonly FormOptionWarehouse[]): ValidationReport {
  const errors = validateDraft(header, lines, spec)
  const warnings: string[] = []
  const suggestions: string[] = []
  const active = lines.filter((l) => !isBlankLine(l))

  const dupKeys = findDuplicateLineKeys(lines)
  if (dupKeys.size > 0) {
    const lineNumbers = active.map((l, i) => (dupKeys.has(l.key) ? i + 1 : null)).filter((n): n is number => n !== null)
    warnings.push(`Duplicate item + warehouse + batch combination on line${lineNumbers.length === 1 ? '' : 's'} ${lineNumbers.join(', ')}.`)
  }

  let missingRateCount = 0
  active.forEach((l, i) => {
    const qty = toNumber(l.qty)
    const rate = toNumber(l.rate)
    if (spec.rate && qty !== null && qty > 0 && (rate === null || rate === 0)) {
      missingRateCount += 1
      warnings.push(`Line ${i + 1}: quantity is entered but the rate is 0 — this line's opening value will be zero.`)
    }
    if (l.warehouse_id === null && header.default_warehouse_id === null) {
      warnings.push(`Line ${i + 1}: no warehouse resolved — set a Default Warehouse or a line warehouse.`)
    }
  })

  if (header.default_warehouse_id === null && warehouses.length > 1) {
    suggestions.push('Set a Default Warehouse so new lines are pre-filled automatically.')
  }
  if (missingRateCount > 0) {
    suggestions.push(`${missingRateCount} line${missingRateCount === 1 ? '' : 's'} could use a rate from last year's closing stock — try "Copy from previous year".`)
  }

  return { errors, warnings, suggestions }
}
