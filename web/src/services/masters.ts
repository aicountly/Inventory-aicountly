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
  /** Items pointing at this category — sent by the API, never counted client-side. */
  item_count?: number
}

export interface Brand extends AuditFields {
  brand_id: number
  brand_uuid?: string
  brand_name: string
  brand_alias: string | null
  /** Short handle, unique per company where one was given (migration 012). */
  brand_code?: string | null
  description?: string | null
  is_active: number
  /**
   * Items filed under this brand.
   *
   * Counted by the API over the whole company in one grouped query, never by
   * the browser from the page on screen — a figure derived from 50 of 431 rows
   * would contradict the footer beside it.
   */
  item_count?: number
}

/**
 * `GET /v1/brands/metrics` — the figures above the Brands list.
 *
 * Company-wide and filter-independent on purpose: the cards describe the brand
 * master, and clicking one filters the list rather than redefining the figure.
 *
 * Every field here is counted out of Inventory's own tables. There is no sales
 * figure in this shape and there will not be one: a brand's turnover belongs to
 * Books and is read live from `brandAnalyticsApi`, never stored here.
 */
export interface BrandMetrics {
  total: number
  active: number
  inactive: number
  new_this_month: number
  new_prev_month: number
  /** Brands nothing is filed under — the one operational fact this screen can act on. */
  without_items: number
  with_items: number
  /** Inventory's own leader board: most items, NOT most revenue. */
  top_by_items: { brand_id: number; brand_name: string; item_count: number } | null
  as_of: string
}

/** Filters the brands list endpoint understands beyond the shared ListQuery. */
export interface BrandListQuery extends ListQuery {
  /** `active` | `inactive` | omitted for both. */
  status?: string
  /** `YYYY-MM-DD`, inclusive at both ends. */
  created_from?: string
  created_to?: string
  /** `'1'` only brands with items, `'0'` only brands with none. */
  has_items?: string
}

export interface Uom extends AuditFields {
  unit_id: number
  unit_name: string
  unit_symbol: string | null
  print_name: string | null
  uqc_gst: string | null
  decimal_places: number
  is_active: number
  /**
   * Distinct items naming this unit — base, purchase, sales or an alternate
   * unit line. Counted live by the API on every read, never stored on the row,
   * and exactly what the delete guard refuses on.
   */
  usage_count?: number
  /**
   * `standard` when `uqc_gst` is a code the GST return schema knows, so the
   * unit is reportable as it stands; `custom` when it is not and has to be
   * mapped before filing. It is NOT a claim about who created the unit — the
   * table holds no provenance.
   */
  uom_type?: 'standard' | 'custom'
}

export interface WarehouseGroup extends AuditFields {
  warehouse_group_id: number
  grp_name: string
  /** Short handle, unique per company, upper-cased by the API. */
  grp_code: string | null
  description: string | null
  parent_grp_id: number | null
  is_active: number
  /** Warehouses naming this group. Decorated by the API, never counted here. */
  warehouse_count?: number
  /** Groups naming this one as their parent. */
  child_count?: number
  /** Member display name for `created_by`; null when the actor is not a member. */
  created_by_name?: string | null
  updated_by_name?: string | null
}

export type WarehouseType = 'standard' | 'transit' | 'damaged' | 'quarantine' | 'consignment' | 'job_worker' | 'virtual'
export const WAREHOUSE_TYPES: WarehouseType[] = ['standard', 'transit', 'damaged', 'quarantine', 'consignment', 'job_worker', 'virtual']

/** Floor-area units, mirroring WarehousesController::AREA_UNITS. */
export type AreaUnit = 'sq_ft' | 'sq_m' | 'sq_yd' | 'acre' | 'hectare'
export const AREA_UNITS: AreaUnit[] = ['sq_ft', 'sq_m', 'sq_yd', 'acre', 'hectare']

/** Short label for an area unit — what the card prints after the figure. */
export const AREA_UNIT_LABELS: Record<AreaUnit, string> = {
  sq_ft: 'Sq. Ft.',
  sq_m: 'Sq. M.',
  sq_yd: 'Sq. Yd.',
  acre: 'Acre',
  hectare: 'Hectare',
}

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
  /**
   * Operational ceiling in stock units, and the floor area beside it.
   *
   * All five are nullable and null means "the user has not set one" — never 0.
   * A warehouse with a 0-unit ceiling would read as permanently full, so every
   * screen tests for null and prints "Not configured" instead of dividing.
   */
  capacity_units: number | null
  area: number | null
  area_unit: AreaUnit | string | null
  latitude: number | null
  longitude: number | null
}

/** `GET /v1/warehouses/summary` — company-wide totals, computed in the database. */
export interface WarehouseSummary {
  total: number
  active: number
  inactive: number
  defaults: number
  capacity: {
    /** null when no warehouse has a capacity: there is no company ceiling to report. */
    units: number | null
    configured: number
    area: number | null
    area_configured: number
    area_by_unit: { unit: string; area: number; count: number }[]
  }
  geo: { with_coordinates: number }
  by_type: { warehouse_type: string; count: number; active: number }[]
  by_location: { country: string; state: string; city: string; count: number; active: number }[]
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

/** Where a batch is sitting, from the list's grouped balance query. */
export interface BatchWarehouseStock {
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
  on_hand: number
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
  item_grp_id?: number | null
  stock_cat_id?: number | null
  brand_id?: number | null
  /** The item's group and stock category, joined by the API for the list. */
  item_group_name?: string | null
  stock_category_name?: string | null
  unit_id?: number | null
  unit_symbol: string | null
  /** The unit's precision — what a quantity may be rounded to, never guessed. */
  decimal_places?: number | null
  stock?: StockSummary
  /** `with_stock=1` only: the warehouses holding it, biggest first. */
  warehouses?: BatchWarehouseStock[]
  warehouse_count?: number
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

/**
 * The three buckets the serial counters report in.
 *
 * Mirrors SerialsController::STATUS_GROUPS, and the list endpoint accepts a
 * group name wherever it accepts a status — which is what lets a KPI card be a
 * link to the list it counted.
 */
export type SerialStatusGroup = 'in_stock' | 'allocated' | 'out'
export const SERIAL_STATUS_GROUPS: Record<SerialStatusGroup, SerialStatus[]> = {
  in_stock: ['in_stock'],
  allocated: ['expected', 'reserved', 'in_transit'],
  out: ['issued', 'returned', 'damaged', 'scrapped'],
}

export type SerialWarrantyFilter = 'active' | 'expiring' | 'expired' | 'none'

/** Every parameter `GET /v1/serials` understands beyond the shared list ones. */
export interface SerialQuery extends ListQuery {
  status?: string
  item_id?: number | string
  warehouse_id?: number | string
  batch_id?: number | string
  location_id?: number | string
  item_grp_id?: number | string
  brand_id?: number | string
  stock_cat_id?: number | string
  warranty_status?: SerialWarrantyFilter | string
  /** Window for `warranty_status=expiring`, in days. */
  warranty_days?: number | string
  warranty_from?: string
  warranty_to?: string
  created_from?: string
  created_to?: string
  updated_from?: string
  updated_to?: string
  cost_min?: number | string
  cost_max?: number | string
  /** '1' only serials with a batch, '0' only those without. */
  has_batch?: string
  /** '1' only serials that have a warehouse, '0' only those without. */
  placed?: string
  q_mode?: 'contains' | 'prefix'
}

/**
 * The list envelope plus the two facts the table needs about the reader.
 *
 * `cost_visible` is the server's answer, not a client-side guess: when it is
 * false the rows arrive with no `unit_cost` key at all, and the table drops the
 * column rather than printing a row of dashes.
 */
export interface SerialListResponse extends ListResponse<Serial> {
  cost_visible?: boolean
  currency?: string
}

export interface SerialWarrantySummary {
  expired: number
  soon: number
  upcoming: number
  active: number
  none: number
  soon_days: number
  upcoming_days: number
}

/**
 * `GET /v1/serials/summary` — the counters, over the same filters as the list.
 *
 * `previous_total` is the only comparative the schema can honestly produce
 * (serials on record a month ago, by `created_at`). Status keeps no history, so
 * the three bucket cards carry no delta and the UI draws none.
 */
export interface SerialSummary {
  as_on: string
  currency: string
  cost_visible: boolean
  total: number
  previous_total: number | null
  previous_as_of: string | null
  by_status: Record<string, number>
  groups: Record<SerialStatusGroup, number>
  warranty: SerialWarrantySummary
  /** Sum of unit cost over in-stock serials; null when cost is withheld. */
  in_stock_value: number | null
  /** Held or in-process serials with no warehouse on them. */
  unplaced: number
}

export interface SerialHistoryAuditEvent {
  kind: 'audit'
  ref_id: number
  at: string
  action: string
  actor_uuid: string | null
  source_app: string | null
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface SerialHistoryDocumentEvent {
  kind: 'document'
  ref_id: number
  at: string
  recorded_at?: string | null
  document_id: number
  document_no: string | null
  document_type: string
  document_status: string
  direction: string | null
  qty: number | null
  warehouse_name: string | null
  dest_warehouse_name: string | null
  location_code: string | null
}

export type SerialHistoryEvent = SerialHistoryAuditEvent | SerialHistoryDocumentEvent

export interface SerialHistory {
  serial: Serial
  events: SerialHistoryEvent[]
}

export interface SerialBulkUpdateBody {
  serial_ids: number[]
  /** Absent key = leave alone. `null` = clear. */
  warehouse_id?: number | null
  location_id?: number | null
  batch_id?: number | null
  warranty_until?: string | null
}

export interface SerialBulkUpdateResult {
  updated: { serial_id: number; serial_no: string }[]
  failed: { serial_id: number; serial_no: string | null; reason: string }[]
  updated_count: number
  failed_count: number
  changed: string[]
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
/**
 * Brands carry two verbs the generic CRUD factory does not: the metrics strip
 * above the list, and a status flip that does not make the caller resend the
 * whole record. Same shape as `serialsApi` below — spread the factory, add what
 * is genuinely this master's own.
 */
const brandsCrud = crud<Brand>('brands')
export const brandsApi = {
  ...brandsCrud,
  async metrics(signal?: AbortSignal): Promise<BrandMetrics> {
    return (await api.get<ItemResponse<BrandMetrics>>('v1/brands/metrics', { signal })).data
  },
  /**
   * Activate / deactivate without restating the record.
   *
   * The API merges the body over the stored row, so sending only the flag
   * cannot blank a description that another tab edited a second ago.
   */
  setActive(id: number, active: boolean): Promise<Brand> {
    return brandsCrud.update(id, { is_active: active ? 1 : 0 })
  },
}
export const uomApi = crud<Uom>('uom')
export const warehouseGroupsApi = crud<WarehouseGroup>('warehouse-groups')
export const warehousesApi = {
  ...crud<Warehouse>('warehouses'),
  /**
   * The KPI strip's figures.
   *
   * Separate from `list()` on purpose: the list is paged, and adding up the
   * fifty rows on screen would report page 1 of 9's capacity as the company's.
   */
  async summary(signal?: AbortSignal): Promise<WarehouseSummary> {
    return (await api.get<ItemResponse<WarehouseSummary>>('v1/warehouses/summary', { signal })).data
  },
}
export const locationsApi = crud<Location>('locations')
export const bomApi = crud<Bom>('bill-of-materials')
export const batchesApi = crud<Batch>('batches')
export const serialsApi = {
  ...crud<Serial>('serials'),

  /**
   * The serial list, with the reader's cost visibility and currency alongside.
   *
   * Overrides the CRUD factory's `list` rather than wrapping it: every caller
   * on the serial workspace needs those two fields, and a second function that
   * returned them would leave the first one as a trap.
   */
  list: (query: SerialQuery = {}, signal?: AbortSignal): Promise<SerialListResponse> =>
    api.list<Serial>('v1/serials', query, { signal }) as Promise<SerialListResponse>,

  async summary(query: SerialQuery = {}, signal?: AbortSignal): Promise<SerialSummary> {
    const { page, limit, offset, sort, order, ...filters } = query
    void page
    void limit
    void offset
    void sort
    void order
    return (await api.get<ItemResponse<SerialSummary>>('v1/serials/summary', { query: filters, signal })).data
  },

  async history(id: number, signal?: AbortSignal): Promise<SerialHistory> {
    return (await api.get<ItemResponse<SerialHistory>>(`v1/serials/${id}/history`, { signal })).data
  },

  /**
   * Register many serials for one item.
   *
   * `serial_nos` takes a bare string or `{serial_no, warranty_until}` — an
   * imported file of units received on different days has a warranty date per
   * row, and one date forced across the file would be the import inventing
   * data. The top-level `warranty_until` is the default for rows that carry
   * none.
   */
  async bulkCreate(body: {
    item_id: number
    serial_nos: (string | { serial_no: string; warranty_until?: string | null })[]
    warehouse_id?: number | null
    batch_id?: number | null
    location_id?: number | null
    warranty_until?: string | null
  }): Promise<SerialBulkResult> {
    return (await api.post<ItemResponse<SerialBulkResult>>('v1/serials/bulk', body)).data
  },

  async bulkUpdate(body: SerialBulkUpdateBody): Promise<SerialBulkUpdateResult> {
    return (await api.post<ItemResponse<SerialBulkUpdateResult>>('v1/serials/bulk-update', body)).data
  },
}
