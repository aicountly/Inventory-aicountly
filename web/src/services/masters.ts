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

/** One chip in the list's Components column — the API's `components_preview`. */
export interface BomComponentPreview {
  item_id: number
  item_name: string | null
  item_sku: string | null
  qty: number
  unit_symbol: string | null
  scrap_percent: number
  /** 0 when the component item has since been deactivated. */
  item_is_active: number | null
}

export interface Bom extends AuditFields {
  bom_id: number
  bom_uuid?: string
  /** `BOM-007` — formatted by the API from the row's id, not stored. */
  bom_code?: string
  bom_name: string
  finished_item_id: number
  yield_qty: number
  yield_unit_id: number | null
  is_active: number
  finished_item_name: string | null
  finished_item_sku: string | null
  finished_item_unit_id?: number | null
  finished_item_is_active?: number | null
  finished_item_grp_id?: number | null
  finished_item_group_name?: string | null
  yield_unit_symbol: string | null
  line_count: number
  /** Component lines only; `line_count` also counts by-products and scrap. */
  component_count?: number
  by_product_count?: number
  scrap_count?: number
  /** Present when the list was asked for `with_preview`. */
  components_preview?: BomComponentPreview[]
  /** Resolved from the company's member roster; null for a service actor. */
  created_by_name?: string | null
  updated_by_name?: string | null
  lines?: BomLine[]
}

/** `GET /v1/bill-of-materials` — everything the workspace can narrow by. */
export interface BomListQuery extends ListQuery {
  status?: 'active' | 'inactive' | ''
  finished_item_id?: number | ''
  component_item_id?: number | ''
  item_grp_id?: number | ''
  min_components?: number | ''
  max_components?: number | ''
  has_scrap?: 0 | 1 | ''
  has_by_products?: 0 | 1 | ''
  created_from?: string
  created_to?: string
  created_by?: string
  updated_from?: string
  updated_to?: string
  updated_by?: string
  /** Ask for the component chips and the per-kind counts in the same request. */
  with_preview?: 0 | 1
}

/**
 * `GET /v1/bill-of-materials/summary` — the figures above the list.
 *
 * `estimated_material_cost` is null when NOTHING could be priced. It is not a
 * zero: a zero would read as "these bills cost nothing to build", which is a
 * costing claim the API is not in a position to make.
 */
export interface BomSummary {
  total: number
  active: number
  inactive: number
  average_components: number
  component_lines: number
  linked_finished_items: number
  linked_finished_items_active: number
  created_last_30_days: number
  created_previous_30_days: number
  estimated_material_cost: number | null
  costed_boms: number
  partially_costed_boms: number
  currency: string
}

/** One costed line of `GET /v1/bill-of-materials/{id}/cost`. */
export interface BomCostLine extends BomLine {
  gross_qty: number
  cost_per_unit: number | null
  cost_source: 'weighted_average' | 'standard_cost' | null
  estimated_cost: number | null
}

export interface BomCostTotals {
  currency: string
  lines: BomCostLine[]
  component_cost: number
  wastage_cost: number
  total_cost: number
  cost_per_unit: number | null
  priced_components: number
  unpriced_components: number
  /** False when not one component could be priced — show "Cost unavailable". */
  cost_available: boolean
  /** True only when EVERY component has a rate. */
  cost_complete: boolean
}

export interface BomCost extends BomCostTotals {
  bom_id: number
  bom_code: string
  bom_name: string
  yield_qty: number
  yield_unit_symbol: string | null
}

/** One unsaved component line, as `cost-preview` wants it. */
export interface BomCostPreviewLine {
  item_id: number
  qty: number
  unit_id?: number | null
  scrap_percent?: number
  line_kind?: BomLineKind | string
}

export type BatchStatus = 'active' | 'quarantine' | 'recalled' | 'expired' | 'closed'
export const BATCH_STATUSES: BatchStatus[] = ['active', 'quarantine', 'recalled', 'expired', 'closed']

export interface StockSummary {
  on_hand: number
  available: number
  reserved: number
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
  unit_id?: number | null
  unit_symbol: string | null
  stock?: StockSummary
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
/**
 * Bills of materials: the shared CRUD contract plus the four verbs the
 * workspace needs.
 *
 * It still satisfies `CrudApi<Bom>`, so `MasterPage`, the editor and the export
 * machinery keep working against it unchanged.
 */
export const bomApi = {
  ...crud<Bom>('bill-of-materials'),

  summary: async (signal?: AbortSignal): Promise<BomSummary> =>
    (await api.get<ItemResponse<BomSummary>>('v1/bill-of-materials/summary', { signal })).data,

  cost: async (id: number, signal?: AbortSignal): Promise<BomCost> =>
    (await api.get<ItemResponse<BomCost>>(`v1/bill-of-materials/${id}/cost`, { signal })).data,

  /**
   * Cost a bill that has not been saved — what the editor shows while it is
   * still being typed. It reads valuation and writes nothing.
   */
  costPreview: async (
    body: { yield_qty: number; lines: BomCostPreviewLine[] },
    signal?: AbortSignal,
  ): Promise<BomCostTotals> =>
    (await api.post<ItemResponse<BomCostTotals>>('v1/bill-of-materials/cost-preview', body, { signal })).data,

  duplicate: async (id: number, bomName?: string): Promise<Bom> =>
    (await api.post<ItemResponse<Bom>>(`v1/bill-of-materials/${id}/duplicate`, bomName ? { bom_name: bomName } : {})).data,

  /*
   * Activate / deactivate.
   *
   * A PUT with no `lines` key updates the header and leaves the lines exactly
   * as they are (BomController::update), so this cannot silently rewrite a
   * recipe on its way to flipping a flag.
   */
  setActive: async (id: number, active: boolean): Promise<Bom> =>
    (await api.put<ItemResponse<Bom>>(`v1/bill-of-materials/${id}`, { is_active: active ? 1 : 0 })).data,
}
export const batchesApi = crud<Batch>('batches')
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
