import { Boxes, Clock3, PackageCheck, RefreshCw, TriangleAlert, Warehouse } from 'lucide-react'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { Tooltip } from '../../../ui/Tooltip'
import type { BatchHealth, BatchSummary } from '../../../services/batchesApi'
import { formatInt, formatQty } from '../../../utils/format'

/**
 * Five figures, all counted by the server over the whole filtered set.
 *
 * None of them is derived from the rows on screen. A card that said "248
 * batches" because 50 were loaded and the pager claimed five pages would be a
 * different number on a different page size, and the reader has no way to tell.
 *
 * Four of the five are also the fastest filter on the page: each links back to
 * this same URL with `health` set, so the figure and the rows under it always
 * agree, the state is shareable, and the card is a real link a middle-click can
 * open. "Total on hand" is a quantity, not a set of rows, so it links nowhere.
 *
 * The delta chip on "Total batches" renders only when the summary carried
 * `previous_total` — how many of these batches already existed a month ago.
 * That is the one comparison a master which grows by registration can honestly
 * make; there is no invented "vs last period" anywhere on this strip.
 */

/** 5 → 3 → 2 → 1 as the viewport narrows. */
const GRID = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 shrink-0 print:hidden'

export interface BatchKpiCardsProps {
  summary: BatchSummary | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  /** Same URL, `health` replaced. Built by the page so filters survive. */
  healthLink: (health: BatchHealth | '') => string
  activeHealth: string
}

function share(part: number, whole: number): string {
  if (whole <= 0) return 'No batches match these filters'
  return `${Math.round((part / whole) * 100)}% of ${formatInt(whole)}`
}

export function BatchKpiCards({
  summary,
  loading,
  error,
  onRetry,
  healthLink,
  activeHealth,
}: BatchKpiCardsProps) {
  if (error && !summary) {
    return (
      <Notice
        kind="warning"
        title="Batch totals unavailable."
        actions={
          <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        }
      >
        The batches below are unaffected.
      </Notice>
    )
  }

  if (!summary) {
    return (
      <section className={GRID} aria-label="Batch summary" aria-busy>
        {[0, 1, 2, 3, 4].map((i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </section>
    )
  }

  const days = summary.near_expiry_days
  /*
   * The chip marks the card whose filter is in force. "Total batches" never
   * carries it: no health filter is the resting state of the page, and a card
   * that reads "Filtered" on arrival would be telling the reader that something
   * has been left narrowed when nothing has.
   */
  const on = (health: BatchHealth) =>
    activeHealth === health ? ({ label: 'Filtered', tone: 'primary' as const }) : undefined

  return (
    <section className={GRID} aria-label="Batch summary" aria-busy={loading || undefined}>
      <Tooltip label="Every batch matching the current company, branch and filters." className="h-full">
        <StatCard
          layout="metric"
          className="w-full"
          label="Total batches"
          value={formatInt(summary.total)}
          icon={Boxes}
          tone="violet"
          to={healthLink('')}
          current={summary.total}
          previous={summary.previous_total || null}
          hint={`vs ${summary.comparison_days} days ago`}
        />
      </Tooltip>

      <Tooltip label="In circulation: not expired, not on hold, and outside the expiry warning window." className="h-full">
        <StatCard
          layout="metric"
          className="w-full"
          label="Active batches"
          value={formatInt(summary.active)}
          icon={PackageCheck}
          tone="success"
          to={healthLink('active')}
          badge={on('active')}
          hint={share(summary.active, summary.total)}
        />
      </Tooltip>

      <Tooltip label={`Batches expiring within the warning period of ${days} days.`} className="h-full">
        <StatCard
          layout="metric"
          className="w-full"
          label="Expiring soon"
          value={formatInt(summary.expiring_soon)}
          icon={Clock3}
          tone="warning"
          to={healthLink('expiring')}
          badge={on('expiring')}
          hint={`within ${days} days`}
        />
      </Tooltip>

      <Tooltip label="Batches whose expiry date has passed, or that the API has marked expired." className="h-full">
        <StatCard
          layout="metric"
          className="w-full"
          label="Expired"
          value={formatInt(summary.expired)}
          icon={TriangleAlert}
          tone="danger"
          to={healthLink('expired')}
          badge={on('expired')}
          hint={summary.expired > 0 ? 'needs attention' : 'nothing overdue'}
        />
      </Tooltip>

      <Tooltip label="Total physical quantity currently on hand across the matching batches." className="h-full">
        <StatCard
          layout="metric"
          className="w-full"
          label="Total on hand"
          value={formatQty(summary.total_on_hand, '0')}
          icon={Warehouse}
          tone="info"
          hint={`${formatInt(summary.with_stock)} of ${formatInt(summary.total)} batches carry stock`}
        />
      </Tooltip>
    </section>
  )
}

export default BatchKpiCards
