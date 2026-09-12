/** `GET /v1/pending-quantities/{id}` — one pending row (any status) with its settlement trail. */

import { api } from './api'
import type { ItemResponse } from './api'
import type { PendingKind } from './stockApi'

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

export interface PendingDetail {
  pending_id: number
  cmp_id: number
  fy_id: number
  document_id: number
  line_id: number | null
  pending_kind: PendingKind | string
  direction: 'in' | 'out' | string
  item_id: number
  item_name: string | null
  item_sku: string | null
  unit_id: number | null
  unit_symbol: string | null
  warehouse_id: number | null
  warehouse_name: string | null
  party_ref: number | null
  party_name: string | null
  qty_original: number
  qty_settled: number
  qty_open: number
  status: 'open' | 'partial' | 'settled' | 'cancelled' | string
  document_no: string | null
  document_date: string | null
  document_type: string
  document_type_label?: string
  document_status: string | null
  created_at?: string | null
  updated_at?: string | null
  settlements: PendingSettlement[]
}

export const pendingHistoryApi = {
  async get(pendingId: number, signal?: AbortSignal): Promise<PendingDetail> {
    const res = await api.get<ItemResponse<PendingDetail>>(`v1/pending-quantities/${pendingId}`, { signal })
    return res.data
  },
}
