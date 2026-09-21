/**
 * The Aicountly AI adapter for warehouse grouping.
 *
 * Inventory has no AI endpoint today. This module is the single seam where one
 * will attach, and until it does it says so plainly rather than producing
 * something that looks like an answer:
 *
 *  - `warehouseGroupsAi.configured` is false unless a build sets
 *    `VITE_INVENTORY_AI_PATH` to the API path that answers suggestions. The
 *    panel reads that flag and offers the feature as not yet connected.
 *  - There is no canned reply anywhere in this file. A hard-coded paragraph
 *    dressed as a model's output is a lie about where the words came from, and
 *    the reader has no way to tell. The deterministic findings the panel *can*
 *    stand behind are counted in model.ts and labelled Insights.
 *  - Nothing here is on the path to managing warehouse groups. Create, edit,
 *    search, delete and every figure on the screen work with this module
 *    switched off, which is the whole reason it is a separate module.
 *
 * The request carries the shape of the company's warehouse estate — counts and
 * names of groups and warehouses — because that is what a grouping suggestion
 * has to reason about. It goes to Inventory's own API under the caller's
 * session, like every other call in this app; it is not sent to a third party
 * from the browser.
 */

import { api } from '../../services/api'
import type { ItemResponse } from '../../services/api'
import type { Warehouse, WarehouseGroup } from '../../services/masters'

const CONFIGURED_PATH = (import.meta.env.VITE_INVENTORY_AI_PATH ?? '').trim().replace(/^\/+/, '')

/** Thrown instead of calling a path that does not exist. */
export class AiUnavailableError extends Error {
  constructor() {
    super('AI suggestions will be available when the Aicountly AI service is connected.')
    this.name = 'AiUnavailableError'
  }
}

export interface AiSuggestedGroup {
  name: string
  code?: string | null
  rationale?: string | null
  warehouses?: string[] | null
}

export interface AiSuggestion {
  headline: string
  body: string
  groups?: AiSuggestedGroup[] | null
}

export interface AiSuggestionRequest {
  prompt: string
  groups: { name: string; code: string | null; warehouses: number; active: boolean }[]
  warehouses: { name: string; code: string | null; grouped: boolean }[] | null
}

/** The estate, reduced to what a grouping question needs and nothing else. */
export function buildSuggestionRequest(
  prompt: string,
  groups: readonly WarehouseGroup[],
  warehouses: readonly Warehouse[] | null,
): AiSuggestionRequest {
  return {
    prompt,
    groups: groups.map((g) => ({
      name: g.grp_name,
      code: g.grp_code ?? null,
      warehouses: Number(g.warehouse_count ?? 0) || 0,
      active: Number(g.is_active) === 1,
    })),
    warehouses:
      warehouses?.map((w) => ({
        name: w.warehouse_name,
        code: w.warehouse_code ?? null,
        grouped: Boolean(w.warehouse_group_id),
      })) ?? null,
  }
}

export const warehouseGroupsAi = {
  /** False until a build points VITE_INVENTORY_AI_PATH at a live endpoint. */
  configured: CONFIGURED_PATH !== '',

  async suggest(request: AiSuggestionRequest, signal?: AbortSignal): Promise<AiSuggestion> {
    if (CONFIGURED_PATH === '') throw new AiUnavailableError()
    const res = await api.post<ItemResponse<AiSuggestion>>(CONFIGURED_PATH, request, { signal })
    const data = res?.data
    if (!data || typeof data.headline !== 'string' || typeof data.body !== 'string') {
      throw new Error('The AI service returned an answer this screen could not read.')
    }
    return { headline: data.headline, body: data.body, groups: Array.isArray(data.groups) ? data.groups : null }
  },
}
