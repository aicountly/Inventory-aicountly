/** `GET /v1/registers/summary` — the counters above the registers hub. */

import { api } from './api'
import type { ItemResponse } from './api'

/** Rows a master holds. `null` when the caller may not read that master. */
export interface RegisterMasterCount {
  total: number
  active: number
}

export interface RegisterMovementCount {
  count: number
  /** The window counted, already clipped to the financial year by the server. */
  from: string
  to: string
}

export interface RegisterStockValue {
  amount: number
  /**
   * The date the value belongs to — the last completed reconciliation, NOT
   * today. The strip prints it beside the figure; never present it without.
   */
  as_of: string
  source: string
}

/**
 * Every figure is nullable, and a null is not an error: it means the caller
 * does not hold the permission that governs it, or nothing has been recorded
 * yet. The strip prints an em dash and the registers stay open either way.
 */
export interface RegistersSummary {
  as_on: string
  fy: { from: string | null; to: string | null }
  /** The company's base currency — Aicountly is multi-currency, so it is asked for. */
  currency: string
  items: RegisterMasterCount | null
  warehouses: RegisterMasterCount | null
  locations: RegisterMasterCount | null
  movements: RegisterMovementCount | null
  stock_value: RegisterStockValue | null
}

export async function fetchRegistersSummary(signal?: AbortSignal): Promise<RegistersSummary> {
  const res = await api.get<ItemResponse<RegistersSummary>>('v1/registers/summary', { signal })
  return res.data
}
