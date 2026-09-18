import { AlertTriangle, CircleCheck, Package, RefreshCw, Tags } from 'lucide-react'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'
import { StatCard, StatCardSkeleton } from '../../ui/StatCard'
import { METRIC_CARD_GRID } from '../../styles/designTokens'
import type { ItemsSummary } from '../../services/items'
import { formatInt } from '../../utils/format'

/**
 * Four counted figures, over the same filtered set the table below shows —
 * `ItemsController::summary()` and `index()` read one shared query builder,
 * so these cards can never disagree with the rows beneath them.
 */
export interface ItemsSummaryCardsProps {
  summary: ItemsSummary | null
  loading: boolean
  error: Error | null
  onRetry: () => void
}

export function ItemsSummaryCards({ summary, loading, error, onRetry }: ItemsSummaryCardsProps) {
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
        The items below are unaffected.
      </Notice>
    )
  }

  if (!summary) {
    return (
      <div className={METRIC_CARD_GRID} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </div>
    )
  }

  const inactive = summary.total - summary.active

  return (
    <div className={METRIC_CARD_GRID} aria-busy={loading || undefined}>
      <StatCard
        layout="metric"
        label="Total items"
        value={formatInt(summary.total)}
        icon={Package}
        tone="primary"
        hint="Matching the current filters"
      />
      <StatCard
        layout="metric"
        label="Active items"
        value={formatInt(summary.active)}
        icon={CircleCheck}
        tone="success"
        hint={inactive > 0 ? `${formatInt(inactive)} inactive` : 'All items active'}
      />
      <StatCard
        layout="metric"
        label="Categories"
        value={formatInt(summary.categories)}
        icon={Tags}
        tone="info"
        hint="Stock categories in use"
      />
      <StatCard
        layout="metric"
        label="Missing SKU"
        value={formatInt(summary.missing_sku)}
        icon={AlertTriangle}
        tone={summary.missing_sku > 0 ? 'warning' : 'success'}
        hint={summary.missing_sku > 0 ? 'No SKU or barcode set' : 'Every item is identified'}
      />
    </div>
  )
}

export default ItemsSummaryCards
