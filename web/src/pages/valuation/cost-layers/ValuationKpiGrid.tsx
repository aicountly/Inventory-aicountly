import { CalendarClock, Coins, Layers3, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { Badge } from '../../../ui/Badge'
import { METRIC_CARD_GRID } from '../../../styles/designTokens'
import { formatDateTime, formatInt, formatMoney } from '../../../utils/format'
import type { RecalcJob, ValuationSnapshotSummary } from '../../../services/valuationApi'
import type { CostStats } from '../costLayerModel'

export interface ValuationKpiGridProps {
  companySummary: ValuationSnapshotSummary | null
  companyLoading: boolean
  /** Null until an item is chosen — the layer figures are per item. */
  stats: CostStats | null
  layerTotal: number
  layersLoading: boolean
  lastJob: RecalcJob | null
  jobsLoading: boolean
  itemSelected: boolean
}

/**
 * The four figures above the grid.
 *
 * Three of them are somebody's answer, not ours: the inventory value is the
 * valuation snapshot's own total, the layer counts are the cost-layer
 * endpoint's, and the last recalculation is the newest row of the recalculation
 * queue.
 *
 * The fourth would have been "average cost variance vs the previous period",
 * and it is not here, because nothing in this API returns a previous period's
 * unit cost. What IS computable from the layers on hand is how far apart they
 * are held, so that is what the card shows and what its label says. A card
 * headed "variance" carrying a spread would be a number a controller could
 * take to a meeting and be wrong about.
 */
export function ValuationKpiGrid({
  companySummary,
  companyLoading,
  stats,
  layerTotal,
  layersLoading,
  lastJob,
  jobsLoading,
  itemSelected,
}: ValuationKpiGridProps) {
  return (
    <section className={METRIC_CARD_GRID} aria-label="Valuation summary">
      {companyLoading && !companySummary ? (
        <StatCardSkeleton layout="metric" />
      ) : (
        <StatCard
          layout="metric"
          icon={Coins}
          tone="primary"
          label="Inventory value"
          value={companySummary ? formatMoney(companySummary.total_value) : '—'}
          hint={
            companySummary
              ? `${formatInt(companySummary.item_count)} items valued as at ${companySummary.as_of}`
              : 'Valuation snapshot unavailable'
          }
          to="/registers/valuation"
        />
      )}

      {layersLoading && !stats ? (
        <StatCardSkeleton layout="metric" />
      ) : (
        <StatCard
          layout="metric"
          icon={Layers3}
          tone="success"
          label="Open layers"
          value={itemSelected && stats ? formatInt(stats.openLayers) : '—'}
          hint={
            itemSelected && stats
              ? `Of ${formatInt(layerTotal)} layers on this item`
              : 'Pick an item to count its layers'
          }
        />
      )}

      {layersLoading && !stats ? (
        <StatCardSkeleton layout="metric" />
      ) : (
        <StatCard
          layout="metric"
          icon={TrendingUp}
          tone="info"
          label="Unit cost spread"
          value={
            itemSelected && stats?.spreadPct != null ? `${stats.spreadPct.toFixed(1)}%` : '—'
          }
          hint={
            itemSelected && stats?.spreadPct != null
              ? `Across ${formatInt(stats.openLayers)} open layers, averaging ${formatMoney(stats.weightedAvgCost)}`
              : itemSelected
                ? 'No open layers to compare'
                : 'Pick an item to compare its layer costs'
          }
        />
      )}

      {jobsLoading && !lastJob ? (
        <StatCardSkeleton layout="metric" />
      ) : (
        <StatCard
          layout="metric"
          icon={CalendarClock}
          tone={lastJob?.status === 'FAILED' ? 'danger' : 'violet'}
          label="Last recalculation"
          value={
            lastJob ? (
              <span className="text-base">{formatDateTime(lastJob.finished_at ?? lastJob.created_at)}</span>
            ) : (
              '—'
            )
          }
          badge={
            lastJob
              ? {
                  label: lastJob.status,
                  tone:
                    lastJob.status === 'COMPLETED'
                      ? 'success'
                      : lastJob.status === 'FAILED'
                        ? 'danger'
                        : 'warning',
                }
              : undefined
          }
          hint={
            lastJob
              ? `${formatInt(lastJob.revised_line_count ?? 0)} lines revised · ${lastJob.item_id ? 'one item' : 'all items'}${lastJob.dry_run ? ' · dry run' : ''}`
              : 'No recalculation has run in this company'
          }
          to="/valuation/recalculations"
        />
      )}
    </section>
  )
}

/**
 * The "no scheduled run" line the mock's fourth card carried.
 *
 * Inventory recalculates on demand and on a backdated posting; there is no
 * schedule to report, so rather than print a date nobody set, the panel says
 * what actually triggers the next one.
 */
export function RecalculationCadenceNote({ lastJob }: { lastJob: RecalcJob | null }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-500">
      Recalculation is not scheduled — it runs when you ask for one, and automatically when a
      backdated receipt or edit lands.{' '}
      {lastJob ? (
        <>
          The last job was <Link to="/valuation/recalculations" className="font-semibold text-primary hover:underline">#{lastJob.job_id}</Link>
          , triggered by {lastJob.trigger_kind.replace(/_/g, ' ')}.{' '}
        </>
      ) : null}
      <Badge tone="neutral" size="xs" className="normal-case">on demand</Badge>
    </p>
  )
}

export default ValuationKpiGrid
