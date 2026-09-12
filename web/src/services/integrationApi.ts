/** `/v1/integration/outbox` — Inventory → Books events awaiting delivery, replay and dispatch. */

import { api } from './api'
import type { ItemResponse, ListQuery, ListResponse } from './api'

export type OutboxStatus = 'PENDING' | 'SENT' | 'ACKED' | 'FAILED' | 'DEAD'
export const OUTBOX_STATUSES: OutboxStatus[] = ['PENDING', 'SENT', 'ACKED', 'FAILED', 'DEAD']

export interface OutboxEvent {
  event_id: number
  event_uuid: string
  cmp_id: number
  target_app: string
  event_type: string
  aggregate_type: string
  aggregate_id: number
  aggregate_uuid: string | null
  status: OutboxStatus | string
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  sent_at: string | null
  acked_at: string | null
  created_at: string
  /** Present when the list was asked for `with_payload=1` or after a replay. */
  payload?: unknown
}

export interface OutboxFilters extends ListQuery {
  status?: string
  event_type?: string
  aggregate_type?: string
  aggregate_id?: number | string
  target_app?: string
  from?: string
  to?: string
  with_payload?: boolean | number | string
}

export interface DispatchResult {
  sent: number
  failed: number
  dead: number
  skipped: number
  limit: number
}

export const integrationApi = {
  outbox(filters: OutboxFilters = {}, signal?: AbortSignal): Promise<ListResponse<OutboxEvent>> {
    return api.list<OutboxEvent>('v1/integration/outbox', filters, { signal })
  },

  async replay(eventId: number): Promise<OutboxEvent> {
    const res = await api.post<ItemResponse<OutboxEvent>>(`v1/integration/outbox/${eventId}/replay`, {})
    return res.data
  },

  async dispatch(limit = 100): Promise<DispatchResult> {
    const res = await api.post<ItemResponse<DispatchResult>>('v1/integration/outbox/dispatch', { limit })
    return res.data
  },
}
