/**
 * Deterministic signals for the AI Inventory Assistant panel on a "lines"-form document
 * (opening stock, stock journal, write-off, write-in, consumption, material issue / receipt,
 * assembly, disassembly — every native type whose formKind is 'lines').
 *
 * Everything here is pure and computed from the draft already held in DocumentForm (plus, for
 * costing, unit costs fetched live from `valuationApi.unitCosts`). Nothing is fabricated: a
 * signal that cannot be derived from real state returns a neutral / pending result instead of a
 * guess — see `classifyReason` and `computeCostConfidence`.
 */

import { isBlankLine, lineBaseQty } from './formModel'
import type { HeaderDraft, LineDraft } from './formModel'
import type { DocumentTypeSpec } from './registry'
import { todayIso, toNumber } from '../utils/format'

export type InsightTone = 'neutral' | 'success' | 'info' | 'warning'

// ---------------------------------------------------------------------------
// Reason classification
// ---------------------------------------------------------------------------

export interface ReasonClassification {
  label: string
  hint: string
  tone: InsightTone
}

interface KeywordRule {
  test: RegExp
  label: string
}

/** Rules for types that bring stock in (fixed_in), or the "in" half of a mixed type. */
const INCOMING_RULES: KeywordRule[] = [
  { test: /\bfound\b|\bexcess\b|\bsurplus\b/, label: 'Excess Stock' },
  { test: /\bphysical\b|\bstock ?take\b|\brecount\b/, label: 'Physical Count Adjustment' },
  { test: /\breturn/, label: 'Returned Stock' },
  { test: /\bopening\b/, label: 'Opening Balance' },
]

/** Rules for types that take stock out (fixed_out), or the "out" half of a mixed type. */
const OUTGOING_RULES: KeywordRule[] = [
  { test: /\bdamage|expired?|expiry|breakage|lost\b|theft|spoil/, label: 'Damage / Loss' },
  { test: /\bphysical\b|\bstock ?take\b|\brecount\b/, label: 'Physical Count Shortage' },
  { test: /\bconsum|internal use|self use|production use/, label: 'Internal Consumption' },
  { test: /\bsample|gift|donat/, label: 'Sample / Given Away' },
]

function rulesFor(spec: DocumentTypeSpec): KeywordRule[] {
  if (spec.lineMode === 'fixed_out') return OUTGOING_RULES
  if (spec.lineMode === 'fixed_in') return INCOMING_RULES
  return [...INCOMING_RULES, ...OUTGOING_RULES]
}

/** Classifies from the reason code, movement reason and narration the user has already typed. */
export function classifyReason(spec: DocumentTypeSpec, header: Pick<HeaderDraft, 'reason_code' | 'movement_reason' | 'narration'>): ReasonClassification {
  const text = `${header.reason_code} ${header.movement_reason} ${header.narration}`.trim().toLowerCase()
  if (!text) {
    return { label: 'Unclassified', hint: 'Add a reason code or narration for classification.', tone: 'neutral' }
  }
  for (const rule of rulesFor(spec)) {
    if (rule.test.test(text)) {
      return { label: rule.label, hint: `Looks like ${rule.label.toLowerCase()} based on what you entered.`, tone: 'success' }
    }
  }
  return { label: 'Unclassified', hint: 'Could not classify from the text entered — it still saves exactly as typed.', tone: 'neutral' }
}

// ---------------------------------------------------------------------------
// Valuation / cost confidence
// ---------------------------------------------------------------------------

export type CostConfidenceLevel = 'pending' | 'high' | 'medium' | 'low' | 'auto'

export interface CostConfidence {
  level: CostConfidenceLevel
  label: string
  hint: string
}

/**
 * How confident the draft's costing looks. `referenceCosts` is whatever
 * `valuationApi.unitCosts` returned for the items on the draft — real figures, never guessed.
 */
export function computeCostConfidence(spec: DocumentTypeSpec, lines: LineDraft[], referenceCosts: ReadonlyMap<number, number> | undefined): CostConfidence {
  if (!spec.valuation) return { level: 'pending', label: 'N/A', hint: 'This document type does not carry a valuation.' }
  const active = lines.filter((l) => !isBlankLine(l) && l.item_id !== null)
  if (active.length === 0) return { level: 'pending', label: 'Pending', hint: 'Add items to see costing confidence.' }
  if (!spec.rate) {
    return { level: 'auto', label: 'Automatic', hint: "Priced by the item's valuation method on posting." }
  }
  let priced = 0
  for (const l of active) {
    const rate = toNumber(l.rate)
    if (rate !== null && rate > 0) {
      priced += 1
      continue
    }
    const ref = l.item_id !== null ? referenceCosts?.get(l.item_id) : undefined
    if (ref !== undefined && ref > 0) priced += 1
  }
  if (priced === active.length) return { level: 'high', label: 'High', hint: 'Using standard/item cost.' }
  if (priced > 0) return { level: 'medium', label: 'Review', hint: `${active.length - priced} line${active.length - priced === 1 ? '' : 's'} still need a cost.` }
  return { level: 'low', label: 'Low', hint: 'No cost entered yet for these lines.' }
}

/** Local UI sensitivity, not a business rule — flag it if there is no configured threshold to read instead. */
export const RATE_VARIANCE_THRESHOLD = 0.2

// ---------------------------------------------------------------------------
// Risk checks
// ---------------------------------------------------------------------------

export interface RiskFinding {
  id: string
  message: string
  tone: 'warning' | 'info'
}

export interface RiskCheckOptions {
  referenceCosts?: ReadonlyMap<number, number>
  /** Draft line keys the last posting attempt reported as short on stock. */
  negativeLineKeys?: ReadonlySet<string>
}

export function computeRiskChecks(spec: DocumentTypeSpec, header: HeaderDraft, lines: LineDraft[], opts: RiskCheckOptions = {}): RiskFinding[] {
  const out: RiskFinding[] = []
  const active = lines.filter((l) => !isBlankLine(l))
  if (active.length === 0) return out

  if (/^\d{4}-\d{2}-\d{2}$/.test(header.document_date) && header.document_date > todayIso()) {
    out.push({ id: 'future-date', message: 'Document date is in the future.', tone: 'warning' })
  }
  if (spec.reason && !header.reason_code.trim() && !header.movement_reason.trim()) {
    out.push({ id: 'missing-reason', message: 'No reason code set for this adjustment.', tone: 'info' })
  }
  if (opts.negativeLineKeys && opts.negativeLineKeys.size > 0) {
    out.push({ id: 'insufficient-stock', message: `Insufficient stock on ${opts.negativeLineKeys.size} line${opts.negativeLineKeys.size === 1 ? '' : 's'}.`, tone: 'warning' })
  }

  active.forEach((l, i) => {
    if (!l.item_id) return
    const n = i + 1
    const label = l.item_name || `item on line ${n}`
    const qty = toNumber(l.qty)

    if (spec.rate) {
      const rate = toNumber(l.rate)
      if (qty !== null && qty > 0 && (rate === null || rate <= 0)) {
        out.push({ id: `zero-rate-${l.key}`, message: `Line ${n}: rate is zero for ${label}.`, tone: 'warning' })
      } else if (rate !== null && rate > 0) {
        const ref = opts.referenceCosts?.get(l.item_id)
        if (ref !== undefined && ref > 0) {
          const diff = Math.abs(rate - ref) / ref
          if (diff > RATE_VARIANCE_THRESHOLD) {
            out.push({ id: `rate-variance-${l.key}`, message: `Line ${n}: entered rate differs from the reference cost by ${Math.round(diff * 100)}%.`, tone: 'info' })
          }
        }
      }
    }

    if (l.track_batch && !l.batch_id) {
      out.push({ id: `missing-batch-${l.key}`, message: `Line ${n}: batch not selected yet for ${label}.`, tone: 'info' })
    }

    if (l.track_serial && qty !== null && qty > 0) {
      const required = lineBaseQty(l)
      if (l.serials.length === 0) {
        out.push({ id: `missing-serial-${l.key}`, message: `Line ${n}: serial numbers not picked yet for ${label}.`, tone: 'info' })
      } else if (l.serials.length !== required) {
        out.push({ id: `serial-mismatch-${l.key}`, message: `Line ${n}: ${l.serials.length} serial(s) picked for a quantity of ${required}.`, tone: 'warning' })
      }
    }
  })

  return out
}

// ---------------------------------------------------------------------------
// Posting reminder
// ---------------------------------------------------------------------------

export interface PostingReminder {
  message: string
  tone: InsightTone
  badge: string
}

export function computePostingReminder(header: Pick<HeaderDraft, 'narration'>, hasLines: boolean): PostingReminder {
  if (!hasLines) return { message: 'Add a line item to get started.', tone: 'neutral', badge: 'Getting started' }
  if (!header.narration.trim()) return { message: 'Consider adding a narration for audit trail.', tone: 'warning', badge: 'Best practice' }
  return { message: 'Narration is set — good for the audit trail.', tone: 'success', badge: 'Good' }
}
