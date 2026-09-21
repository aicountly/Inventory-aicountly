import { CalendarCheck2, Layers3, TrendingUp, Wallet } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import type { BadgeTone } from '../../../ui/Badge'
import type { CostLayerDistribution, CostLayersSummary, RecalcJob } from '../../../services/valuationApi'
import type { RegistersSummary } from '../../../services/registersApi'
import { formatCompactMoney, formatDate, formatInt, formatMoney } from '../../../utils/format'
import { costSpread, openLayerCount } from './costLayersModel'

const NOT_YET = 'Choose an item to read this'

const JOB_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  COMPLETED: { label: 'Successful', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  RUNNING: { label: 'Running', tone: 'warning' },
  QUEUED: { label: 'Queued', tone: 'info' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

export interface CostLayerKpisProps {
  /** Company counters — the only figure here that is not item-scoped. */
  registers: RegistersSummary | null
  summary: CostLayersSummary | null
  distribution: CostLayerDistribution | null | undefined
  lastJob: RecalcJob | null
  hasItem: boolean
  /** True only on the FIRST load; a refresh keeps the figures and dims them. */
  loading: boolean
}

/**
 * The four figures worth reading before the table.
 *
 * None of them is computed from the rows on screen. The company's stock value
 * is the registers summary's, dated by the run that produced it; the layer
 * counts and the cost spread are the server's aggregates over every layer the
 * filters match, not over the current page; the recalculation is the latest job
 * on record. A card with no figure behind it shows a dash and says why —
 * `StatCard` draws no delta chip without a real comparative, which is the
 * designed fallback for endpoints that send none.
 */
export function CostLayerKpis({
  registers,
  summary,
  distribution,
  lastJob,
  hasItem,
  loading,
}: CostLayerKpisProps) {
  if (loading) {
    return (
      <>
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </>
    )
  }

  const stockValue = registers?.stock_value ?? null
  const currency = registers?.currency ?? 'INR'

  const open = openLayerCount(distribution)
  const totalLayers = distribution?.layer_count ?? null
  const spread = costSpread(summary)
  const badge = lastJob ? JOB_BADGE[lastJob.status] : undefined

  return (
    <>
      <StatCard
        layout="metric"
        icon={Wallet}
        tone="primary"
        label="Inventory value"
        value={stockValue ? formatCompactMoney(stockValue.amount, currency) : '—'}
        hint={
          stockValue
            ? `Whole company as at ${formatDate(stockValue.as_of)}`
            : 'No closing value recorded yet'
        }
        to="/valuation"
      />

      <StatCard
        layout="metric"
        icon={Layers3}
        tone="success"
        label="Open layers"
        value={hasItem && open !== null ? formatInt(open) : '—'}
        hint={
          !hasItem
            ? NOT_YET
            : open === null
              ? 'Layer states are not available from this API'
              : `Of ${formatInt(totalLayers ?? 0)} layers, holding ${formatMoney(summary?.open_value ?? 0)}`
        }
      />

      <StatCard
        layout="metric"
        icon={TrendingUp}
        tone={spread && spread.spreadPct >= 25 ? 'warning' : 'info'}
        label="Cost variance"
        value={hasItem && spread ? `${spread.spreadPct.toFixed(1)}%` : '—'}
        hint={
          !hasItem
            ? NOT_YET
            : spread
              ? `Cheapest ${formatMoney(spread.min)}, dearest ${formatMoney(spread.max)}, weighted average ${formatMoney(spread.avg)}`
              : 'Needs at least two layers with a cost'
        }
      />

      <StatCard
        layout="metric"
        icon={CalendarCheck2}
        tone={lastJob?.status === 'FAILED' ? 'danger' : 'info'}
        label="Last recalculation"
        value={lastJob ? formatDate(lastJob.finished_at ?? lastJob.created_at) : '—'}
        badge={badge}
        hint={
          lastJob
            ? `${formatInt(lastJob.revised_line_count ?? 0)} lines revised from ${formatDate(lastJob.from_date)}`
            : 'No recalculation has been run in this year'
        }
        to="/valuation/recalculations"
      />
    </>
  )
}

export default CostLayerKpis
