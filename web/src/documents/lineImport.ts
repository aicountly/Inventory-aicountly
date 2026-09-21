/**
 * Shared parsing / resolution for the three fast line-entry paths (barcode scan, quick fill,
 * import): turn free-form text into draft lines against the live item search API. Nothing here
 * writes to the document — callers get plain `LineDraft`s back and append them the same way a
 * manual pick does.
 */

import { lineAmount, newLine } from './formModel'
import type { LineDraft } from './formModel'
import { unitOptionsFrom } from './LineEditor'
import type { DocumentTypeSpec } from './registry'
import { lookupApi } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { toNumber } from '../utils/format'

/** A resolved item turned into a fresh draft line, exactly as the manual item picker would. */
export function buildLineFromItem(spec: DocumentTypeSpec, row: ItemSearchRow, opts: { warehouseId: number | null; qty?: number | null; rate?: number | null }): LineDraft {
  const units = unitOptionsFrom(row)
  const def = units.find((u) => u.is_default) ?? units[0]
  const qty = opts.qty ?? null
  const rate = opts.rate ?? null
  return newLine(spec, {
    item_id: row.item_id,
    item_name: row.print_name || row.item_name,
    item_sku: row.item_sku,
    track_batch: Number(row.track_batch) === 1,
    track_serial: Number(row.track_serial) === 1,
    units,
    unit_id: def?.unit_id ?? row.unit_id ?? null,
    warehouse_id: opts.warehouseId ?? row.default_warehouse_id ?? null,
    qty: qty !== null ? String(qty) : '',
    rate: rate !== null ? String(rate) : '',
    amount: qty !== null && rate !== null ? String(lineAmount(qty, rate) ?? '') : '',
  })
}

/** The single best match for a scanned or typed code: an exact SKU / barcode hit wins outright. */
export async function resolveByCode(code: string, warehouseId: number | null, signal?: AbortSignal): Promise<{ item: ItemSearchRow | null; candidates: ItemSearchRow[] }> {
  const q = code.trim()
  if (!q) return { item: null, candidates: [] }
  const rows = await lookupApi.searchItems(q, { warehouseId, limit: 8, signal })
  const exact = rows.find((r) => (r.item_upc && r.item_upc === q) || (r.item_sku && r.item_sku.toLowerCase() === q.toLowerCase()))
  if (exact) return { item: exact, candidates: rows }
  if (rows.length === 1) return { item: rows[0], candidates: rows }
  return { item: null, candidates: rows }
}

// ---------------------------------------------------------------------------
// Multi-row paste / CSV parsing (Quick Fill + Import Lines)
// ---------------------------------------------------------------------------

export interface RawImportRow {
  raw: string
  identifier: string
  qty: number | null
  rate: number | null
}

const HEADER_ROW = /^(item|item name|sku|barcode|code|name)\s*[,\t;]/i
const NUMERIC = /^-?\d+(\.\d+)?$/

/**
 * One line per row: `identifier, qty, rate` (comma, tab or semicolon separated), or a bare
 * `identifier qty` / `identifier qty rate` when the row was typed rather than pasted from a
 * spreadsheet. A row naming no quantity defaults to 1.
 */
export function parseLinesInput(text: string): RawImportRow[] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const out: RawImportRow[] = []
  for (const line of lines) {
    if (HEADER_ROW.test(line)) continue
    let parts = line
      .split(/\t|;|,/)
      .map((p) => p.trim())
    if (parts.length === 1) {
      const tokens = line.split(/\s+/)
      if (tokens.length > 1) {
        const last = tokens[tokens.length - 1]
        const secondLast = tokens.length > 2 ? tokens[tokens.length - 2] : null
        if (secondLast && NUMERIC.test(secondLast) && NUMERIC.test(last)) {
          parts = [tokens.slice(0, -2).join(' '), secondLast, last]
        } else if (NUMERIC.test(last)) {
          parts = [tokens.slice(0, -1).join(' '), last]
        }
      }
    }
    const [identifier = '', qtyRaw, rateRaw] = parts
    if (!identifier) continue
    const qty = qtyRaw !== undefined && qtyRaw !== '' ? toNumber(qtyRaw) : 1
    const rate = rateRaw !== undefined && rateRaw !== '' ? toNumber(rateRaw) : null
    out.push({ raw: line, identifier, qty, rate })
  }
  return out
}

export type ImportRowStatus = 'ok' | 'not_found' | 'ambiguous' | 'invalid_qty'

export interface ResolvedImportRow extends RawImportRow {
  status: ImportRowStatus
  item: ItemSearchRow | null
  candidates: ItemSearchRow[]
}

/** Resolves every parsed row against the live item search API, in parallel. */
export async function resolveImportRows(rows: RawImportRow[], warehouseId: number | null, signal?: AbortSignal): Promise<ResolvedImportRow[]> {
  return Promise.all(
    rows.map(async (row): Promise<ResolvedImportRow> => {
      if (row.qty === null || row.qty <= 0) return { ...row, status: 'invalid_qty', item: null, candidates: [] }
      try {
        const { item, candidates } = await resolveByCode(row.identifier, warehouseId, signal)
        const status: ImportRowStatus = item ? 'ok' : candidates.length > 1 ? 'ambiguous' : 'not_found'
        return { ...row, status, item, candidates }
      } catch {
        return { ...row, status: 'not_found', item: null, candidates: [] }
      }
    }),
  )
}
