/**
 * Aicountly AI advisory endpoints for the document editors.
 *
 * Nothing here exists in server-php yet — no `v1/ai/*` route, no AI service of
 * any kind is wired into Inventory today (the topbar carries no "Ask AI"
 * either). This is the clean integration point a future Aicountly AI service
 * lands behind: the request/response shape a caller should expect, so the UI
 * can be built and reviewed now without inventing a fake backend for it.
 *
 * Every caller MUST treat a failure (404 included) as "suggestions are not
 * available right now" — quiet and non-blocking — never as a hard error. AI
 * output here is advisory only: it must never post a document or silently
 * change a saved value.
 */

import { api } from './api'
import type { ItemResponse } from './api'

export type SuggestionConfidence = 'low' | 'medium' | 'high'

export interface WriteOffReasonSuggestion {
  reason_code: string
  confidence: SuggestionConfidence
  remark: string | null
}

export interface SuggestWriteOffReasonRequest {
  description: string
  warehouseId?: number | null
}

export const aiApi = {
  async suggestWriteOffReason(req: SuggestWriteOffReasonRequest, signal?: AbortSignal): Promise<WriteOffReasonSuggestion> {
    const res = await api.post<ItemResponse<WriteOffReasonSuggestion>>(
      'v1/ai/write-off-reason-suggestions',
      { description: req.description, warehouse_id: req.warehouseId ?? undefined },
      { signal },
    )
    return res.data
  },
}
