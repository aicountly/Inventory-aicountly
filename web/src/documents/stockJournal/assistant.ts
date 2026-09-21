/**
 * The Stock Journal assistant: plain English in, draft lines out.
 *
 * ## What this is, and what it is not
 *
 * Inventory has no assistant endpoint today — there is no AI route in
 * `Config/Routes.php` and no model credentials anywhere in the API. Rather than
 * ship a screen that pretends to call one, this module is the seam:
 *
 *   - `requestSuggestions` posts to the endpoint `VITE_INVENTORY_AI_PATH` names,
 *     the SAME variable the masters' AI panels read (services/uomAiApi.ts,
 *     services/stockCategoryAi.ts, masters/warehouseGroups/warehouseGroupsAi.ts).
 *     One seam for one service: a second flag is how half the screens end up
 *     connected and the other half quietly are not.
 *   - `parsePrompt` / `suggestLocally` are a deterministic, on-device parser used
 *     until that endpoint exists.
 *
 * The local parser is not a language model and does not claim to be: it reads a
 * small, documented grammar ("transfer 10 of ABC from Main to Store 2"), and the
 * items and warehouses it names are resolved through the real Inventory APIs by
 * the caller. Every suggestion it returns is a *draft* — the screen marks each
 * generated row as needing review, the rows stay fully editable, they go through
 * the same validation as typed rows, and nothing is ever posted automatically.
 */

import { api, isApiError } from '../../services/api'
import type { ItemResponse } from '../../services/api'
import type { FormOptionWarehouse } from '../../services/items'
import type { ItemSearchRow } from '../../services/lookupApi'
import { toNumber } from '../../utils/format'

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

export interface AssistRequest {
  prompt: string
  default_warehouse_id: number | null
  document_date: string
}

export interface AssistSuggestion {
  item_id: number | null
  /** Echoed back when the item could not be resolved, so the row can still be shown. */
  item_hint?: string | null
  warehouse_id: number | null
  batch_id: number | null
  serial_ids: number[]
  direction: 'in' | 'out'
  quantity: number
  rate: number | null
  remarks: string | null
}

export interface AssistResponse {
  suggestions: AssistSuggestion[]
  warnings: string[]
  /** Where the draft came from, for the label the user sees. */
  source: 'server' | 'device'
}

/** Thrown when the deployment has no assistant endpoint. Callers fall back. */
export class AssistUnavailableError extends Error {
  constructor(message = 'No assistant endpoint is configured for this deployment.') {
    super(message)
    this.name = 'AssistUnavailableError'
  }
}

// The one Aicountly AI seam, read exactly as the masters' panels read it.
const ASSISTANT_PATH = (import.meta.env.VITE_INVENTORY_AI_PATH ?? '').trim().replace(/^\/+/, '')

/**
 * Whether a server-side assistant is configured. Off unless a build points
 * VITE_INVENTORY_AI_PATH at a live endpoint, so a deployment without one never
 * fires a request that 404s.
 */
export function serverAssistEnabled(): boolean {
  return ASSISTANT_PATH !== ''
}

/**
 * Ask the service, in the shape it is already asked everywhere else:
 * `{ message, context }` (services/uomAiApi.ts `askAssistant`).
 *
 * Company, branch and financial year are NOT in the body: the API client puts
 * the active scope on every request (`services/api.ts` `setActiveScope`) and the
 * server trusts its own session over anything the browser sends, which is the
 * rule every other call here follows.
 */
export async function requestSuggestions(body: AssistRequest, signal?: AbortSignal): Promise<AssistResponse> {
  if (!serverAssistEnabled()) throw new AssistUnavailableError()
  const payload = {
    message: body.prompt,
    context: {
      intent: 'stock_journal_lines',
      document_type: 'STOCK_JOURNAL',
      default_warehouse_id: body.default_warehouse_id,
      document_date: body.document_date,
    },
  }
  try {
    const res = await api.post<ItemResponse<{ suggestions?: AssistSuggestion[]; warnings?: string[] }>>(ASSISTANT_PATH, payload, { signal })
    // A general-purpose assistant may answer something that is not a set of
    // lines. Without suggestions there is nothing to put on the grid, and
    // inventing some would be worse than saying so.
    const suggestions = res.data?.suggestions ?? []
    if (suggestions.length === 0 && !(res.data?.warnings?.length)) throw new AssistUnavailableError()
    return { suggestions, warnings: res.data?.warnings ?? [], source: 'server' }
  } catch (err) {
    if (err instanceof AssistUnavailableError) throw err
    if (isApiError(err) && (err.status === 404 || err.status === 405 || err.status === 501)) {
      throw new AssistUnavailableError()
    }
    throw err
  }
}

/* -------------------------------------------------------------------------- */
/* The on-device grammar                                                      */
/* -------------------------------------------------------------------------- */

export interface AssistClause {
  /** `transfer` becomes two lines: one out of `fromWarehouse`, one into `toWarehouse`. */
  kind: 'transfer' | 'in' | 'out'
  quantity: number
  itemText: string
  fromWarehouse: string | null
  toWarehouse: string | null
  remarks: string | null
}

const OUT_VERBS = ['write off', 'write-off', 'issue', 'remove', 'scrap', 'damage', 'consume', 'take out', 'reduce', 'deduct', 'out']
const IN_VERBS = ['receive', 'add', 'bring in', 'book in', 'found', 'return', 'increase', 'put in', 'in']
const TRANSFER_VERBS = ['transfer', 'move', 'shift']

/** Sentence separators: a prompt may describe several movements at once. */
function clauses(prompt: string): string[] {
  return prompt
    .replace(/\r\n?/g, '\n')
    .split(/[\n;.]+|\band then\b|\balso\b|\band\b(?=\s+(?:transfer|move|shift|write|issue|remove|scrap|receive|add|book|return)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

function firstVerb(text: string, verbs: readonly string[]): { verb: string; at: number } | null {
  let best: { verb: string; at: number } | null = null
  for (const verb of verbs) {
    const at = text.search(new RegExp(`\\b${verb.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i'))
    if (at >= 0 && (best === null || at < best.at)) best = { verb, at }
  }
  return best
}

const QTY = /(-?\d+(?:[.,]\d+)?)\s*(?:nos?|units?|pcs?|pieces?|kg|kgs|gm|grams?|ltr|litres?|boxes?|cartons?)?\b/i

/**
 * Read one clause into a movement.
 *
 * The grammar is small and stated plainly in the placeholder the user sees:
 *   `<verb> <qty> [unit] of <item> [from <warehouse>] [to <warehouse>] [due to <reason>]`
 * Anything it cannot read returns null, and the screen says so rather than
 * guessing — a wrong guess here becomes a stock movement.
 */
export function parseClause(text: string): AssistClause | null {
  const clean = text.trim()
  if (!clean) return null

  const transfer = firstVerb(clean, TRANSFER_VERBS)
  const outVerb = firstVerb(clean, OUT_VERBS)
  const inVerb = firstVerb(clean, IN_VERBS)

  const qtyMatch = QTY.exec(clean)
  if (!qtyMatch) return null
  const quantity = toNumber(qtyMatch[1].replace(',', '.'))
  if (quantity === null || quantity <= 0) return null

  // Remarks: everything after "due to" / "because of" / "reason:".
  let remarks: string | null = null
  let body = clean
  const reasonMatch = /\b(?:due to|because of|because|reason:?|owing to)\b\s*(.+)$/i.exec(body)
  if (reasonMatch) {
    remarks = reasonMatch[1].trim().replace(/[.,;]$/, '') || null
    body = body.slice(0, reasonMatch.index).trim()
  }

  // Warehouses.
  const fromMatch = /\bfrom\s+(.+?)(?=\s+\bto\b|\s+\bdue\b|\s+\bbecause\b|$)/i.exec(body)
  const toMatch = /\bto\s+(.+?)(?=\s+\bfrom\b|\s+\bdue\b|\s+\bbecause\b|$)/i.exec(body)
  const fromWarehouse = fromMatch ? tidy(fromMatch[1]) : null
  const toWarehouse = toMatch ? tidy(toMatch[1]) : null

  // The item: after "of" when it is there, otherwise whatever sits between the
  // quantity and the first from/to/due.
  let itemText = ''
  const ofMatch = /\bof\s+(.+?)(?=\s+\bfrom\b|\s+\bto\b|\s+\bdue\b|\s+\bbecause\b|$)/i.exec(body)
  if (ofMatch) {
    itemText = tidy(ofMatch[1])
  } else {
    const after = body.slice(qtyMatch.index + qtyMatch[0].length)
    const cut = after.search(/\b(?:from|to|due|because)\b/i)
    itemText = tidy(cut >= 0 ? after.slice(0, cut) : after)
  }
  if (!itemText) return null

  let kind: AssistClause['kind']
  if (transfer && (fromWarehouse || toWarehouse)) kind = 'transfer'
  else if (outVerb && (!inVerb || outVerb.at <= inVerb.at)) kind = 'out'
  else if (inVerb) kind = 'in'
  else if (toWarehouse && !fromWarehouse) kind = 'in'
  else kind = 'out'

  return { kind, quantity, itemText, fromWarehouse, toWarehouse, remarks }
}

function tidy(value: string): string {
  // "the"/"a"/"an" are never part of a name; "item" often is ("Item ABC"), so it
  // stays — the search is fuzzy, and dropping a real word loses the match.
  return value
    .trim()
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:warehouse|store|godown)$/i, '')
    .replace(/[.,;]$/, '')
    .trim()
}

export function parsePrompt(prompt: string): AssistClause[] {
  return clauses(prompt)
    .map(parseClause)
    .filter((c): c is AssistClause => c !== null)
}

/* -------------------------------------------------------------------------- */
/* Turning clauses into suggestions                                           */
/* -------------------------------------------------------------------------- */

export interface LocalAssistContext {
  warehouses: readonly FormOptionWarehouse[]
  defaultWarehouseId: number | null
  /** Resolves an item phrase through `GET /v1/items/search` — injected so this stays testable. */
  findItem: (text: string, signal?: AbortSignal) => Promise<ItemSearchRow | null>
}

function matchWarehouse(name: string | null, warehouses: readonly FormOptionWarehouse[]): FormOptionWarehouse | null {
  if (!name) return null
  const n = name.trim().toLowerCase()
  if (!n) return null
  return (
    warehouses.find((w) => w.warehouse_name.toLowerCase() === n) ??
    warehouses.find((w) => w.warehouse_code?.toLowerCase() === n) ??
    warehouses.find((w) => w.warehouse_name.toLowerCase().includes(n)) ??
    null
  )
}

/**
 * Run the grammar and resolve what it named against the real masters.
 *
 * Whatever cannot be resolved becomes a warning, never a silent omission: a
 * prompt naming an item that does not exist must say so, or the user posts a
 * journal that is missing a line they believe they asked for.
 */
export async function suggestLocally(prompt: string, ctx: LocalAssistContext, signal?: AbortSignal): Promise<AssistResponse> {
  const parsed = parsePrompt(prompt)
  const warnings: string[] = []
  const suggestions: AssistSuggestion[] = []

  if (parsed.length === 0) {
    return {
      suggestions: [],
      warnings: ['Could not read that. Try: "Transfer 10 units of ABC from Main to Store 2 due to damage".'],
      source: 'device',
    }
  }

  for (const clause of parsed) {
    const item = await ctx.findItem(clause.itemText, signal)
    if (!item) {
      warnings.push(`No item found for “${clause.itemText}”. Add that line by hand.`)
      continue
    }

    const from = matchWarehouse(clause.fromWarehouse, ctx.warehouses)
    const to = matchWarehouse(clause.toWarehouse, ctx.warehouses)
    if (clause.fromWarehouse && !from) warnings.push(`No warehouse called “${clause.fromWarehouse}”; used the default instead.`)
    if (clause.toWarehouse && !to) warnings.push(`No warehouse called “${clause.toWarehouse}”; used the default instead.`)

    const fallback = ctx.defaultWarehouseId
    const base = {
      item_id: item.item_id,
      item_hint: item.item_name,
      batch_id: null,
      serial_ids: [],
      quantity: clause.quantity,
      rate: null,
      remarks: clause.remarks,
    }

    if (clause.kind === 'transfer') {
      const source = from?.warehouse_id ?? fallback
      const dest = to?.warehouse_id ?? fallback
      if (source !== null && dest !== null && source === dest) {
        warnings.push(`“${item.item_name}”: the source and destination warehouse are the same, so no transfer lines were added.`)
        continue
      }
      suggestions.push({ ...base, warehouse_id: source, direction: 'out' })
      suggestions.push({ ...base, warehouse_id: dest, direction: 'in' })
    } else {
      const warehouse = (clause.kind === 'out' ? from : to) ?? from ?? to
      suggestions.push({ ...base, warehouse_id: warehouse?.warehouse_id ?? fallback, direction: clause.kind })
    }
  }

  if (suggestions.length > 0) {
    warnings.push('Drafted on this device from what you typed. Check every line before posting.')
  }
  return { suggestions, warnings, source: 'device' }
}

/** Server when configured, on-device parser otherwise. */
export async function suggest(prompt: string, ctx: LocalAssistContext, request: AssistRequest, signal?: AbortSignal): Promise<AssistResponse> {
  if (serverAssistEnabled()) {
    try {
      return await requestSuggestions(request, signal)
    } catch (err) {
      if (!(err instanceof AssistUnavailableError)) throw err
    }
  }
  return suggestLocally(prompt, ctx, signal)
}
