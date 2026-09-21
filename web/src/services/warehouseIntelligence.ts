/**
 * The Warehouses screen's AI surface, behind one interface.
 *
 * There is no Aicountly AI endpoint in this deployment yet. Rather than mock
 * one — a panel that answers "which warehouse is closest to capacity?" with a
 * sentence nobody computed is worse than no panel at all, because the answer
 * looks exactly like a real one — this module is the seam where the real
 * service will be wired, and it reports honestly that it is not connected.
 *
 * Two kinds of answer live here, and the difference matters:
 *
 *  - `answerLocally` handles the questions that are arithmetic over rows the
 *    page has ALREADY loaded. "Closest to capacity" is a sort, not a model
 *    call, and answering it from the data on screen is both instant and
 *    verifiable against the table beneath it. These work today.
 *  - `ask` is everything else — free-form language, cross-module reasoning,
 *    redistribution advice. Those need a backend, and until `VITE_INVENTORY_AI_PATH`
 *    names one, `ask` rejects with `WarehouseIntelligenceUnavailableError` and the
 *    panel says "AI connection not configured". It never invents a reply.
 *
 * When the endpoint exists, set the env var and delete nothing: the contract
 * below (`WarehouseAiRequest` -> `WarehouseAiAnswer`) is what it must speak.
 */

import { AREA_UNIT_LABELS } from './masters'
import type { AreaUnit, Warehouse } from './masters'
import { api } from './api'
import { formatInt, formatQty, toNumber } from '../utils/format'

/*
 * The same variable every other masters AI panel reads
 * (masters/warehouseGroups/warehouseGroupsAi.ts, services/uomAiApi.ts). One
 * seam for one service: two names for one endpoint is how half the screens end
 * up connected and the other half quietly are not.
 */
const ENDPOINT = (import.meta.env.VITE_INVENTORY_AI_PATH ?? '').trim().replace(/^\/+/, '')

/** One warehouse, reduced to what a question can be answered from. */
export interface WarehouseFact {
  warehouse_id: number
  name: string
  code: string | null
  type: string
  city: string | null
  is_active: boolean
  capacity: number | null
  stockQty: number
  /** Only present when the caller may see inventory valuation. */
  stockValue: number | null
  utilisation: number | null
}

export interface WarehouseAiRequest {
  question: string
  /** The page's current, real figures. The service never re-queries behind the UI. */
  facts: readonly WarehouseFact[]
}

export interface WarehouseAiAnswer {
  text: string
  /** Warehouse ids the answer is about, so the UI can highlight the rows. */
  warehouseIds?: number[]
  source: 'local' | 'remote'
}

export class WarehouseIntelligenceUnavailableError extends Error {
  constructor(message = 'AI connection not configured') {
    super(message)
    this.name = 'WarehouseIntelligenceUnavailableError'
  }
}

/** The prompts the panel offers. Each one is a question this screen's data can carry. */
export const WAREHOUSE_AI_SUGGESTIONS: readonly string[] = [
  'Which warehouse is closest to capacity?',
  'Which warehouses have no stock?',
  'Which warehouse holds the most stock?',
  'Where should I transfer stock?',
  'Which locations have negative stock?',
  'Suggest stock redistribution',
]

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const hasAll = (q: string, ...words: string[]): boolean => words.every((w) => q.includes(w))

/**
 * Questions answerable by arithmetic over the rows on screen.
 *
 * Deliberately narrow: it matches a handful of shapes and returns null for
 * everything else rather than guessing at intent. A wrong answer delivered
 * confidently is the failure mode this whole module exists to avoid.
 */
export function answerLocally(question: string, facts: readonly WarehouseFact[]): WarehouseAiAnswer | null {
  const q = norm(question)
  if (!q) return null

  const withCapacity = facts.filter((f) => f.utilisation !== null)
  const active = facts.filter((f) => f.is_active)

  if (hasAll(q, 'capacity') && (q.includes('closest') || q.includes('nearest') || q.includes('full') || q.includes('highest'))) {
    if (withCapacity.length === 0) {
      return {
        text: 'No warehouse has a capacity configured yet, so there is nothing to measure fullness against. Set "Maximum stock units" on a warehouse and this becomes answerable.',
        source: 'local',
      }
    }
    const top = [...withCapacity].sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0))[0]
    return {
      text: `${top.name} is the fullest at ${(top.utilisation ?? 0).toFixed(1)}% — ${formatQty(top.stockQty)} of ${formatQty(top.capacity)} units.`,
      warehouseIds: [top.warehouse_id],
      source: 'local',
    }
  }

  if (q.includes('negative')) {
    const negative = facts.filter((f) => f.stockQty < 0)
    return {
      text: negative.length === 0
        ? 'No warehouse is holding negative stock.'
        : `${negative.length} warehouse${negative.length === 1 ? '' : 's'} hold negative stock: ${negative.map((f) => f.name).join(', ')}.`,
      warehouseIds: negative.map((f) => f.warehouse_id),
      source: 'local',
    }
  }

  if ((q.includes('no stock') || q.includes('empty') || q.includes('zero stock')) ) {
    const empty = active.filter((f) => f.stockQty === 0)
    return {
      text: empty.length === 0
        ? 'Every active warehouse is holding stock.'
        : `${empty.length} active warehouse${empty.length === 1 ? ' is' : 's are'} empty: ${empty.map((f) => f.name).join(', ')}.`,
      warehouseIds: empty.map((f) => f.warehouse_id),
      source: 'local',
    }
  }

  if ((q.includes('most') || q.includes('highest') || q.includes('largest')) && (q.includes('stock') || q.includes('inventory'))) {
    if (facts.length === 0) return null
    const byValue = facts.some((f) => f.stockValue !== null)
    const top = [...facts].sort((a, b) => (byValue ? (b.stockValue ?? 0) - (a.stockValue ?? 0) : b.stockQty - a.stockQty))[0]
    return {
      text: `${top.name} holds the most — ${formatQty(top.stockQty)} units${top.stockValue !== null ? ` (${formatInt(Math.round(top.stockValue))} by value)` : ''}.`,
      warehouseIds: [top.warehouse_id],
      source: 'local',
    }
  }

  return null
}

export const warehouseIntelligenceService = {
  /** Whether free-form questions can be sent anywhere. False until VITE_INVENTORY_AI_PATH is set. */
  isConfigured(): boolean {
    return ENDPOINT !== ''
  },

  suggestions(): readonly string[] {
    return WAREHOUSE_AI_SUGGESTIONS
  },

  /**
   * Answer a question: locally when it is arithmetic, otherwise over the wire.
   *
   * Throws `WarehouseIntelligenceUnavailableError` when no endpoint is
   * configured — the caller renders that as a status, not as an answer.
   */
  async ask(request: WarehouseAiRequest, signal?: AbortSignal): Promise<WarehouseAiAnswer> {
    const local = answerLocally(request.question, request.facts)
    if (local) return local
    if (!ENDPOINT) throw new WarehouseIntelligenceUnavailableError()
    // TODO(aicountly-ai): set VITE_INVENTORY_AI_PATH once the assistant route ships.
    // The contract is this request body and `{ data: WarehouseAiAnswer }` back; the API client
    // carries the session and the company scope, so the service sees the same tenant the page does.
    const res = await api.post<{ data: WarehouseAiAnswer }>(ENDPOINT, { question: request.question, facts: request.facts }, { signal })
    return { ...res.data, source: 'remote' }
  },
}

/** Build the fact list the panel reasons over, from rows the page already has. */
export function toWarehouseFacts(
  rows: readonly Warehouse[],
  stockOf: (id: number) => { qty: number; value: number | null },
): WarehouseFact[] {
  return rows.map((w) => {
    const capacity = toNumber(w.capacity_units)
    const stock = stockOf(w.warehouse_id)
    const address = (w.address ?? {}) as Record<string, unknown>
    const city = typeof address.city === 'string' && address.city.trim() ? address.city.trim() : null
    return {
      warehouse_id: w.warehouse_id,
      name: w.warehouse_name,
      code: w.warehouse_code,
      type: String(w.warehouse_type),
      city,
      is_active: Number(w.is_active) === 1,
      capacity: capacity !== null && capacity > 0 ? capacity : null,
      stockQty: stock.qty,
      stockValue: stock.value,
      utilisation: capacity !== null && capacity > 0 ? (stock.qty / capacity) * 100 : null,
    }
  })
}

/** Human label for a stored area unit, falling back to the raw value. */
export function areaUnitLabel(unit: string | null | undefined): string {
  if (!unit) return ''
  return AREA_UNIT_LABELS[unit as AreaUnit] ?? unit
}
