/**
 * `/v1/batches` — the Batches workspace's read and bulk-write surface.
 *
 * The CRUD verbs already live in `services/masters.ts` (`batchesApi`, built by
 * the shared factory) and the create / edit form still goes through them. This
 * module adds what the workspace needs on top and nothing else: the filter
 * vocabulary the list understands, the server-counted figures above the table,
 * one batch with its per-warehouse balances, and the bulk status change.
 *
 * There is no second copy of the data anywhere. Every call here is a live
 * request scoped to the selected company / FY / branch by `services/api.ts`;
 * nothing is mirrored into another store, and nothing is cached across a
 * context switch (see `useQuery`'s `resetKey`).
 */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'
import type { Batch, BatchStatus } from './masters'

/**
 * Expiry health, derived by the API from the expiry date and the stored status.
 *
 * Deliberately NOT a column: it changes with the calendar, so a stored copy is
 * stale the next morning. The API computes it per request and the screen shows
 * what the API said.
 */
export type BatchHealth = 'active' | 'expiring' | 'expired' | 'inactive'

export const BATCH_HEALTH_STATES: readonly BatchHealth[] = ['active', 'expiring', 'expired', 'inactive']

/** One warehouse's slice of a batch, as returned per row by `with_stock=1`. */
export interface BatchWarehouseBalance {
  warehouse_id: number | null
  warehouse_name: string | null
  warehouse_code: string | null
  on_hand: number
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

/** `GET /v1/batches/{id}` — the row plus every bucket, warehouse by warehouse. */
export interface BatchDetail extends Batch {
  balances?: BatchWarehouseBalance[]
  stock?: { on_hand: number; available: number; reserved: number }
}

export interface BatchFilters extends ListQuery {
  item_id?: number | string
  item_grp_id?: number | string
  stock_cat_id?: number | string
  brand_id?: number | string
  /** Comma-separated; the stored statuses only. */
  status?: string
  /** Comma-separated; derived, see `BatchHealth`. */
  health?: string
  lot_no?: string
  expiry_from?: string
  expiry_to?: string
  mfg_from?: string
  mfg_to?: string
  /** `'1'` only batches that carry an expiry date, `'0'` only those without. */
  has_expiry?: string
  /** Rows: batches with a balance row in this warehouse. */
  in_warehouse_id?: number | string
  /** Figures: scopes on-hand to this warehouse. Never filters the rows. */
  warehouse_id?: number | string
  stock?: 'with' | 'zero' | ''
  with_stock?: number
  near_expiry_days?: number
}

/** Counts of the stored statuses, in the API's own vocabulary. */
export type BatchStatusCounts = Record<BatchStatus | string, number>

export interface BatchExpiryBuckets {
  expired: number
  within_30: number
  days_31_90: number
  days_91_180: number
  beyond_180: number
  no_expiry: number
}

/**
 * `GET /v1/batches/summary` — counted by the database over the whole filtered
 * set, never derived from the page on screen.
 *
 * `previous_total` is how many of the matching batches already existed
 * `comparison_days` ago, which is the only comparison this master can honestly
 * make: it grows by registration, so the difference is what was added since.
 */
export interface BatchSummary {
  total: number
  active: number
  expiring_soon: number
  expired: number
  inactive: number
  total_on_hand: number
  with_stock: number
  zero_stock: number
  previous_total: number
  comparison_days: number
  near_expiry_days: number
  by_status: BatchStatusCounts
  expiry_buckets: BatchExpiryBuckets
}

export interface BatchBulkResult {
  updated: number
  unchanged: number
  status: string
  batch_ids: number[]
}

/** Paging / ordering keys — meaningless to an aggregate, so they never travel. */
function withoutPaging(filters: BatchFilters): BatchFilters {
  const { page: _page, limit: _limit, offset: _offset, sort: _sort, order: _order, ...rest } = filters
  return rest
}

export const batchWorkspaceApi = {
  list(filters: BatchFilters = {}, signal?: AbortSignal): Promise<ListResponse<Batch>> {
    return api.list<Batch>('v1/batches', filters, { signal })
  },

  get(id: number, signal?: AbortSignal): Promise<BatchDetail> {
    return api.get<ItemResponse<BatchDetail>>(`v1/batches/${id}`, { signal }).then((r) => r.data)
  },

  summary(filters: BatchFilters = {}, signal?: AbortSignal): Promise<BatchSummary> {
    return api
      .get<ItemResponse<BatchSummary>>('v1/batches/summary', { query: withoutPaging(filters), signal })
      .then((r) => r.data)
  },

  /** One status across a selection. The server applies it in one transaction. */
  bulkStatus(batchIds: readonly number[], status: BatchStatus | string): Promise<BatchBulkResult> {
    return api
      .post<ItemResponse<BatchBulkResult>>('v1/batches/bulk-update', { batch_ids: [...batchIds], status })
      .then((r) => r.data)
  },
}

export { withoutPaging as batchSummaryFilters }
