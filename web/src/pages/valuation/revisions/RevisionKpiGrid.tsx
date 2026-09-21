import { CircleCheck, Coins, Cog, FileWarning, Package } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { REGISTER_KPI_GRID } from '../../../styles/designTokens'
import { formatCompactMoney, formatInt, formatMoney } from '../../../utils/format'
import type { RevisionSummary } from '../../../services/valuationApi'

export interface RevisionKpiGridProps {
  summary: RevisionSummary | null
  loading: boolean
  currency: string
  /** Whether the reader may open the recalculation queue the jobs card links to. */
  canRecalculate: boolean
  canReconcile: boolean
}

/**
 * The five figures an operator reads before anything else.
 *
 * Two rules hold across all of them:
 *
 *  - **Every number is a server aggregate**, computed over the whole filtered set. Nothing
 *    here counts the rows that happen to be on this page.
 *  - **A delta chip only appears where two comparable periods exist.** StatCard draws no chip
 *    at all when `previous` is missing, and that is the designed state: a made-up comparative
 *    on a costing screen is a number somebody will repeat in a meeting.
 */
export function RevisionKpiGrid({ summary, loading, canRecalculate, canReconcile, currency }: RevisionKpiGridProps) {
  if (!summary && loading) {
    return (
      <section className={REGISTER_KPI_GRID} aria-label="Valuation revision summary">
        {Array.from({ length: 5 }, (_, i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </section>
    )
  }
  if (!summary) return null

  const { company, filtered, jobs, window } = summary
  const queued = jobs.queued + jobs.running
  // The comparison is only honest when the reader's own filters bound a period: with no date
  // filter the list is every matching revision ever, and "the previous 10 days" describes
  // something else entirely.
  const comparable = window.explicit_range

  return (
    <section className={REGISTER_KPI_GRID} aria-label="Valuation revision summary">
      <StatCard
        layout="metric"
        label="Pending revisions"
        value={formatInt(company.pending)}
        icon={FileWarning}
        tone={company.pending > 0 ? 'danger' : 'success'}
        current={company.created_last_7d}
        previous={company.created_prev_7d}
        // Up is bad: more new revisions is more for Books to re-post.
        invertDelta
        hint="new revisions vs previous 7 days"
        to={canReconcile ? '/reconciliation/posting-status' : undefined}
      />

      <StatCard
        layout="metric"
        label="Net valuation impact"
        value={formatCompactMoney(filtered.net_delta, currency)}
        icon={Coins}
        tone={filtered.net_delta > 0 ? 'warning' : 'primary'}
        current={comparable ? filtered.abs_delta : undefined}
        previous={comparable ? summary.previous.abs_delta : undefined}
        invertDelta
        hint={
          comparable
            ? `movement vs previous ${window.days} day${window.days === 1 ? '' : 's'}`
            : `${formatMoney(filtered.abs_delta)} gross movement`
        }
      />

      <StatCard
        layout="metric"
        label="Items affected"
        value={formatInt(filtered.items_affected)}
        icon={Package}
        tone="info"
        hint={`${formatInt(filtered.items_increased)} with increases · ${formatInt(filtered.items_decreased)} with decreases`}
      />

      <StatCard
        layout="metric"
        label="Jobs in queue"
        value={formatInt(queued)}
        icon={Cog}
        tone={jobs.failed > 0 ? 'danger' : queued > 0 ? 'warning' : 'slate'}
        hint={`${formatInt(jobs.running)} running · ${formatInt(jobs.failed)} failed`}
        to={canRecalculate ? '/valuation/recalculations' : undefined}
      />

      <StatCard
        layout="metric"
        label="Acknowledged today"
        value={formatInt(company.acknowledged_today)}
        icon={CircleCheck}
        tone="success"
        current={company.acknowledged_today}
        previous={company.acknowledged_yesterday}
        hint="vs yesterday"
      />
    </section>
  )
}

export default RevisionKpiGrid
