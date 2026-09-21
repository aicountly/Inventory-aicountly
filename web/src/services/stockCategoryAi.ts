/**
 * The Aicountly AI adapter for the stock-category panel.
 *
 * Inventory has no AI endpoint today. This is the seam where one plugs in, and
 * until it does the honest answer is the one the panel shows: not connected.
 *
 * The rule the panel is built on is that an empty state is cheap and a made-up
 * insight is not. A model that suggests merging two categories is proposing a
 * change to master data every valuation report reads, so a placeholder that
 * "looks like" analysis would be indistinguishable from the real thing at
 * exactly the moment somebody acts on it. `analyseStockCategories` therefore
 * returns `{ connected: false }` rather than sample findings, and the panel
 * says so in words.
 *
 * Wiring it up later is one environment variable plus a real endpoint: set
 * `VITE_INVENTORY_AI_PATH` — the SAME variable the other masters' AI panels
 * read (`masters/warehouseGroups/warehouseGroupsAi.ts`, `services/uomAiApi.ts`)
 * — and the CTA starts calling it. One seam for one service: two names for one
 * endpoint is how half the screens end up connected and the other half quietly
 * are not. The response is read defensively — anything that is not a
 * well-formed finding is dropped, because a half-parsed model response is the
 * same problem as a fabricated one.
 *
 * The deterministic checks the panel can always run (duplicate names, unused
 * categories, alias collisions) are NOT here: they live in
 * `pages/masters/stockCategories/categoryReview.ts`, are computed from the
 * company's own rows, and are never labelled AI.
 */

import { api } from './api'
import type { ItemResponse } from './api'

const CONFIGURED_PATH = (import.meta.env.VITE_INVENTORY_AI_PATH ?? '').trim().replace(/^\/+/, '')

export type AiFindingSeverity = 'warning' | 'info'

export interface AiFinding {
  id: string
  title: string
  detail: string
  severity: AiFindingSeverity
  /** Categories the finding is about, when the service names them. */
  categoryIds: number[]
}

export type AiAnalysis =
  | { connected: false }
  | { connected: true; findings: AiFinding[]; summary: string | null }

/** Whether an AI endpoint is configured for this build at all. */
export function isCategoryAiConnected(): boolean {
  return CONFIGURED_PATH !== ''
}

interface RawFinding {
  id?: unknown
  title?: unknown
  detail?: unknown
  description?: unknown
  severity?: unknown
  category_ids?: unknown
}

function toFinding(raw: RawFinding, index: number): AiFinding | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title === '') return null
  const detailRaw = typeof raw.detail === 'string' ? raw.detail : typeof raw.description === 'string' ? raw.description : ''
  const ids = Array.isArray(raw.category_ids)
    ? raw.category_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : []
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `ai-${index}`,
    title,
    detail: detailRaw.trim(),
    severity: raw.severity === 'warning' ? 'warning' : 'info',
    categoryIds: ids,
  }
}

/**
 * Ask the configured service to look at this company's categories.
 *
 * Throws on a transport or API error so the caller can show the reason —
 * a connected service that failed is a different state from no service, and
 * collapsing the two would hide an outage behind "not connected yet".
 */
export async function analyseStockCategories(signal?: AbortSignal): Promise<AiAnalysis> {
  if (CONFIGURED_PATH === '') return { connected: false }

  const res = await api.post<ItemResponse<{ findings?: unknown; summary?: unknown }>>(
    CONFIGURED_PATH,
    {},
    { signal },
  )
  const data = res.data ?? {}
  const findings = Array.isArray(data.findings)
    ? data.findings
        .map((raw, i) => toFinding((raw ?? {}) as RawFinding, i))
        .filter((f): f is AiFinding => f !== null)
    : []

  return {
    connected: true,
    findings,
    summary: typeof data.summary === 'string' && data.summary.trim() !== '' ? data.summary.trim() : null,
  }
}
