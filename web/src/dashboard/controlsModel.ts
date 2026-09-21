/**
 * Pure logic behind the Controls dashboard.
 *
 * The one decision worth isolating and testing: **what the last reconciliation
 * actually says.** There are four outcomes and they are routinely collapsed
 * into two on screens like this, which is how a controller ends up standing
 * down on a difference that is still there:
 *
 *   matched      Books answered and the figures agree
 *   difference   Books answered and they do not
 *   unavailable  Books could NOT be reached, so the difference is UNKNOWN —
 *                not zero, not matched, and never a green tick
 *   failed       the run itself errored
 *
 * "Books was unreachable" and "there is no difference" produce identical-looking
 * cards if a null difference is formatted as ₹0.00. `reconciliationVerdict` is
 * what stops that happening, once, in a place a test can reach.
 */

import type { BadgeTone } from '../ui/Badge'
import type { IconTone } from '../ui/IconTile'
import type { MetricState } from './aggregatesApi'
import type { ReconciliationRun } from '../services/reconciliationApi'
import { formatCurrencyCompact } from './formatters'

export type ReconciliationKind = 'matched' | 'difference' | 'unavailable' | 'failed' | 'never_run'

export interface ReconciliationVerdict {
  kind: ReconciliationKind
  /** The KPI card's figure — or `null` so the card renders its own state. */
  headline: string | null
  /** What the card's tooltip and the PDF both say. */
  explanation: string
  statusLabel: string
  /** The numeric difference, or null when it is genuinely unknown. */
  difference: number | null
  matched: boolean
  state: MetricState
}

/** Below this, a difference is rounding rather than a break. */
const ROUNDING_TOLERANCE = 0.01

export function reconciliationVerdict(run: ReconciliationRun | null): ReconciliationVerdict {
  if (run === null) {
    return {
      kind: 'never_run',
      headline: null,
      explanation: 'No reconciliation has been run for this company, financial year and branch yet.',
      statusLabel: 'Never run',
      difference: null,
      matched: false,
      state: 'empty',
    }
  }

  const status = String(run.status).toUpperCase()

  if (status === 'BOOKS_UNAVAILABLE') {
    return {
      kind: 'unavailable',
      // Explicitly NOT a figure. A zero here reads as "they agree".
      headline: null,
      explanation:
        'The last run could not reach Books, so the difference is unknown — not nil. Nothing on this card should be read as the two systems agreeing.',
      statusLabel: 'Books unreachable',
      difference: null,
      matched: false,
      state: 'unavailable',
    }
  }

  if (status === 'FAILED') {
    return {
      kind: 'failed',
      headline: null,
      explanation: 'The last reconciliation run failed before it could compare the two balances.',
      statusLabel: 'Run failed',
      difference: null,
      matched: false,
      state: 'unavailable',
    }
  }

  const difference = run.difference === null ? null : Number(run.difference)

  if (difference === null || !Number.isFinite(difference)) {
    return {
      kind: 'unavailable',
      headline: null,
      explanation:
        'The run completed but no difference was recorded, so the two balances have not been compared. Treat this as unknown rather than as a match.',
      statusLabel: 'Difference unknown',
      difference: null,
      matched: false,
      state: 'unavailable',
    }
  }

  if (Math.abs(difference) < ROUNDING_TOLERANCE) {
    return {
      kind: 'matched',
      headline: 'Aligned',
      explanation: 'Inventory valuation and the mapped Books inventory-control balance agree on the same cut-off.',
      statusLabel: 'Completed — aligned',
      difference,
      matched: true,
      state: 'ready',
    }
  }

  return {
    kind: 'difference',
    headline: formatCurrencyCompact(Math.abs(difference)),
    explanation: `Inventory valuation and the Books inventory-control balance differ by ${formatCurrencyCompact(Math.abs(difference))}; Books is ${difference > 0 ? 'lower' : 'higher'} than inventory. The run completed — it found a difference, which is not the same as being aligned.`,
    // "Completed" alone would read as success. The mockup this replaces showed
    // "Inventory and Books aligned" beside a non-zero difference; this is the
    // wording that makes that impossible.
    statusLabel: 'Completed — difference found',
    difference,
    matched: false,
    state: 'ready',
  }
}

export const RECONCILIATION_TONE: Record<ReconciliationKind, IconTone> = {
  matched: 'success',
  difference: 'warning',
  unavailable: 'warning',
  failed: 'danger',
  never_run: 'slate',
}

export function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case 'high':
      return 'danger'
    case 'medium':
      return 'warning'
    default:
      return 'neutral'
  }
}

/**
 * Whole days between a date and today, floored at zero.
 *
 * A document dated tomorrow has waited nought days, not minus one — an age is
 * never negative, and a "-1 d" badge on an approval queue is just a bug on
 * screen.
 */
export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0
  const then = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(then.getTime())) return 0
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00')
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86400000))
}
