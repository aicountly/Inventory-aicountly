import { AlertTriangle, CircleCheck, Package, Truck } from 'lucide-react'
import { Notice } from '../components/Notice'
import { StatCard, StatCardSkeleton } from '../ui/StatCard'
import { METRIC_CARD_GRID } from '../styles/designTokens'
import { formatCompactMoney, formatDate, formatInt } from '../utils/format'
import type { SerialSummary } from '../services/masters'

/**
 * The four counters over the table.
 *
 * `StatCard` rather than a card of this module's own, deliberately: a figure
 * should mean the same thing and look the same in Inventory wherever it appears,
 * and the workspace gains nothing from a fifth KPI card in the codebase.
 *
 * ## Why there is no sparkline
 *
 * The design this was built to shows a trend line on each card. `inv_serials`
 * records a serial's CURRENT status and no history of it: a serial that is
 * `issued` today was never written down as `in_stock` yesterday. A line drawn
 * over that would be a shape invented in the browser, and a stock controller
 * would read it as a trend. So the one comparative the schema can honestly
 * produce is the one shown — serials on record a month ago, from `created_at`,
 * on the Total card — and the other three cards carry a caption instead of a
 * delta. `StatCard` renders no chip when no `previous` is passed, which is
 * exactly the designed fallback for an endpoint without comparatives.
 */
export interface SerialKpiGridProps {
  summary: SerialSummary | null
  loading: boolean
  failed: boolean
  costVisible: boolean
  currency: string
  /** Builds the list URL for a card's drill-down, preserving the other filters. */
  hrefForStatus: (group: string) => string
  onRetry: () => void
}

function share(part: number | undefined, total: number | undefined): string | null {
  if (!part || !total || total <= 0) return null
  return `${Math.round((part / total) * 100)}% of all serials`
}

export function SerialKpiGrid({
  summary,
  loading,
  failed,
  costVisible,
  currency,
  hrefForStatus,
  onRetry,
}: SerialKpiGridProps) {
  if (failed && !summary) {
    // The table is fine; only the counters are missing. A page that threw away
    // the rows because a count failed would be trading the thing the reader
    // came for against the thing above it.
    return (
      <Notice kind="warning">
        The serial counters could not be loaded. The list below is unaffected.{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      </Notice>
    )
  }

  if (!summary || (loading && !summary)) {
    return (
      <div className={METRIC_CARD_GRID} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </div>
    )
  }

  const total = summary.total
  const value = costVisible && summary.in_stock_value ? formatCompactMoney(summary.in_stock_value, currency) : null

  return (
    <section className={METRIC_CARD_GRID} aria-label="Serial number summary">
      <StatCard
        layout="metric"
        label="Total serial numbers"
        value={formatInt(total)}
        icon={Package}
        tone="primary"
        current={total}
        previous={summary.previous_total ?? undefined}
        hint={summary.previous_as_of ? `vs ${formatDate(summary.previous_as_of)}` : undefined}
        to={hrefForStatus('')}
      />
      <StatCard
        layout="metric"
        label="In stock"
        value={formatInt(summary.groups?.in_stock ?? 0)}
        icon={CircleCheck}
        tone="success"
        hint={value ? `${value} at cost` : (share(summary.groups?.in_stock, total) ?? 'Available for sale')}
        to={hrefForStatus('in_stock')}
      />
      <StatCard
        layout="metric"
        label="Allocated"
        value={formatInt(summary.groups?.allocated ?? 0)}
        icon={Truck}
        tone="warning"
        hint="Expected, reserved or in transit"
        to={hrefForStatus('allocated')}
      />
      <StatCard
        layout="metric"
        label="Out of stock"
        value={formatInt(summary.groups?.out ?? 0)}
        icon={AlertTriangle}
        tone="danger"
        hint="Issued, returned or written off"
        to={hrefForStatus('out')}
      />
    </section>
  )
}

export default SerialKpiGrid
