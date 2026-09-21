/**
 * The Aicountly AI panel's service layer for Units of measure.
 *
 * The panel offers six things, and they are not all the same kind of thing.
 * Five are questions about the company's own units that have a determinate
 * answer — which units collide, which nothing uses, which lack a GST code,
 * which standard codes are not covered, and what 25 kg is in grams. Those are
 * computed here from the units the API just returned, by the rules in
 * `uomPresentation`. They are real answers, available offline, and the panel
 * shows the rule alongside each one.
 *
 * The sixth is the free-text box, which needs a model. There is no Inventory AI
 * endpoint yet, so `askAssistant` reports itself UNAVAILABLE and names the
 * integration point. It does not return a canned paragraph dressed up as an
 * answer: a panel that pretends to work is worse than one that says it does not
 * yet, because the first is discovered by someone acting on it.
 *
 * When the endpoint lands, set VITE_INVENTORY_AI_PATH and only `askAssistant`
 * changes — the five analyses stay local, because a round trip to be told which
 * of 21 units nothing uses is a round trip for nothing.
 */

import { api, errorMessage } from './api'
import type { ItemResponse } from './api'
import type { Uom } from './masters'
import {
  convertUnits,
  duplicateClusters,
  hasUqc,
  normaliseUnitToken,
  suggestUqc,
  unitTokens,
} from '../pages/masters/uom/uomPresentation'
import type {
  ConversionResult,
  DuplicateCluster,
  UqcSuggestion,
} from '../pages/masters/uom/uomPresentation'

/** Where an answer came from, so the panel can say so rather than imply a model. */
export type AiBasis = 'derived' | 'service'

export type AiOutcome<T> =
  | { status: 'ok'; data: T; basis: AiBasis }
  | { status: 'unavailable'; reason: string; integration: string }
  | { status: 'error'; message: string }

// The same variable the other masters' AI panels read
// (masters/warehouseGroups/warehouseGroupsAi.ts). One seam for one service:
// two names for one endpoint is how half the screens end up connected and the
// other half quietly are not.
const ASSISTANT_PATH = (import.meta.env.VITE_INVENTORY_AI_PATH ?? '').trim().replace(/^\/+/, '')

// ---------------------------------------------------------------------------
// Derived analyses — real answers, computed from the rows on hand
// ---------------------------------------------------------------------------

export interface UnusedUnit {
  row: Uom
  /** What deactivating it would cost. Zero, by definition of unused. */
  usage: number
}

export interface MissingUqcRow {
  row: Uom
  suggestion: UqcSuggestion | null
}

export interface SuggestedUnit {
  name: string
  symbol: string
  uqc: string
  reason: string
}

/**
 * Standard units a stock-keeping company usually needs at least one of.
 *
 * Each is a published GST unit quantity code, so adding one is never a step
 * away from what a return will accept. The list is short on purpose: it is a
 * prompt, not a seeding script, and nothing is created without a click.
 */
const COMMON_UNITS: readonly SuggestedUnit[] = [
  { name: 'Numbers', symbol: 'NOS', uqc: 'NOS', reason: 'The default for anything counted rather than measured.' },
  { name: 'Pieces', symbol: 'PCS', uqc: 'PCS', reason: 'Counted goods sold individually.' },
  { name: 'Kilogram', symbol: 'KG', uqc: 'KGS', reason: 'The usual mass unit for stock bought and sold by weight.' },
  { name: 'Gram', symbol: 'G', uqc: 'GMS', reason: 'For small-weight items, and the base a kilogram converts to.' },
  { name: 'Litre', symbol: 'L', uqc: 'LTR', reason: 'Liquids measured by volume.' },
  { name: 'Metre', symbol: 'M', uqc: 'MTR', reason: 'Goods sold by length — cable, fabric, pipe.' },
  { name: 'Pair', symbol: 'PR', uqc: 'PRS', reason: 'Items that only ship two at a time.' },
  { name: 'Set', symbol: 'SET', uqc: 'SET', reason: 'Kits invoiced as one line.' },
  { name: 'Box', symbol: 'BOX', uqc: 'BOX', reason: 'A packing unit for goods received in cases.' },
  { name: 'Dozen', symbol: 'DOZ', uqc: 'DOZ', reason: 'Twelves, priced and counted as one.' },
]

export function findDuplicates(rows: readonly Uom[]): AiOutcome<DuplicateCluster[]> {
  return { status: 'ok', data: duplicateClusters(rows), basis: 'derived' }
}

export function findUnusedUnits(rows: readonly Uom[]): AiOutcome<UnusedUnit[]> {
  const data = rows
    .filter((row) => (row.usage_count ?? 0) === 0)
    .map((row) => ({ row, usage: 0 }))
    .sort((a, b) => a.row.unit_name.localeCompare(b.row.unit_name))
  return { status: 'ok', data, basis: 'derived' }
}

export function findMissingUqc(rows: readonly Uom[]): AiOutcome<MissingUqcRow[]> {
  const data = rows
    .filter((row) => !hasUqc(row))
    .map((row) => ({ row, suggestion: suggestUqc(row) }))
    // A row with a confident suggestion is one click of work; one without is a
    // decision. The actionable ones come first.
    .sort((a, b) => {
      const rank = Number(Boolean(b.suggestion)) - Number(Boolean(a.suggestion))
      return rank !== 0 ? rank : a.row.unit_name.localeCompare(b.row.unit_name)
    })
  return { status: 'ok', data, basis: 'derived' }
}

export function suggestCommonUnits(rows: readonly Uom[]): AiOutcome<SuggestedUnit[]> {
  const held = new Set<string>()
  for (const row of rows) {
    for (const token of unitTokens(row)) held.add(token)
    const code = String(row.uqc_gst ?? '').trim().toUpperCase()
    if (code) held.add(normaliseUnitToken(code))
  }
  const data = COMMON_UNITS.filter(
    (u) => !held.has(normaliseUnitToken(u.name)) && !held.has(normaliseUnitToken(u.symbol)) && !held.has(normaliseUnitToken(u.uqc)),
  )
  return { status: 'ok', data, basis: 'derived' }
}

export function convert(from: Uom, to: Uom, value: number): AiOutcome<ConversionResult> {
  return { status: 'ok', data: convertUnits(from, to, value), basis: 'derived' }
}

// ---------------------------------------------------------------------------
// The conversational endpoint — not wired yet, and says so
// ---------------------------------------------------------------------------

export interface AssistantReply {
  answer: string
  citations?: { label: string; to?: string }[]
}

export interface AssistantContext {
  /** Which units the question is about — the filtered view, not the whole master. */
  unitIds: number[]
  /** The screen the question was asked from, for the service to scope its answer. */
  screen: 'masters.uom'
}

/**
 * Ask the assistant a free-text question about units of measure.
 *
 * Returns `unavailable` until an Inventory AI endpoint exists and
 * VITE_INVENTORY_AI_PATH points at it. The shape of the call is settled here so
 * that wiring it later is a configuration change rather than a rewrite of the
 * panel.
 */
export async function askAssistant(
  message: string,
  context: AssistantContext,
  signal?: AbortSignal,
): Promise<AiOutcome<AssistantReply>> {
  if (!ASSISTANT_PATH) {
    return {
      status: 'unavailable',
      reason: 'The Aicountly AI assistant service is not connected to Inventory yet.',
      integration: 'Set VITE_INVENTORY_AI_PATH to the Aicountly AI endpoint; this panel already posts { message, context } to it.',
    }
  }
  try {
    const res = await api.post<ItemResponse<AssistantReply>>(ASSISTANT_PATH, { message, context }, { signal })
    return { status: 'ok', data: res.data, basis: 'service' }
  } catch (err) {
    return { status: 'error', message: errorMessage(err, 'The assistant could not answer that.') }
  }
}

/** True when the free-text box can reach a service at all. */
export const assistantConfigured = ASSISTANT_PATH !== ''
