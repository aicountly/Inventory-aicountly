/**
 * Aicountly AI for disassembly — the integration point, not an implementation.
 *
 * ## Why this file exists and contains no model call
 *
 * The screen offers an assistant strip and an "Auto-fill components" action. Both must do
 * something real or say plainly that they cannot. Inventory has no assistant endpoint today, and
 * writing one that returns invented components would be the worst possible outcome: a suggestion
 * the user cannot tell apart from a bill of materials, posted into stock. So the assistant is
 * declared here as an interface with a single not-configured implementation, every caller asks
 * `available` first, and the server-dependent action stays visibly disabled with the reason
 * attached. Everything the strip can answer WITHOUT a model — availability, the BOM, batch and
 * serial state, costing — is computed in `insights.ts` and shown regardless.
 *
 * ## The backend contract, when it is built
 *
 * `POST /v1/assist/disassembly-components`
 *   request  { item_id, warehouse_id, qty, unit_id, document_date }
 *   response { data: { suggestions: [{ item_id, qty, unit_id, confidence, rationale, source }],
 *                      source: 'bom' | 'history' | 'model', model?: string } }
 *   auth     the caller's session; the same `documents.disassembly.create` gate as the screen
 *   rules    suggestions are advisory. The server must never post from this call, and every row
 *            it returns must name a real item_id in the caller's company.
 *
 * Wire it by replacing `notConfigured` below with a client built on `services/api.ts`; nothing in
 * the screen changes, because every call site already handles `available === false`.
 */

export interface ComponentSuggestion {
  item_id: number
  item_name?: string | null
  item_sku?: string | null
  qty: number
  unit_id?: number | null
  /** 0–1. Shown to the user; never used to auto-accept. */
  confidence?: number
  rationale?: string
  source?: 'bom' | 'history' | 'model'
}

export interface SuggestComponentsRequest {
  item_id: number
  warehouse_id: number | null
  qty: number
  unit_id: number | null
  document_date: string
}

export interface DisassemblyAssistant {
  /** False until an assistant endpoint is configured; callers must check before offering it. */
  readonly available: boolean
  /** Sentence shown where the action would have been. Empty when available. */
  readonly unavailableReason: string
  suggestComponents(request: SuggestComponentsRequest, signal?: AbortSignal): Promise<ComponentSuggestion[]>
}

const notConfigured: DisassemblyAssistant = {
  available: false,
  unavailableReason:
    'The Aicountly AI service is not connected to Inventory yet, so components cannot be suggested by a model. Everything below is computed from this document and your live stock.',
  async suggestComponents() {
    throw new Error('The Aicountly AI service is not configured for Inventory.')
  },
}

export function getDisassemblyAssistant(): DisassemblyAssistant {
  return notConfigured
}
