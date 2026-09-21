/**
 * The editable draft behind the Stock Revaluation screen, and the pure conversions between it,
 * the document API payload and the on-screen impact figures.
 *
 * Everything here is pure so it is unit-tested. Two rules from the posting engine
 * (DocumentPostingService::applyRevaluation) shape the whole model and are worth stating once:
 *
 *  1. A revaluation changes the COST of stock on hand. It never moves a quantity, a warehouse,
 *     a batch or a serial. The quantity on a line is informational — it is what the value impact
 *     is calculated over, and it is read from the authoritative balance, never typed.
 *  2. The engine re-prices EVERY open cost layer of `item × valuation scope`, where the scope is
 *     the line's warehouse under `valuation_scope = warehouse` and the whole company otherwise
 *     (ValuationEngine::scopeWarehouse). It does not narrow by batch or serial. So the preview is
 *     computed over the same scope, and two lines that resolve to the same scope are a duplicate
 *     — the second would simply overwrite the first.
 */

import { newHeader, newLine, nextLineKey, round4, toPayload } from '../formModel'
import type { HeaderDraft, LineDraft, UnitOption } from '../formModel'
import type { DocumentTypeSpec } from '../registry'
import type { CreateDocumentPayload, InventoryDocument } from '../types'
import { toNumber } from '../../utils/format'

export type RevaluationMode = 'simple' | 'advanced'

/** How the company values stock — `InventorySettingsService::valuationScope`, default `company`. */
export type ValuationScope = 'company' | 'warehouse'

export interface RevaluationLine {
  key: string
  itemId: number | null
  itemName: string
  itemSku: string | null
  hsnSac: string | null
  unitId: number | null
  unitSymbol: string | null
  units: UnitOption[]
  trackBatch: boolean
  trackSerial: boolean
  /** The item master's own method, when the search told us. Display only. */
  valuationMethod: string | null
  warehouseId: number | null
  /** As typed. Parsed, never rounded, on the way to the payload. */
  newUnitCost: string
  remarks: string
}

export interface RevaluationDraft {
  documentDate: string
  documentNo: string
  defaultWarehouseId: number | null
  reasonCode: string
  movementReason: string
  narration: string
  lines: RevaluationLine[]
}

/**
 * What the authoritative APIs say about one item in one valuation scope: the unit cost the
 * posting engine would replace and the quantity it would be replaced over.
 *
 * Held beside the draft rather than on the line so a keystroke in the New cost box never
 * invalidates a fetch, and so the line stays a plain serialisable record.
 */
export interface StockContext {
  itemId: number
  /** The scope the figures were read at: a warehouse id, or null for the whole company. */
  warehouseId: number | null
  onHandQty: number | null
  currentUnitCost: number | null
  /** Method the cost was resolved under (`AS_PER_MASTER` resolves per item). */
  method: string | null
  loading: boolean
  error: string | null
  /** Clock reading of the last successful read — what the staleness check compares. */
  fetchedAt: number | null
}

export type StockContextMap = Readonly<Record<string, StockContext>>

export const NARRATION_LIMIT = 500

/** The reason codes this screen offers. There is no reason-code master: the column is free text
 *  (DocumentService stores the first 32 characters), so these are suggestions with a free-text
 *  escape hatch, not a closed list pretending to be one. */
export const REVALUATION_REASON_CODES: readonly { code: string; label: string; hint: string }[] = [
  { code: 'MARKET_PRICE', label: 'Market price change', hint: 'Replacement cost has moved.' },
  { code: 'NRV_WRITE_DOWN', label: 'Net realisable value', hint: 'Cost written down to NRV under AS-2 / Ind AS 2.' },
  { code: 'DAMAGE', label: 'Damage', hint: 'Stock is damaged and worth less than it cost.' },
  { code: 'OBSOLESCENCE', label: 'Obsolescence', hint: 'Slow-moving or superseded stock.' },
  { code: 'STANDARD_COST', label: 'Standard cost revision', hint: 'Re-priced to the revised standard cost.' },
  { code: 'LANDED_COST_CORRECTION', label: 'Landed cost correction', hint: 'Landing costs were wrong when the stock was received.' },
  { code: 'PURCHASE_RATE_CORRECTION', label: 'Purchase rate correction', hint: 'The receipt was booked at the wrong rate.' },
  { code: 'OPENING_CORRECTION', label: 'Opening value correction', hint: 'The opening stock value was wrong.' },
  { code: 'OTHER', label: 'Other', hint: 'Explain it in the movement reason and narration.' },
]

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

export function newRevaluationLine(partial: Partial<RevaluationLine> = {}): RevaluationLine {
  return {
    key: nextLineKey(),
    itemId: null,
    itemName: '',
    itemSku: null,
    hsnSac: null,
    unitId: null,
    unitSymbol: null,
    units: [],
    trackBatch: false,
    trackSerial: false,
    valuationMethod: null,
    warehouseId: null,
    newUnitCost: '',
    remarks: '',
    ...partial,
  }
}

export function newRevaluationDraft(today: string): RevaluationDraft {
  return {
    documentDate: today,
    documentNo: '',
    defaultWarehouseId: null,
    reasonCode: '',
    movementReason: '',
    narration: '',
    lines: [],
  }
}

/** A line carries nothing yet — safe to drop on save, never counted or validated. */
export function isBlankRevaluationLine(line: RevaluationLine): boolean {
  return line.itemId === null && line.newUnitCost.trim() === '' && line.remarks.trim() === ''
}

export function activeLines(draft: RevaluationDraft): RevaluationLine[] {
  return draft.lines.filter((l) => !isBlankRevaluationLine(l))
}

// ---------------------------------------------------------------------------------------------
// Valuation scope
// ---------------------------------------------------------------------------------------------

/**
 * The warehouse the posting engine would actually read layers at — the mirror of
 * `ValuationEngine::scopeWarehouse`. Under company-wide valuation a line's warehouse does not
 * narrow anything, so the scope is null and the preview is company-wide too.
 */
export function scopeWarehouseId(scope: ValuationScope, warehouseId: number | null): number | null {
  return scope === 'warehouse' && warehouseId !== null && warehouseId > 0 ? warehouseId : null
}

export function contextKey(itemId: number, scopedWarehouseId: number | null): string {
  return `${itemId}:${scopedWarehouseId ?? 'all'}`
}

export function lineContextKey(line: RevaluationLine, scope: ValuationScope): string | null {
  if (line.itemId === null) return null
  return contextKey(line.itemId, scopeWarehouseId(scope, line.warehouseId))
}

export function contextFor(line: RevaluationLine, contexts: StockContextMap, scope: ValuationScope): StockContext | null {
  const key = lineContextKey(line, scope)
  return key ? (contexts[key] ?? null) : null
}

// ---------------------------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------------------------

/**
 * `(newUnitCost − currentUnitCost) × onHandQty`, rounded once at the end to the 4 decimals the
 * server rounds to (`round4` mirrors PHP `round($x, 4)`). Null while any input is unknown —
 * a missing cost is not a zero impact, and printing one would be a lie the reader cannot see.
 */
export function lineImpact(newUnitCost: unknown, currentUnitCost: number | null, onHandQty: number | null): number | null {
  const next = toNumber(newUnitCost)
  if (next === null || currentUnitCost === null || onHandQty === null) return null
  return round4((next - currentUnitCost) * onHandQty)
}

export function lineImpactFor(line: RevaluationLine, contexts: StockContextMap, scope: ValuationScope): number | null {
  const ctx = contextFor(line, contexts, scope)
  return lineImpact(line.newUnitCost, ctx?.currentUnitCost ?? null, ctx?.onHandQty ?? null)
}

export interface RevaluationTotals {
  /** Lines carrying something. */
  lines: number
  /** Quantity the impact was calculated over. */
  onHandQty: number
  increase: number
  decrease: number
  net: number
  /** Lines whose impact could not be calculated yet (cost or quantity still unknown). */
  pending: number
  /** Lines whose new cost equals the current cost. */
  unchanged: number
}

export function revaluationTotals(draft: RevaluationDraft, contexts: StockContextMap, scope: ValuationScope): RevaluationTotals {
  const totals: RevaluationTotals = { lines: 0, onHandQty: 0, increase: 0, decrease: 0, net: 0, pending: 0, unchanged: 0 }
  for (const line of activeLines(draft)) {
    totals.lines += 1
    const ctx = contextFor(line, contexts, scope)
    if (ctx?.onHandQty !== null && ctx?.onHandQty !== undefined) totals.onHandQty = round4(totals.onHandQty + ctx.onHandQty)
    const impact = lineImpact(line.newUnitCost, ctx?.currentUnitCost ?? null, ctx?.onHandQty ?? null)
    if (impact === null) {
      totals.pending += 1
      continue
    }
    if (impact > 0) totals.increase = round4(totals.increase + impact)
    else if (impact < 0) totals.decrease = round4(totals.decrease + Math.abs(impact))
    else totals.unchanged += 1
  }
  totals.net = round4(totals.increase - totals.decrease)
  return totals
}

export type ImpactDirection = 'increase' | 'decrease' | 'none'

export function impactDirection(value: number | null): ImpactDirection {
  if (value === null || value === 0) return 'none'
  return value > 0 ? 'increase' : 'decrease'
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export type IssueField = 'documentDate' | 'documentNo' | 'defaultWarehouseId' | 'reasonCode' | 'lines'

export interface RevaluationIssue {
  message: string
  /** Header field the message belongs beside. */
  field?: IssueField
  /** Line the message belongs beside. */
  lineKey?: string
}

export interface ValidationOptions {
  /** Posting applies the stricter rules; a draft only has to be storable. */
  forPost: boolean
  scope: ValuationScope
  /** ISO bounds of the selected financial year; blank ends are not checked. */
  fyRange?: { from: string; to: string }
  /** `locked_upto_date` covering this branch, when the settings could be read. */
  lockedUptoDate?: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Everything the server would refuse anyway, checked first so the message lands next to the field.
 *
 * The server is still the authority: it re-reads the balances, re-resolves the valuation scope and
 * re-prices from live layers when the document posts.
 */
export function validateRevaluation(draft: RevaluationDraft, contexts: StockContextMap, options: ValidationOptions): RevaluationIssue[] {
  const issues: RevaluationIssue[] = []
  const { forPost, scope } = options

  if (!ISO_DATE.test(draft.documentDate)) {
    issues.push({ field: 'documentDate', message: 'Enter the document date.' })
  } else {
    const { from, to } = options.fyRange ?? { from: '', to: '' }
    if (from && draft.documentDate < from) issues.push({ field: 'documentDate', message: `The date is before the selected financial year, which starts on ${from}.` })
    else if (to && draft.documentDate > to) issues.push({ field: 'documentDate', message: `The date is after the selected financial year, which ends on ${to}.` })
    if (options.lockedUptoDate && draft.documentDate <= options.lockedUptoDate) {
      issues.push({ field: 'documentDate', message: `The period is locked up to ${options.lockedUptoDate}. Pick a later date or ask for the lock to be released.` })
    }
  }

  if (draft.defaultWarehouseId === null) {
    issues.push({ field: 'defaultWarehouseId', message: 'Choose the default warehouse.' })
  }
  if (!draft.reasonCode.trim()) {
    issues.push({ field: 'reasonCode', message: 'Choose a reason code. A change to stock value has to say why.' })
  }
  if (draft.narration.length > NARRATION_LIMIT) {
    issues.push({ message: `The narration is longer than ${NARRATION_LIMIT} characters.` })
  }

  const lines = activeLines(draft)
  if (lines.length === 0) {
    issues.push({ field: 'lines', message: 'Add at least one item to revalue.' })
    return issues
  }

  const seen = new Map<string, number>()
  lines.forEach((line, index) => {
    const n = index + 1
    if (line.itemId === null) {
      issues.push({ lineKey: line.key, message: `Line ${n}: pick an item.` })
      return
    }
    if (line.warehouseId === null) {
      issues.push({ lineKey: line.key, message: `Line ${n}: choose the warehouse.` })
    }

    const key = contextKey(line.itemId, scopeWarehouseId(scope, line.warehouseId))
    const first = seen.get(key)
    if (first !== undefined) {
      issues.push({
        lineKey: line.key,
        message:
          scope === 'warehouse'
            ? `Line ${n}: ${line.itemName || 'this item'} is already on line ${first} for the same warehouse. The second line would simply overwrite the first.`
            : `Line ${n}: ${line.itemName || 'this item'} is already on line ${first}. Stock is valued company-wide here, so both lines re-price the same layers.`,
      })
    } else {
      seen.set(key, n)
    }

    const ctx = contexts[key]
    if (ctx?.onHandQty !== null && ctx?.onHandQty !== undefined && ctx.onHandQty <= 0) {
      issues.push({ lineKey: line.key, message: `Line ${n}: no stock on hand to revalue${scope === 'warehouse' ? ' in this warehouse' : ''}.` })
    }

    if (!forPost) return

    if (ctx === undefined || ctx.loading) {
      issues.push({ lineKey: line.key, message: `Line ${n}: the current cost and quantity are still loading.` })
    } else if (ctx.currentUnitCost === null || ctx.onHandQty === null) {
      issues.push({ lineKey: line.key, message: `Line ${n}: the current cost could not be read, so the impact cannot be checked.` })
    }

    const next = toNumber(line.newUnitCost)
    if (line.newUnitCost.trim() === '') issues.push({ lineKey: line.key, message: `Line ${n}: enter the new unit cost.` })
    else if (next === null) issues.push({ lineKey: line.key, message: `Line ${n}: the new unit cost is not a number.` })
    else if (next <= 0) issues.push({ lineKey: line.key, message: `Line ${n}: the new unit cost must be greater than zero.` })
  })

  return issues
}

/** Keys of the lines an issue list blames, for the row highlight. */
export function offendingLineKeys(issues: readonly RevaluationIssue[]): Set<string> {
  const keys = new Set<string>()
  for (const issue of issues) if (issue.lineKey) keys.add(issue.lineKey)
  return keys
}

export function headerIssue(issues: readonly RevaluationIssue[], field: IssueField): string | null {
  return issues.find((i) => i.field === field)?.message ?? null
}

// ---------------------------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------------------------

export interface StaleLine {
  key: string
  itemName: string
  previousQty: number | null
  currentQty: number | null
  previousCost: number | null
  currentCost: number | null
}

/**
 * Lines whose authoritative quantity or cost moved between two reads.
 *
 * The preview is calculated from a snapshot; by the time the user posts, a receipt or an issue may
 * have changed what is on hand. The server always re-prices from live layers, so a stale preview
 * never posts a wrong value — but it does mean the figure the user approved is not the figure they
 * get, and that is worth stopping for.
 */
export function staleLines(draft: RevaluationDraft, before: StockContextMap, after: StockContextMap, scope: ValuationScope): StaleLine[] {
  const out: StaleLine[] = []
  for (const line of activeLines(draft)) {
    const key = lineContextKey(line, scope)
    if (!key) continue
    const was = before[key]
    const now = after[key]
    if (!was || !now || was.error || now.error) continue
    const qtyMoved = !numbersMatch(was.onHandQty, now.onHandQty)
    const costMoved = !numbersMatch(was.currentUnitCost, now.currentUnitCost)
    if (!qtyMoved && !costMoved) continue
    out.push({
      key: line.key,
      itemName: line.itemName || `Item #${line.itemId}`,
      previousQty: was.onHandQty,
      currentQty: now.onHandQty,
      previousCost: was.currentUnitCost,
      currentCost: now.currentUnitCost,
    })
  }
  return out
}

function numbersMatch(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.00005
}

// ---------------------------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------------------------

/**
 * The create / update payload, built through the shared `toPayload` so this screen and every other
 * document editor send the same shape to the same endpoint.
 *
 * `qty` is the on-hand quantity read from the balance API, never a typed figure: the server
 * requires a quantity greater than zero on every line, and on a revaluation the only honest
 * quantity is the one the value impact was calculated over. Nothing here moves it.
 */
export function toRevaluationPayload(draft: RevaluationDraft, spec: DocumentTypeSpec, contexts: StockContextMap, scope: ValuationScope): CreateDocumentPayload {
  const header: HeaderDraft = {
    ...newHeader(spec, draft.documentDate),
    document_no: draft.documentNo,
    default_warehouse_id: draft.defaultWarehouseId,
    reason_code: draft.reasonCode,
    movement_reason: draft.movementReason,
    narration: draft.narration,
  }
  const lines: LineDraft[] = activeLines(draft).map((line) => {
    const ctx = contextFor(line, contexts, scope)
    const qty = ctx?.onHandQty ?? null
    return newLine(spec, {
      key: line.key,
      item_id: line.itemId,
      item_name: line.itemName,
      item_sku: line.itemSku,
      track_batch: line.trackBatch,
      track_serial: line.trackSerial,
      units: line.units,
      unit_id: line.unitId,
      warehouse_id: line.warehouseId,
      qty: qty === null ? '' : String(qty),
      valuation_rate: line.newUnitCost.trim(),
      description: line.remarks.trim(),
    })
  })
  return toPayload(header, lines, spec)
}

/** Rebuild the editable draft from a stored draft document (the edit route). */
export function revaluationDraftFromDocument(doc: InventoryDocument): RevaluationDraft {
  const lines = doc.lines.map((l) =>
    newRevaluationLine({
      itemId: l.item_id,
      itemName: l.item_label ?? l.item_name ?? `Item #${l.item_id}`,
      itemSku: l.item_sku ?? null,
      hsnSac: l.hsn_sac ?? null,
      unitId: l.unit_id,
      unitSymbol: l.unit_symbol ?? null,
      units: l.unit_id ? [{ unit_id: l.unit_id, unit_symbol: l.unit_symbol ?? null, unit_name: l.unit_name ?? null, conversion_factor: toNumber(l.conversion_factor) ?? 1, is_default: true }] : [],
      trackBatch: !!l.batch_id,
      trackSerial: (l.serials?.length ?? 0) > 0,
      warehouseId: l.warehouse_id,
      newUnitCost: l.valuation_rate === null || l.valuation_rate === undefined ? '' : String(l.valuation_rate),
      remarks: l.description ?? '',
    }),
  )
  return {
    documentDate: doc.document_date?.slice(0, 10) ?? '',
    documentNo: doc.document_no ?? '',
    // Stored lines carry their own warehouse; the header field only pre-fills new ones, so it
    // starts at whatever every line already agrees on rather than at nothing.
    defaultWarehouseId: singleWarehouse(lines),
    reasonCode: doc.reason_code ?? '',
    movementReason: doc.movement_reason ?? '',
    narration: doc.narration ?? '',
    lines,
  }
}

function singleWarehouse(lines: readonly RevaluationLine[]): number | null {
  const ids = new Set(lines.map((l) => l.warehouseId).filter((id): id is number => id !== null))
  return ids.size === 1 ? [...ids][0] : null
}

// ---------------------------------------------------------------------------------------------
// Display filters
// ---------------------------------------------------------------------------------------------

export type ShowFilter = 'all' | 'on_hand' | 'zero_stock' | 'changed' | 'unchanged' | 'increase' | 'decrease'

export const SHOW_FILTERS: readonly { value: ShowFilter; label: string }[] = [
  { value: 'all', label: 'All lines' },
  { value: 'on_hand', label: 'On-hand items' },
  { value: 'zero_stock', label: 'Zero stock' },
  { value: 'changed', label: 'Changed rates' },
  { value: 'unchanged', label: 'Unchanged rates' },
  { value: 'increase', label: 'Increases only' },
  { value: 'decrease', label: 'Decreases only' },
]

export interface LineFilters {
  show: ShowFilter
  warehouseId: number | null
  tracking: 'any' | 'batch' | 'serial' | 'none'
  search: string
}

export const EMPTY_LINE_FILTERS: LineFilters = { show: 'all', warehouseId: null, tracking: 'any', search: '' }

export function filtersAreEmpty(filters: LineFilters): boolean {
  return filters.show === 'all' && filters.warehouseId === null && filters.tracking === 'any' && filters.search.trim() === ''
}

export function countActiveFilters(filters: LineFilters): number {
  let n = 0
  if (filters.show !== 'all') n += 1
  if (filters.warehouseId !== null) n += 1
  if (filters.tracking !== 'any') n += 1
  if (filters.search.trim() !== '') n += 1
  return n
}

/** Which lines the grid shows. Filtering never removes a line from the document or the totals. */
export function visibleLines(lines: readonly RevaluationLine[], contexts: StockContextMap, scope: ValuationScope, filters: LineFilters): RevaluationLine[] {
  const needle = filters.search.trim().toLowerCase()
  return lines.filter((line) => {
    if (filters.warehouseId !== null && line.warehouseId !== filters.warehouseId) return false
    if (filters.tracking === 'batch' && !line.trackBatch) return false
    if (filters.tracking === 'serial' && !line.trackSerial) return false
    if (filters.tracking === 'none' && (line.trackBatch || line.trackSerial)) return false
    if (needle) {
      const haystack = `${line.itemName} ${line.itemSku ?? ''} ${line.hsnSac ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (filters.show === 'all') return true
    const ctx = contextFor(line, contexts, scope)
    const qty = ctx?.onHandQty ?? null
    const impact = lineImpact(line.newUnitCost, ctx?.currentUnitCost ?? null, qty)
    switch (filters.show) {
      case 'on_hand':
        // Unknown yet is not "zero": a line still loading stays visible.
        return qty === null || qty > 0
      case 'zero_stock':
        return qty !== null && qty <= 0
      case 'changed':
        return impact !== null && impact !== 0
      case 'unchanged':
        return impact === 0
      case 'increase':
        return impact !== null && impact > 0
      case 'decrease':
        return impact !== null && impact < 0
      default:
        return true
    }
  })
}
