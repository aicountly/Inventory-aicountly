import { AlertTriangle, CircleCheck, CircleSlash, Package, TrendingDown } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { formatInt } from '../../../utils/format'
import type { ItemsSummary } from '../../../services/items'

export interface ItemsKpiStripProps {
  summary: ItemsSummary | null
  loading: boolean
  /** Builds the URL a card navigates to, merging into the filters already set. */
  hrefFor: (patch: Record<string, string>) => string
  /** Which card is currently the active filter, so it can be marked. */
  activeStockStatus: string
  activeStatus: string
}

const GRID = 'grid shrink-0 grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-5 print:hidden'

/**
 * The four figures that decide whether the catalogue needs attention, plus a
 * fifth on a wide screen.
 *
 * Every card is a LINK, not a button: the filters live in the query string, so
 * "Low stock" is a real URL that survives a refresh, a Back, and being pasted
 * into a message to whoever has to go and count the shelf. The href merges into
 * whatever narrowing is already applied rather than replacing it, so clicking
 * Low stock inside "Brand: Tata" asks the question the reader actually has.
 *
 * No card carries a percentage-change chip. `StatCard` renders one only when it
 * is given a previous-period figure, and there is no comparatives endpoint for
 * the item master — an invented "+18 this month" under a real count would be
 * the one number on the page nobody could check.
 */
export function ItemsKpiStrip({ summary, loading, hrefFor, activeStockStatus, activeStatus }: ItemsKpiStripProps) {
  if (loading && !summary) {
    return (
      <div className={GRID} aria-hidden>
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" />
        <StatCardSkeleton layout="metric" className="hidden xl:flex" />
      </div>
    )
  }
  // The summary endpoint failing must not take the item list down with it, so
  // the strip simply stops existing and the rows carry on below.
  if (!summary) return null

  const pct = summary.total > 0 ? `${((summary.active / summary.total) * 100).toFixed(1)}% of the catalogue` : 'No items yet'

  return (
    <div className={GRID}>
      <StatCard
        layout="metric"
        label="Total items"
        value={formatInt(summary.total)}
        icon={Package}
        tone="primary"
        hint="All items in scope"
        to={hrefFor({ status: '', stock_status: '' })}
      />
      <StatCard
        layout="metric"
        label="Active"
        value={formatInt(summary.active)}
        icon={CircleCheck}
        tone="success"
        hint={pct}
        badge={activeStatus === 'active' ? { label: 'Filtered', tone: 'primary' } : undefined}
        to={hrefFor({ status: 'active', stock_status: '' })}
      />
      <StatCard
        layout="metric"
        label="Low stock"
        value={formatInt(summary.low_stock)}
        icon={AlertTriangle}
        tone={summary.low_stock > 0 ? 'warning' : 'slate'}
        hint={summary.low_stock > 0 ? 'At or below reorder level' : 'None at reorder level'}
        badge={activeStockStatus === 'low' ? { label: 'Filtered', tone: 'primary' } : undefined}
        to={hrefFor({ stock_status: 'low', status: '' })}
      />
      <StatCard
        layout="metric"
        label="Negative stock"
        value={formatInt(summary.negative_stock)}
        icon={TrendingDown}
        tone={summary.negative_stock > 0 ? 'danger' : 'slate'}
        hint={summary.negative_stock > 0 ? 'Needs stock correction' : 'None below zero'}
        badge={activeStockStatus === 'negative' ? { label: 'Filtered', tone: 'primary' } : undefined}
        to={hrefFor({ stock_status: 'negative', status: '' })}
      />
      <StatCard
        layout="metric"
        className="hidden xl:flex"
        label="Out of stock"
        value={formatInt(summary.out_of_stock)}
        icon={CircleSlash}
        tone={summary.out_of_stock > 0 ? 'warning' : 'slate'}
        hint={`${formatInt(summary.stock_tracked)} items hold stock`}
        badge={activeStockStatus === 'out' ? { label: 'Filtered', tone: 'primary' } : undefined}
        to={hrefFor({ stock_status: 'out', status: '' })}
      />
    </div>
  )
}
