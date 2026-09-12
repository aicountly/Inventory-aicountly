/** `GET /v1/dashboard` — company / FY / branch overview counters. */

import { api } from './api'
import type { ItemResponse } from './api'

export interface DashboardCounts {
  total: number
  active: number
}

export interface DashboardReconciliationRun {
  run_id: number
  run_uuid?: string
  as_of_date: string
  inventory_closing_value: number | string | null
  inventory_closing_qty: number | string | null
  books_stock_ledger_balance: number | string | null
  difference: number | string | null
  status: string
  requested_by?: string | null
  created_at: string
}

export interface DashboardData {
  as_of: string
  fy_id: number
  bo_id: number
  masters: {
    items: DashboardCounts
    warehouses: DashboardCounts
  }
  documents: {
    total: number
    by_status: Record<string, number>
    pending_approval: number
    failed: number
    posted_by_type: Record<string, number>
  }
  stock: {
    negative_stock_items: number
    negative_stock_warehouse_rows: number
    near_expiry_batches: number
    expired_batches: number
    near_expiry_days: number
    pending_quantities: Record<string, number>
  }
  integration: {
    outbox: Record<string, number>
    outbox_pending: number
    outbox_failed: number
    inbound: Record<string, number>
    unacknowledged_revisions: { count: number; delta_total: number }
    recalculations_in_progress: number
  }
  last_reconciliation: DashboardReconciliationRun | null
}

export async function fetchDashboard(nearExpiryDays: number, signal?: AbortSignal): Promise<DashboardData> {
  const res = await api.get<ItemResponse<DashboardData>>('v1/dashboard', { signal, query: { near_expiry_days: nearExpiryDays } })
  return res.data
}
