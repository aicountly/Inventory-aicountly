/**
 * Master lookups the document editors need: item typeahead, warehouses, units, batches,
 * serials and bills of materials.
 */

import { api, isApiError } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'
import type { BomHeader } from '../documents/bom'
import type { CreateDocumentPayload } from '../documents/types'

export interface ItemUnitRow {
  unit_id: number
  is_default: number
  conversion_factor: number
  uom_role: string | null
  unit_symbol: string | null
  unit_name: string | null
}

export interface ItemSearchRow {
  item_id: number
  item_name: string
  item_alias: string | null
  print_name: string | null
  item_sku: string | null
  item_upc: string | null
  hsn_sac: string | null
  mrp: number | string | null
  unit_id: number | null
  unit_symbol: string | null
  track_batch: number | boolean
  track_serial: number | boolean
  valuation_method: string | null
  default_warehouse_id: number | null
  /** Item group / stock category names (ItemsController::SEARCH_COLUMNS). Absent on older API builds. */
  grp_name?: string | null
  cat_name?: string | null
  stock?: { on_hand: number; available: number; reserved: number }
  units: ItemUnitRow[]
}

export interface WarehouseRow {
  warehouse_id: number
  warehouse_name: string
  warehouse_code: string | null
  warehouse_type: string
  is_default: number
  bo_id: number
  is_active: number
}

export interface UnitRow {
  unit_id: number
  unit_name: string
  unit_symbol: string | null
}

export interface BatchRow {
  batch_id: number
  item_id: number
  batch_no: string
  lot_no: string | null
  mfg_date: string | null
  expiry_date: string | null
  status: string
  stock?: { on_hand: number; reserved: number; available: number }
}

export interface SerialRow {
  serial_id: number
  item_id: number
  serial_no: string
  batch_id: number | null
  warehouse_id: number | null
  warehouse_name?: string | null
  batch_no?: string | null
  status: string
}

/**
 * A serial as `GET /v1/serials` presents it (SerialsController::SELECT) — the whole context a
 * scanned serial number carries: which item it belongs to, where it is and what state it is in.
 *
 * Wider than `SerialRow` on purpose. `SerialRow` backs the per-item picker, which already knows
 * the item; a scan knows nothing but the number on the label.
 */
export interface SerialLookupRow {
  serial_id: number
  item_id: number
  serial_no: string
  batch_id: number | null
  warehouse_id: number | null
  location_id: number | null
  status: string
  unit_cost: number | null
  received_document_id: number | null
  issued_document_id: number | null
  warranty_until: string | null
  item_name: string | null
  item_sku: string | null
  warehouse_name: string | null
  warehouse_code: string | null
  batch_no: string | null
  expiry_date: string | null
  location_code: string | null
  updated_at?: string | null
}

export interface BomListRow {
  bom_id: number
  bom_name: string
  finished_item_id: number
  finished_item_name: string | null
  finished_item_sku: string | null
  yield_qty: number
  yield_unit_id: number | null
  yield_unit_symbol: string | null
  is_active: number
  line_count: number
}

export interface BarcodeLookupOptions {
  warehouseId?: number | null
  signal?: AbortSignal
}

/**
 * The one `GET /v1/items/by-barcode/{code}` request both barcode helpers below issue.
 *
 * The endpoint answers with ItemsController::LIST_COLUMNS, which carries no alternate units and
 * no default warehouse, so both are defaulted to the search row's shape rather than left
 * undefined: a caller reading `row.units` must not have to know which endpoint the row came from.
 */
async function fetchByBarcode(code: string, options: BarcodeLookupOptions): Promise<ItemSearchRow> {
  const res = await api.get<ItemResponse<Partial<ItemSearchRow> & { item_id: number }>>(`v1/items/by-barcode/${encodeURIComponent(code)}`, {
    query: { warehouse_id: options.warehouseId ?? undefined },
    signal: options.signal,
  })
  return { units: [], default_warehouse_id: null, ...res.data } as ItemSearchRow
}

export const lookupApi = {
  async searchItems(q: string, options: { warehouseId?: number | null; limit?: number; signal?: AbortSignal } = {}): Promise<ItemSearchRow[]> {
    const res = await api.get<ItemResponse<ItemSearchRow[]>>('v1/items/search', {
      query: { q, limit: options.limit ?? 15, with_stock: 1, warehouse_id: options.warehouseId ?? undefined },
      signal: options.signal,
    })
    return res.data
  },

  async itemsByIds(ids: number[], signal?: AbortSignal): Promise<ItemSearchRow[]> {
    if (ids.length === 0) return []
    const res = await api.post<ItemResponse<ItemSearchRow[]>>('v1/items/bulk-lookup', { item_ids: ids }, { signal })
    return res.data
  },

  /** Exact UPC / SKU match for a keyboard-wedge scan: `GET /v1/items/by-barcode/{code}`. 404 when nothing matches. */
  byBarcode(code: string, options: BarcodeLookupOptions = {}): Promise<ItemSearchRow> {
    return fetchByBarcode(code, options)
  },

  /**
   * The same lookup, resolving to null instead of throwing when nothing matches.
   *
   * "This barcode is not one of ours" is an ordinary outcome at a receiving bench, not a failure
   * the caller should have to tell apart from a network error inside a catch block. The consumption
   * scan bar wants the throw; the receiving screens want the null. One request, two contracts.
   */
  async itemByBarcode(code: string, options: BarcodeLookupOptions = {}): Promise<ItemSearchRow | null> {
    const trimmed = code.trim()
    if (!trimmed) return null
    try {
      return await fetchByBarcode(trimmed, options)
    } catch (err) {
      if (isApiError(err) && err.status === 404) return null
      throw err
    }
  },

  async warehouses(signal?: AbortSignal): Promise<WarehouseRow[]> {
    const res = await api.list<WarehouseRow>('v1/warehouses', { limit: 1000, status: 'active', sort: 'warehouse_name' }, { signal })
    return res.data
  },

  async units(signal?: AbortSignal): Promise<UnitRow[]> {
    const res = await api.list<UnitRow>('v1/uom', { limit: 1000, status: 'active', sort: 'unit_name' }, { signal })
    return res.data
  },

  batches(itemId: number, options: { warehouseId?: number | null; status?: string; q?: string; signal?: AbortSignal } = {}): Promise<ListResponse<BatchRow>> {
    return api.list<BatchRow>('v1/batches', { item_id: itemId, status: options.status ?? 'active', with_stock: 1, warehouse_id: options.warehouseId ?? undefined, q: options.q, limit: 200, sort: 'expiry_date' }, { signal: options.signal })
  },

  async createBatch(body: { item_id: number; batch_no: string; expiry_date?: string | null; mfg_date?: string | null }): Promise<BatchRow> {
    const res = await api.post<ItemResponse<BatchRow>>('v1/batches', body)
    return res.data
  },

  serials(itemId: number, options: { status?: string; warehouseId?: number | null; batchId?: number | null; q?: string; limit?: number; signal?: AbortSignal } = {}): Promise<ListResponse<SerialRow>> {
    const query: ListQuery = { item_id: itemId, status: options.status, warehouse_id: options.warehouseId ?? undefined, batch_id: options.batchId ?? undefined, q: options.q, limit: options.limit ?? 500, sort: 'serial_no' }
    return api.list<SerialRow>('v1/serials', query, { signal: options.signal })
  },

  async bulkCreateSerials(body: { item_id: number; serial_nos: string[]; warehouse_id?: number | null; batch_id?: number | null }): Promise<{ created: { serial_id: number; serial_no: string }[]; skipped: { serial_no: string; reason: string }[] }> {
    const res = await api.post<ItemResponse<{ created: { serial_id: number; serial_no: string }[]; skipped: { serial_no: string; reason: string }[] }>>('v1/serials/bulk', body)
    return res.data
  },

  /**
   * Serials matching a scanned or typed number, across every item.
   *
   * The same `GET /v1/serials` the serial master reads — `item_id` is optional there and `q`
   * already matches on `serial_no`, so a scan needs no new endpoint. `q_mode: 'prefix'` asks
   * the server for a left-anchored LIKE, which is the index-friendly half of the filter and
   * the only half a scanner ever needs.
   */
  async findSerials(q: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<SerialLookupRow[]> {
    const value = q.trim()
    if (value === '') return []
    const res = await api.list<SerialLookupRow>('v1/serials', { q: value, q_mode: 'prefix', limit: options.limit ?? 20, sort: 'serial_no' }, { signal: options.signal })
    return res.data
  },

  /**
   * The one serial whose number is exactly `serialNo`, or null.
   *
   * Exact rather than "the first match": `SN-1` is a prefix of `SN-10`, and a scanner that
   * silently attached the wrong serial to an adjustment would be worse than one that found
   * nothing at all.
   */
  async findSerialExact(serialNo: string, signal?: AbortSignal): Promise<SerialLookupRow | null> {
    const value = serialNo.trim()
    if (value === '') return null
    const rows = await lookupApi.findSerials(value, { limit: 25, signal })
    const needle = value.toLowerCase()
    return rows.find((r) => r.serial_no.trim().toLowerCase() === needle) ?? null
  },

  /**
   * Active bills of materials, optionally only those that produce one finished item.
   *
   * `finished_item_id` is a filter BomController::index already applies; passing it is what lets
   * the production screen offer only the BOMs valid for the item being made, rather than every
   * BOM in the company.
   */
  boms(q = '', options: { finishedItemId?: number | null; signal?: AbortSignal } = {}): Promise<ListResponse<BomListRow>> {
    return api.list<BomListRow>(
      'v1/bill-of-materials',
      { q, status: 'active', limit: 100, finished_item_id: options.finishedItemId ?? undefined },
      { signal: options.signal },
    )
  },

  async bom(id: number, signal?: AbortSignal): Promise<BomHeader> {
    const res = await api.get<ItemResponse<BomHeader>>(`v1/bill-of-materials/${id}`, { signal })
    return res.data
  },

  /** Server-side explosion (BomService::productionPayload). */
  async explodeBom(id: number, body: { production_qty: number; warehouse_id?: number | null; finished_rate?: number; document_date?: string }, signal?: AbortSignal): Promise<CreateDocumentPayload> {
    const res = await api.post<ItemResponse<CreateDocumentPayload>>(`v1/bill-of-materials/${id}/explode`, body, { signal })
    return res.data
  },
}
