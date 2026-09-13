/** `/v1/items` — the item master, its unit lines, openings and dropdown options. */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'
import type { StockSummary } from './masters'

export type ItemType = 'stock' | 'service' | 'non_stock'
export const ITEM_TYPES: ItemType[] = ['stock', 'service', 'non_stock']

export type UomRole = 'base' | 'purchase' | 'sales' | 'packaging'
export const UOM_ROLES: UomRole[] = ['base', 'purchase', 'sales', 'packaging']

export interface ItemUnitLine {
  unit_id: number
  is_default: number
  /** How many BASE units make 1 of this unit (Box = 12 Pcs → 12 on the Box row). */
  conversion_factor: number
  uom_role: UomRole | string | null
  unit_symbol?: string | null
  unit_name?: string | null
}

export interface ItemOpening {
  opening_id?: number
  fy_id: number
  warehouse_id: number | null
  unit_id: number
  batch_id: number | null
  opening_qty: number | string
  opening_valuation_rate: number | string
  opening_value?: number | string
  source_kind?: string
  warehouse_name?: string | null
  unit_symbol?: string | null
}

export interface ItemOpeningsResponse {
  rows: ItemOpening[]
  /** FY whose carried-forward rows are in force; 0 = inception opening applies. */
  effective_fy_id: number
  carried_forward: boolean
}

export interface ItemListRow {
  item_id: number
  item_uuid?: string
  item_name: string
  item_alias: string | null
  print_name: string | null
  item_type: ItemType | string
  item_sku: string | null
  item_upc: string | null
  hsn_sac: string | null
  mrp: number | string | null
  unit_id: number | null
  stock_cat_id: number | null
  item_grp_id: number | null
  brand_id: number | null
  valuation_method: string
  track_batch: number
  track_serial: number
  track_expiry: number
  is_active: number
  updated_at: string | null
  created_at: string | null
  unit_symbol: string | null
  unit_name: string | null
  grp_name: string | null
  cat_name: string | null
  brand_name: string | null
  stock?: StockSummary
}

export interface Item extends ItemListRow {
  purchase_unit_id: number | null
  sales_unit_id: number | null
  parent_item_id: number | null
  books_sales_acc_id: number | null
  books_purchase_acc_id: number | null
  books_tax_cat_id: number | null
  shelf_life_days: number | null
  negative_stock_policy: string | null
  min_stock_qty: number | string | null
  max_stock_qty: number | string | null
  reorder_point_qty: number | string | null
  reorder_qty: number | string | null
  safety_stock_qty: number | string | null
  lead_time_days: number | null
  default_warehouse_id: number | null
  standard_cost: number | string | null
  version?: number
  attributes: Record<string, unknown> | null
  variant_attributes: Record<string, unknown> | null
  unit_lines: ItemUnitLine[]
  openings: ItemOpening[]
}

export interface ItemSearchRow {
  item_id: number
  item_name: string
  item_alias: string | null
  print_name: string | null
  item_sku: string | null
  item_upc: string | null
  hsn_sac: string | null
  unit_id: number | null
  unit_symbol: string | null
  track_batch: number
  track_serial: number
  valuation_method: string
  default_warehouse_id: number | null
  units?: ItemUnitLine[]
  stock?: StockSummary
}

export interface FormOptionGroup {
  item_grp_id: number
  grp_name: string
  grp_alias: string | null
  is_primary: number
  parent_grp_id: number | null
}
export interface FormOptionCategory {
  stock_cat_id: number
  cat_name: string
  cat_alias: string | null
}
export interface FormOptionBrand {
  brand_id: number
  brand_name: string
}
export interface FormOptionUnit {
  unit_id: number
  unit_name: string
  unit_symbol: string | null
  print_name: string | null
  uqc_gst: string | null
}
export interface FormOptionWarehouse {
  warehouse_id: number
  warehouse_name: string
  warehouse_code: string | null
  warehouse_type: string
  is_default: number
  bo_id: number
}

export interface ItemFormOptions {
  item_groups: FormOptionGroup[]
  stock_categories: FormOptionCategory[]
  brands: FormOptionBrand[]
  units: FormOptionUnit[]
  warehouses: FormOptionWarehouse[]
  valuation_methods: string[]
  default_valuation_method: string
  negative_stock_policies: string[]
}

export async function fetchItemFormOptions(signal?: AbortSignal): Promise<ItemFormOptions> {
  const res = await api.get<ItemResponse<Partial<ItemFormOptions>>>('v1/items/form-options', { signal })
  const d = res.data ?? {}
  return {
    item_groups: d.item_groups ?? [],
    stock_categories: d.stock_categories ?? [],
    brands: d.brands ?? [],
    units: d.units ?? [],
    warehouses: d.warehouses ?? [],
    valuation_methods: d.valuation_methods ?? ['FIFO', 'LIFO', 'WAC'],
    default_valuation_method: d.default_valuation_method ?? 'FIFO',
    negative_stock_policies: d.negative_stock_policies ?? ['allow', 'warn', 'block'],
  }
}

export interface ItemListQuery extends ListQuery {
  status?: 'active' | 'inactive' | ''
  item_grp_id?: number | ''
  stock_cat_id?: number | ''
  brand_id?: number | ''
  unit_id?: number | ''
  item_type?: ItemType | ''
  with_stock?: boolean
  warehouse_id?: number | ''
}

/** Fields POST /v1/items/bulk-update accepts. Units and the valuation method are deliberately absent. */
export const BULK_EDITABLE_FIELDS = [
  'hsn_sac',
  'mrp',
  'item_alias',
  'print_name',
  'item_grp_id',
  'stock_cat_id',
  'brand_id',
  'books_tax_cat_id',
  'min_stock_qty',
  'max_stock_qty',
  'reorder_point_qty',
  'reorder_qty',
  'is_active',
] as const

export type BulkEditableField = (typeof BULK_EDITABLE_FIELDS)[number]

export interface BulkUpdateRow extends Partial<Record<BulkEditableField, string | number | null>> {
  item_id: number
}

export interface BulkUpdateResult {
  updated: number
  rows: { item_id: number; changed: string[] }[]
}

export const itemsApi = {
  list: (query: ItemListQuery = {}, signal?: AbortSignal) => api.list<ItemListRow>('v1/items', query, { signal }),
  get: async (id: number, signal?: AbortSignal) => (await api.get<ItemResponse<Item>>(`v1/items/${id}`, { signal })).data,
  create: async (body: Record<string, unknown>) => (await api.post<ItemResponse<Item>>('v1/items', body)).data,
  update: async (id: number, body: Record<string, unknown>) => (await api.put<ItemResponse<Item>>(`v1/items/${id}`, body)).data,
  remove: async (id: number) => {
    await api.delete<unknown>(`v1/items/${id}`)
  },
  search: async (q: string, limit = 20, signal?: AbortSignal): Promise<ItemSearchRow[]> => {
    const res = await api.get<ItemResponse<ItemSearchRow[]>>('v1/items/search', { signal, query: { q, limit } })
    return Array.isArray(res.data) ? res.data : []
  },
  /** One field across many items, in a single all-or-nothing transaction. */
  bulkUpdate: async (rows: BulkUpdateRow[]): Promise<BulkUpdateResult> =>
    (await api.post<ItemResponse<BulkUpdateResult>>('v1/items/bulk-update', { rows })).data,
  openings: async (id: number, signal?: AbortSignal) => (await api.get<ItemResponse<ItemOpeningsResponse>>(`v1/items/${id}/openings`, { signal })).data,
  saveOpenings: async (id: number, fyId: number, rows: Partial<ItemOpening>[]) =>
    (await api.put<ItemResponse<ItemOpeningsResponse>>(`v1/items/${id}/openings`, { fy_id: fyId, rows })).data,
}

export type ItemsListResponse = ListResponse<ItemListRow>
