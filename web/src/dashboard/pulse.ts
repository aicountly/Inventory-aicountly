/**
 * The Pulse briefing: a short, factual summary of what is wrong right now.
 *
 * ## Why this is arithmetic and not a model
 *
 * There is no forecasting engine in this product and no application-owned LLM
 * configured for Inventory. The honest options were to ship nothing, to ship a
 * box that says "AI insights coming soon", or to ship a real briefing built
 * from the figures already on the screen and label it for what it is. This is
 * the third. Every line below is a rule over a number the server computed; the
 * component renders it as "Rule-based summary", never as a forecast, never as
 * an AI insight, and never with a confidence percentage attached.
 *
 * If an application-owned AI integration is added later, it belongs behind the
 * API — the browser must not hold a key or call a model directly — and it
 * should EXPLAIN these deterministic findings rather than replace them with
 * numbers of its own.
 *
 * ## The rules
 *
 * A finding is emitted only when its figure is genuinely known and genuinely
 * actionable. Specifically:
 *
 *  - a `null` figure (still loading, or the source failed) emits nothing, so
 *    the briefing never says "0 problems" because it could not count;
 *  - a zero emits nothing, because "nothing is expiring" is not a briefing;
 *  - every finding carries the screen that resolves it, so it is a task and
 *    not an observation.
 *
 * Findings are ranked by severity then size, and the component shows the top
 * three — which is how many a person reads before they stop.
 */

import { formatCount, formatCurrencyCompact, plural } from './formatters'

export type PulseSeverity = 'critical' | 'warning' | 'info'

export interface PulseFinding {
  key: string
  /** One sentence. States the fact; does not editorialise. */
  text: string
  severity: PulseSeverity
  /** The screen that resolves it. */
  to?: string
  /** The link's words — a verb, so it reads as the next action. */
  actionLabel?: string
}

const SEVERITY_RANK: Record<PulseSeverity, number> = { critical: 0, warning: 1, info: 2 }

export interface PulseInput {
  /** Every figure is optional AND nullable: absent means "not known", not zero. */
  negativeStockRows?: number | null
  failedPostings?: number | null
  expiredBatches?: number | null
  expiringBatches?: number | null
  expiringDays?: number
  belowReorder?: number | null
  pendingApproval?: number | null
  overdueInFlight?: number | null
  countVariances?: number | null
  outboxFailed?: number | null
  outboxPending?: number | null
  nonMovingValue?: number | null
  reconciliationDifference?: number | null
  reconciliationStatus?: string | null
  unvaluedMovements?: number | null
  missingCost?: number | null
}

interface Rule {
  key: string
  severity: PulseSeverity
  /** The figure this rule watches. Null or ≤ 0 and the rule stays silent. */
  value: (i: PulseInput) => number | null | undefined
  text: (n: number, i: PulseInput) => string
  to?: (i: PulseInput) => string
  actionLabel?: string
}

const RULES: Rule[] = [
  {
    key: 'failed_postings',
    severity: 'critical',
    value: (i) => i.failedPostings,
    text: (n) => `${plural(n, 'document')} failed to post — the stock on them has not moved.`,
    to: () => '/documents?status=FAILED',
    actionLabel: 'Open failed documents',
  },
  {
    key: 'negative_stock',
    severity: 'critical',
    value: (i) => i.negativeStockRows,
    text: (n) => `${plural(n, 'balance row')} ${n === 1 ? 'is' : 'are'} below zero.`,
    to: () => '/registers/stock-balances?negative=1&sort=on_hand_qty&order=asc',
    actionLabel: 'Investigate',
  },
  {
    key: 'expired',
    severity: 'critical',
    value: (i) => i.expiredBatches,
    text: (n) => `${plural(n, 'batch', 'batches')} on hand ${n === 1 ? 'has' : 'have'} already expired.`,
    to: () => '/reports/near-expiry?expired_only=1&sort=expiry_date&order=asc',
    actionLabel: 'Review expired stock',
  },
  {
    key: 'missing_cost',
    severity: 'warning',
    value: (i) => i.missingCost,
    text: (n) => `${plural(n, 'balance row')} carry stock with no cost against it, so issues out of it are priced by fallback.`,
    to: () => '/registers/valuation',
    actionLabel: 'Open valuation',
  },
  {
    key: 'below_reorder',
    severity: 'warning',
    value: (i) => i.belowReorder,
    text: (n) => `${plural(n, 'item')} ${n === 1 ? 'is' : 'are'} at or below reorder point.`,
    to: () => '/reports/replenishment?only_triggered=1',
    actionLabel: 'Review replenishment',
  },
  {
    key: 'expiring',
    severity: 'warning',
    value: (i) => i.expiringBatches,
    text: (n, i) => `${plural(n, 'batch', 'batches')} expire within ${formatCount(i.expiringDays ?? 30)} days.`,
    to: (i) => `/reports/near-expiry?days=${i.expiringDays ?? 30}&include_expired=0&sort=expiry_date&order=asc`,
    actionLabel: 'Review expiring batches',
  },
  {
    key: 'overdue_in_flight',
    severity: 'warning',
    value: (i) => i.overdueInFlight,
    text: (n) => `${plural(n, 'document')} ${n === 1 ? 'is' : 'are'} past the return date agreed on them.`,
    to: () => '/registers/pending-quantities',
    actionLabel: 'Open pending quantities',
  },
  {
    key: 'count_variances',
    severity: 'warning',
    value: (i) => i.countVariances,
    text: (n) => `${plural(n, 'counted line')} disagree${n === 1 ? 's' : ''} with the system quantity on an unposted count.`,
    to: () => '/documents?document_type=PHYSICAL_ADJUSTMENT',
    actionLabel: 'Review counts',
  },
  {
    key: 'outbox_failed',
    severity: 'warning',
    value: (i) => i.outboxFailed,
    text: (n) => `${plural(n, 'event')} failed on the way to Books.`,
    to: () => '/integration/outbox?status=FAILED',
    actionLabel: 'Open the outbox',
  },
  {
    key: 'unvalued_movements',
    severity: 'warning',
    value: (i) => i.unvaluedMovements,
    text: (n) => `${plural(n, 'stock movement')} in this period carr${n === 1 ? 'ies' : 'y'} no value, so the value bridge is short by whatever they were worth.`,
    to: () => '/registers/movement-register',
    actionLabel: 'Open the movement register',
  },
  {
    key: 'pending_approval',
    severity: 'info',
    value: (i) => i.pendingApproval,
    text: (n) => `${plural(n, 'document')} ${n === 1 ? 'is' : 'are'} waiting for approval.`,
    to: () => '/documents?status=PENDING_APPROVAL',
    actionLabel: 'Open approvals',
  },
  {
    key: 'outbox_pending',
    severity: 'info',
    value: (i) => i.outboxPending,
    text: (n) => `${plural(n, 'event')} ${n === 1 ? 'is' : 'are'} queued for delivery to Books.`,
    to: () => '/integration/outbox?status=PENDING',
    actionLabel: 'Open the outbox',
  },
]

export function buildPulseFindings(input: PulseInput): PulseFinding[] {
  const findings: PulseFinding[] = []

  for (const rule of RULES) {
    const raw = rule.value(input)
    // Null and undefined mean "not known". Only a real positive count speaks.
    if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) continue
    findings.push({
      key: rule.key,
      text: rule.text(raw, input),
      severity: rule.severity,
      to: rule.to?.(input),
      actionLabel: rule.actionLabel,
    })
  }

  // The reconciliation difference is money rather than a count, so it does not
  // fit the rule table above — and its sign carries meaning that must survive.
  const diff = input.reconciliationDifference
  if (diff !== null && diff !== undefined && Number.isFinite(diff) && Math.abs(diff) >= 0.01) {
    findings.push({
      key: 'reconciliation_difference',
      text: `Inventory and Books differ by ${formatCurrencyCompact(Math.abs(diff))} — Books is ${diff > 0 ? 'lower' : 'higher'} than inventory.`,
      severity: 'warning',
      to: '/reconciliation',
      actionLabel: 'Open reconciliation',
    })
  }
  if (input.reconciliationStatus === 'BOOKS_UNAVAILABLE') {
    findings.push({
      key: 'books_unavailable',
      // Said out loud rather than shown as a zero difference: "no difference
      // because we could not ask" and "no difference" look identical on a card
      // and mean opposite things.
      text: 'The last reconciliation could not reach Books, so the difference is unknown rather than nil.',
      severity: 'warning',
      to: '/reconciliation',
      actionLabel: 'Open reconciliation',
    })
  }

  const nonMoving = input.nonMovingValue
  if (nonMoving !== null && nonMoving !== undefined && Number.isFinite(nonMoving) && nonMoving > 0) {
    findings.push({
      key: 'non_moving_value',
      text: `${formatCurrencyCompact(nonMoving)} of stock has not moved in the period.`,
      severity: 'info',
      to: '/reports/movement-analysis',
      actionLabel: 'Review movement',
    })
  }

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/** The one-line headline over the findings list. */
export function pulseHeadline(findings: readonly PulseFinding[], anyDataKnown: boolean): string {
  if (!anyDataKnown) return 'Figures are still loading.'
  if (findings.length === 0) return 'Nothing needs attention in this scope right now.'
  const critical = findings.filter((f) => f.severity === 'critical').length
  if (critical > 0) return `${plural(critical, 'issue')} need${critical === 1 ? 's' : ''} attention now.`
  return `${plural(findings.length, 'thing')} to look at.`
}
