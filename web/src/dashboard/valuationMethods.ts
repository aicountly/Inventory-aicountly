/**
 * "The same stock, costed four ways" — the dashboard's compact reading of the
 * comparison at /valuation/method-comparison.
 *
 * Two rules carried over from that page, because they are what stop the panel
 * being misleading:
 *
 *  1. **The basis is what the books are actually kept on** — each item at the
 *     method on its own master. FIFO, LIFO and weighted average are
 *     counterfactuals, and the panel labels them as such. Nothing here posts,
 *     revalues or offers to switch a method: changing it is a company setting,
 *     under Settings, with its own permission.
 *  2. **A method that could not be valued is unavailable, not zero.** A blank
 *     row in a comparison is a missing answer; a zero reads as "this method
 *     values the stock at nothing", which is a different and much worse claim.
 *
 * The variance is against the basis, and only when the basis itself answered:
 * a difference measured from a figure we do not have is not 0%, it is unknown.
 */

import { METHOD_LABELS, REPORT_METHODS } from '../services/valuationApi'
import type { ReportMethod, ValuationSnapshotSummary } from '../services/valuationApi'

/** The method the company's books are kept on. */
export const BASIS_METHOD: ReportMethod = 'AS_PER_MASTER'

export interface MethodSnapshot {
  method: ReportMethod
  /** Null when this method's request failed — never a zero. */
  summary: ValuationSnapshotSummary | null
}

export interface MethodRow {
  method: ReportMethod
  label: string
  /** Null when unavailable. */
  value: number | null
  /** Signed difference from the basis, in currency. Null when not measurable. */
  delta: number | null
  /** Signed difference as a percentage of the basis. Null when not measurable. */
  variancePercent: number | null
  /** How this row relates to the company's own books. */
  status: 'basis' | 'comparison' | 'unavailable'
  statusLabel: string
  /** Bar width 0–100, against the largest readable figure. */
  scale: number
  isBasis: boolean
}

const STATUS_LABEL: Record<MethodRow['status'], string> = {
  basis: 'Current basis',
  comparison: 'Comparison only',
  unavailable: 'Unavailable',
}

export function methodRows(snapshots: readonly MethodSnapshot[]): MethodRow[] {
  const byMethod = new Map(snapshots.map((s) => [s.method, s.summary]))
  const basis = byMethod.get(BASIS_METHOD) ?? null
  const basisValue = basis ? basis.total_value : null

  const readable = snapshots
    .map((s) => s.summary?.total_value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const max = readable.length > 0 ? Math.max(...readable.map(Math.abs)) : 0

  return REPORT_METHODS.map((method) => {
    const summary = byMethod.get(method) ?? null
    const isBasis = method === BASIS_METHOD
    const value = summary ? summary.total_value : null

    let delta: number | null = null
    let variancePercent: number | null = null
    if (value !== null && basisValue !== null && !isBasis) {
      delta = value - basisValue
      // Guarded: a basis of zero makes every percentage infinite, and "∞%
      // cheaper than nothing" is not a figure to put on a finance screen.
      variancePercent = Math.abs(basisValue) > 0 ? (delta / Math.abs(basisValue)) * 100 : null
    }

    const status: MethodRow['status'] = value === null ? 'unavailable' : isBasis ? 'basis' : 'comparison'

    return {
      method,
      label: METHOD_LABELS[method],
      value,
      delta,
      variancePercent,
      status,
      statusLabel: STATUS_LABEL[status],
      scale: value !== null && max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0,
      isBasis,
    }
  })
}

/** How many methods actually answered — the panel says so when it is not all. */
export function answeredMethods(rows: readonly MethodRow[]): number {
  return rows.filter((r) => r.value !== null).length
}

/** `-0.4%` / `+1.2%` / `—`. Never `NaN%` or `Infinity%`. */
export function formatVariance(variancePercent: number | null, empty = '—'): string {
  if (variancePercent === null || !Number.isFinite(variancePercent)) return empty
  if (Math.abs(variancePercent) < 0.05) return '0.0%'
  return `${variancePercent > 0 ? '+' : ''}${variancePercent.toFixed(1)}%`
}

/**
 * The widest spread between any two methods that answered — the one number
 * that says whether the choice of method matters for this company at all.
 */
export function methodSpread(rows: readonly MethodRow[]): { amount: number; percentOfBasis: number | null } | null {
  const values = rows.map((r) => r.value).filter((v): v is number => v !== null)
  if (values.length < 2) return null
  const amount = Math.max(...values) - Math.min(...values)
  const basis = rows.find((r) => r.isBasis)?.value ?? null
  return {
    amount,
    percentOfBasis: basis !== null && Math.abs(basis) > 0 ? (amount / Math.abs(basis)) * 100 : null,
  }
}
