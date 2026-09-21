/**
 * The Units of measure screen's API surface.
 *
 * CRUD still goes through `uomApi` in services/masters.ts — the same
 * MasterController contract every other master uses, unchanged. What lives here
 * is what only this screen asks for: the figures above the list, the items
 * behind a usage count, and the GST code catalogue the form offers.
 *
 * Every one of them is read live on demand. Nothing about items, companies,
 * branches or financial years is copied into the unit master to make this
 * screen quicker to draw.
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

export interface UomSummary {
  total: number
  active: number
  inactive: number
  /** Units whose GST UQC is a code a return accepts as it stands. */
  standard: number
  custom: number
  /** Units at least one item names. */
  used_in_items: number
  unused: number
  missing_uqc: number
  created_last_30d: number
  created_prev_30d: number
  active_rate: number
  inactive_rate: number
  usage_rate: number
}

/** How an item names the unit. An item can do so in more than one way. */
export type UomUsageRole = 'base' | 'purchase' | 'sales' | 'alternate'

export interface UomUsageItem {
  item_id: number
  item_uuid?: string | null
  item_name: string
  item_sku: string | null
  grp_name: string | null
  cat_name: string | null
  is_active: number
  roles: UomUsageRole[]
}

export interface UqcOption {
  code: string
  label: string
}

export const uomExtras = {
  summary(signal?: AbortSignal): Promise<UomSummary> {
    return api.get<ItemResponse<UomSummary>>('v1/uom/summary', { signal }).then((r) => r.data)
  },
  usage(unitId: number, query: ListQuery = {}, signal?: AbortSignal): Promise<ListResponse<UomUsageItem>> {
    return api.list<UomUsageItem>(`v1/uom/${unitId}/usage`, query, { signal })
  },
  uqcCodes(signal?: AbortSignal): Promise<UqcOption[]> {
    return api.get<ItemResponse<UqcOption[]>>('v1/uom/uqc-codes', { signal }).then((r) => r.data ?? [])
  },
}

export default uomExtras
