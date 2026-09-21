/**
 * Master-data resources under `/v1/...`.
 *
 * Every simple master shares the same CRUD contract (MasterController), so one
 * factory covers them; bill of materials, batches and serials have the same
 * verbs with richer bodies.
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

// ---------------------------------------------------------------------------
// Row types (as returned by the API; ints arrive as numbers or numeric strings)
// ---------------------------------------------------------------------------

export interface AuditFields {
  created_at?: string | null
  updated_at?: string | null
  created_by?: string | null
  updated_by?: string | null
}

export interface ItemGroup extends AuditFields {
  item_grp_id: number
  grp_name: string
  grp_alias: string | null
  parent_grp_id: number | null
  is_primary: number
  is_active: number
  item_count?: number
}

export interface StockCategory extends AuditFields {
  stock_cat_id: number
  cat_name: string
  cat_alias: string | null
  is_active: number
}

export interface Brand extends AuditFields {
  brand_id: number
  brand_name: string
  brand_alias: string | null
  is_active: number
}

export interface Uom extends AuditFields {
  unit_id: number
  unit_name: string
  unit_symbol: string | null
  print_name: string | null
  uqc_gst: string | null
  decimal_places: number
  is_active: number
}

export interface WarehouseGroup extends AuditFields {
  warehouse_group_id: number
  grp_name: string
  parent_grp_id: number | null
  is_active: number
}

export type WarehouseType = 'standard' | 'transit' | 'damaged' | 'quarantine' | 'consignment' | 'job_worker' | 'virtual'
export const WAREHOUSE_TYPES: WarehouseType[] = ['standard', 'transit', 'damaged', 'quarantine', 'consignment', 'job_worker', 'virtual']

export interface Warehouse extends AuditFields {
  warehouse_id: number
  warehouse_name: string
  warehouse_code: string | null
  warehouse_group_id: number | null
  parent_warehouse_id: number | null
  warehouse_type: WarehouseType | string
  is_default: number
  allow_negative: number | null
  address: Record<string, unknown> | null
  contact: Record<string, unknown> | null
  bo_id: number
  is_active: number
}

export type LocationType = 'zone' | 'rack' | 'shelf' | 'bin'
export const LOCATION_TYPES: LocationType[] = ['zone', 'rack', 'shelf', 'bin']

export interface Location extends AuditFields {
  location_id: number
  warehouse_id: number
  parent_location_id: number | null
  location_code: string
  location_name: string | null
  location_type: LocationType | string
  is_active: number
}

export type BomLineKind = 'component' | 'by_product' | 'scrap'
export const BOM_LINE_KINDS: BomLineKind[] = ['component', 'by_product', 'scrap']

export interface BomLine {
  bom_line_id?: number
  item_id: number
  qty: number
  unit_id: number | null
  line_kind: BomLineKind | string
  scrap_percent: number
  sort_order: number
  item_name?: string | null
  item_sku?: string | null
  item_is_active?: number
  unit_symbol?: string | null
}

export interface Bom extends AuditFields {
  bom_id: number
  bom_uuid?: string
  bom_name: string
  finished_item_id: number
  yield_qty: number
  yield_unit_id: number | null
  is_active: number
  finished_item_name: string | null
  finished_item_sku: string | null
  finished_item_unit_id?: number | null
  yield_unit_symbol: string | null
  line_count: number
  lines?: BomLine[]
}

export type BatchStatus = 'active' | 'quarantine' | 'recalled' | 'expired' | 'closed'
export const BATCH_STATUSES: BatchStatus[] = ['active', 'quarantine', 'recalled', 'expired', 'closed']

export interface StockSummary {
  on_hand: number
  available: number
  reserved: number
}

/** Where a batch's stock sits, biggest holding first (`with_stock=1` lists). */
export interface BatchWarehouseStock {
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
  on_hand: number
}

/** One warehouse's full bucket breakdown for a batch (`GET /v1/batches/{id}`). */
export interface BatchBalanceRow extends BatchWarehouseStock {
  reserved: number
  committed: number
  packed: number
  in_transit: number
  job_worker: number
  quality_hold: number
  damaged: number
  blocked: number
  expected: number
  available: number
  last_movement_at: string | null
}

export interface Batch extends AuditFields {
  batch_id: number
  batch_uuid?: string
  item_id: number
  batch_no: string
  lot_no: string | null
  mfg_date: string | null
  expiry_date: string | null
  warranty_months: number | null
  status: BatchStatus | string
  attributes: Record<string, unknown> | null
  item_name: string | null
  item_sku: string | null
  item_grp_name?: string | null
  stock_cat_name?: string | null
  track_expiry?: number | null
  unit_id?: number | null
  unit_symbol: string | null
  stock?: StockSummary
  /** Only on `with_stock=1` lists. */
  warehouses?: BatchWarehouseStock[]
  /** Only on `GET /v1/batches/{id}`. */
  balances?: BatchBalanceRow[]
}

/**
 * `GET /v1/batches/summary` — the whole filtered set counted by the server.
 *
 * `states` is the screen's four-way grading (the stored status wins unless it
 * is `active`, in which case the expiry date decides); `status_counts` is the
 * raw domain status. Both are computed over exactly the filters the list was
 * sent, so the cards above the table always speak for the rows below them.
 */
export interface BatchSummary {
  total: number
  items: number
  with_stock: number
  total_on_hand: number
  expiry_window_days: number
  as_of: string
  states: {
    active: number
    expiring_soon: number
    expired: number
    inactive: number
  }
  status_counts: Record<string, number>
  expiry_buckets: {
    expired: number
    within_30: number
    days_31_90: number
    days_91_180: number
    beyond_180: number
    no_expiry: number
  }
  /** Batches opened in the last `expiry_window_days` days, and in the window before it. */
  created_recent: number
  created_previous: number
}

export type SerialStatus = 'expected' | 'in_stock' | 'reserved' | 'issued' | 'in_transit' | 'damaged' | 'returned' | 'scrapped'
export const SERIAL_STATUSES: SerialStatus[] = ['expected', 'in_stock', 'reserved', 'issued', 'in_transit', 'damaged', 'returned', 'scrapped']

export interface Serial extends AuditFields {
  serial_id: number
  serial_uuid?: string
  item_id: number
  serial_no: string
  batch_id: number | null
  warehouse_id: number | null
  location_id: number | null
  status: SerialStatus | string
  unit_cost: number | null
  received_document_id?: number | null
  issued_document_id?: number | null
  warranty_until: string | null
  attributes: Record<string, unknown> | null
  item_name: string | null
  item_sku: string | null
  warehouse_name: string | null
  warehouse_code?: string | null
  batch_no: string | null
  expiry_date?: string | null
  location_code: string | null
}

export interface SerialBulkResult {
  item_id: number
  item_name: string
  created: { serial_id: number; serial_no: string }[]
  skipped: { serial_no: string; reason: string; status?: string }[]
  created_count: number
  skipped_count: number
}

// ---------------------------------------------------------------------------
// CRUD factory
// ---------------------------------------------------------------------------

export interface CrudApi<T> {
  list(query?: ListQuery, signal?: AbortSignal): Promise<ListResponse<T>>
  get(id: number, signal?: AbortSignal): Promise<T>
  create(body: Record<string, unknown>): Promise<T>
  update(id: number, body: Record<string, unknown>): Promise<T>
  remove(id: number): Promise<void>
}

export function crud<T>(slug: string): CrudApi<T> {
  const base = `v1/${slug}`
  return {
    list: (query = {}, signal) => api.list<T>(base, query, { signal }),
    get: async (id, signal) => (await api.get<ItemResponse<T>>(`${base}/${id}`, { signal })).data,
    create: async (body) => (await api.post<ItemResponse<T>>(base, body)).data,
    update: async (id, body) => (await api.put<ItemResponse<T>>(`${base}/${id}`, body)).data,
    remove: async (id) => {
      await api.delete<unknown>(`${base}/${id}`)
    },
  }
}

export const itemGroupsApi = crud<ItemGroup>('item-groups')
export const stockCategoriesApi = crud<StockCategory>('stock-categories')
export const brandsApi = crud<Brand>('brands')
export const uomApi = crud<Uom>('uom')
export const warehouseGroupsApi = crud<WarehouseGroup>('warehouse-groups')
export const warehousesApi = crud<Warehouse>('warehouses')
export const locationsApi = crud<Location>('locations')
export const bomApi = crud<Bom>('bill-of-materials')
export const batchesApi = {
  ...crud<Batch>('batches'),
  /** The figures above the Batches table. Takes the same filters as `list`. */
  async summary(query: ListQuery = {}, signal?: AbortSignal): Promise<BatchSummary> {
    return (await api.get<ItemResponse<BatchSummary>>('v1/batches/summary', { query, signal })).data
  },
}
export const serialsApi = {
  ...crud<Serial>('serials'),
  async bulkCreate(body: {
    item_id: number
    serial_nos: string[]
    warehouse_id?: number | null
    batch_id?: number | null
    location_id?: number | null
  }): Promise<SerialBulkResult> {
    return (await api.post<ItemResponse<SerialBulkResult>>('v1/serials/bulk', body)).data
  },
}
