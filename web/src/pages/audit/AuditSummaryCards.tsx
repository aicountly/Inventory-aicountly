import { Activity, ClipboardList, Database, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '../../ui/StatCard'
import { Button } from '../../ui/Button'
import { Notice } from '../../components/Notice'
import type { AuditSummary } from '../../services/auditApi'
import { formatInt } from '../../utils/format'

/**
 * Five cards, five counted figures.
 *
 * Every number comes from `GET /v1/audit-log/summary`, computed by the server
 * over the whole filtered set. None of them is derived from the rows on screen:
 * a card that said "28 actors" because 28 appeared on page one would be wrong
 * on page two and wrong about the question it was asked.
 *
 * The delta chip renders only when the server sent `previous_total`, which it
 * does only when the reader bounded the period at both ends. With no previous
 * window there is nothing to compare, and StatCard draws no chip rather than a
 * zero that reads like a finding.
 *
 * The fifth card states the retention policy instead of a coverage percentage.
 * "100% covered" is a claim about the system, not a measurement; the retention
 * figure is a fact the server can prove — migration 007 puts a BEFORE DELETE
 * trigger on the table, so "never purged" is enforced by the database.
 */

/** 5 → 3 → 2 → 1 as the viewport narrows. */
const GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 shrink-0 print:hidden'

export interface AuditSummaryCardsProps {
  summary: AuditSummary | null
  loading: boolean
  error: Error | null
  onRetry: () => void
}

export function AuditSummaryCards({ summary, loading, error, onRetry }: AuditSummaryCardsProps) {
  if (error && !summary) {
    return (
      <Notice
        kind="warning"
        title="Totals unavailable."
        actions={
          <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        }
      >
        The entries below are unaffected.
      </Notice>
    )
  }

  if (!summary) {
    return (
      <div className={GRID} aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  // StatCard draws a delta only when it can divide by the previous figure, so
  // the "vs preceding period" wording is used only when a chip will appear
  // beside it. An empty period would otherwise leave the phrase standing alone
  // next to nothing.
  const period = summary.previous_total ? 'vs preceding period' : undefined

  return (
    <div className={GRID} aria-busy={loading || undefined}>
      <StatCard
        label="Total entries"
        value={formatInt(summary.total)}
        icon={ClipboardList}
        tone="primary"
        current={summary.total}
        previous={summary.previous_total}
        hint={period ?? 'Matching the current filters'}
      />
      <StatCard
        label="Actors"
        value={formatInt(summary.actors)}
        icon={Users}
        tone="info"
        hint="Distinct people and jobs"
      />
      <StatCard
        label="Source apps"
        value={formatInt(summary.source_apps)}
        icon={Database}
        tone="warning"
        hint="Products that wrote here"
      />
      <StatCard
        label="Event types"
        value={formatInt(summary.event_types)}
        icon={Activity}
        tone="violet"
        hint={`Across ${formatInt(summary.entity_types)} entity types`}
      />
      <StatCard
        label="Retention"
        value={`${summary.retention_years} yrs`}
        icon={ShieldCheck}
        tone="teal"
        hint={summary.may_purge ? 'Append-only' : 'Append-only · never purged'}
      />
    </div>
  )
}

export default AuditSummaryCards
