/** `GET /v1/pending-quantities/{id}` — one pending row (any status) with its settlement trail. */

import { api } from './api'
import type { ItemResponse } from './api'
import type { PendingPolicy, PendingRow } from './stockApi'

export interface PendingSettlement {
  settlement_id: number
  settle_document_id: number
  settle_line_id: number | null
  settlement_type: 'consumed' | 'returned' | string | null
  qty_settled: number
  created_at: string | null
  document_no: string | null
  document_type: string | null
  document_type_label?: string | null
  document_date: string | null
  document_status: string | null
  source_app: string | null
  source_document_no: string | null
}

/**
 * The drawer's row.
 *
 * Deliberately `PendingRow` plus the trail rather than a parallel shape: the
 * endpoint answers it from the same SQL the table is built from, so a line's
 * ageing, status and priority read identically in the drawer and in the row it
 * was opened from. A second declaration here would be a second set of rules
 * waiting to drift.
 *
 * `Partial` on the derived half is not laziness — a pending line whose document
 * was deleted outright rather than reversed cannot carry a document date, and the
 * endpoint falls back to the plain row for it. The drawer renders what is there.
 */
export interface PendingDetail extends Omit<PendingRow, 'status' | 'priority'>, Partial<Pick<PendingRow, 'status' | 'priority'>> {
  settlements: PendingSettlement[]
  policy?: PendingPolicy
}

export const pendingHistoryApi = {
  async get(pendingId: number, signal?: AbortSignal): Promise<PendingDetail> {
    const res = await api.get<ItemResponse<PendingDetail>>(`v1/pending-quantities/${pendingId}`, { signal })
    return res.data
  },
}
