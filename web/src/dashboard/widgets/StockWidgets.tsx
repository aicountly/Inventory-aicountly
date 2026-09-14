import { Layers, PackageSearch, TrendingUp, Warehouse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Skeleton, SkeletonRows } from '../../ui/Skeleton'
import { formatQty } from '../../utils/format'
import { BarList } from '../charts/BarList'
import { DonutChart } from '../charts/DonutChart'
import { MiniTable } from '../components/MiniTable'
import type { MiniColumn } from '../components/MiniTable'
import { WidgetCard } from '../components/WidgetCard'
import type { WidgetState } from '../components/WidgetCard'
import { formatCount, formatCurrencyCompact, formatQtyCompact } from '../formatters'
import { drill } from '../kpiNavigation'
import { ageingSeries, movementSeries, topShare, warehouseSeries } from '../model'
import type { StockValueSnapshot } from '../dashboardApi'
import type {
  MovementAnalysisSummary,
  StockAgeingSummary,
  StockSummaryRow,
  WarehouseStockSummary,
} from '../../services/reportsApi'

interface Loadable<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
}

/**
 * A widget is "loading" until it has either data or an error — not merely while
 * a request is in flight. Before the company scope and the permission list
 * resolve, useQuery has not started yet and reports `loading: false` with no
 * data; keying off that would flash an empty card body on first paint and then
 * swap in the skeleton. Keying off the absence of a result never does.
 */
function state<T>(q: Loadable<T>, empty: boolean): WidgetState {
  return {
    loading: q.data === null && q.error === null,
    error: q.error,
    empty: q.data !== null && empty,
    reload: q.reload,
  }
}

// ---------------------------------------------------------------------------
// Where the money is
// ---------------------------------------------------------------------------

export function WarehouseValueWidget({ query, asOf }: { query: Loadable<WarehouseStockSummary>; asOf: string }) {
  const summary = query.data
  const series = warehouseSeries(summary, asOf)
  const lead = topShare(series)

  return (
    <WidgetCard
      title="Stock value by warehouse"
      description={`Closing value as at ${asOf}`}
      icon={Warehouse}
      tone="primary"
      viewAll={{ to: drill.warehouseStock({ asOf }) }}
      state={state(query, series.length === 0)}
      skeleton={
        <div className="flex items-center gap-4">
          <Skeleton className="w-[132px] h-[132px] rounded-full shrink-0" />
          <SkeletonRows rows={4} className="flex-1" />
        </div>
      }
      emptyIcon={Warehouse}
      emptyTitle="No stock is held anywhere yet"
      emptyDescription="Post a receipt, or check that the branch filter is not hiding your warehouses."
      footer={
        lead ? (
          <span>
            <span className="font-semibold text-gray-700">{lead.label}</span> holds {lead.share.toFixed(0)}% of the
            value.
          </span>
        ) : null
      }
    >
      <DonutChart
        items={series}
        centerValue={formatCurrencyCompact(summary?.closing_value ?? 0)}
        ariaLabel="Stock value by warehouse"
      />
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// How long it has been sitting there
// ---------------------------------------------------------------------------

export function AgeingWidget({ query, asOf }: { query: Loadable<StockAgeingSummary>; asOf: string }) {
  const summary = query.data
  const series = ageingSeries(summary, asOf)
  const stale = series.filter((s) => s.key === '91_180' || s.key === '180_plus').reduce((a, s) => a + s.value, 0)
  const staleShare = summary && summary.total_value > 0 ? (stale / summary.total_value) * 100 : 0

  return (
    <WidgetCard
      title="Stock ageing"
      description="Value of remaining cost layers by age"
      icon={Layers}
      tone="warning"
      viewAll={{ to: drill.stockAgeing({ asOf }) }}
      state={state(query, !summary || summary.total_value === 0)}
      skeleton={<SkeletonRows rows={5} />}
      emptyIcon={Layers}
      emptyTitle="No ageing to report"
      emptyDescription="Ageing is built from open cost layers — it appears once stock has been received and valued."
      footer={
        summary ? (
          <div className="flex items-center justify-between gap-2">
            <span>
              Over 90 days:{' '}
              <span className={`font-semibold ${staleShare > 25 ? 'text-rose-600' : 'text-gray-700'}`}>
                {formatCurrencyCompact(stale)} ({staleShare.toFixed(0)}%)
              </span>
            </span>
            <span className="font-semibold text-gray-700 tabular-nums">{formatCurrencyCompact(summary.total_value)}</span>
          </div>
        ) : null
      }
    >
      <BarList items={series} />
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// What is actually moving
// ---------------------------------------------------------------------------

export function MovementMixWidget({ query }: { query: Loadable<MovementAnalysisSummary> }) {
  const summary = query.data
  const series = movementSeries(summary)
  const items = series.reduce((a, s) => a + s.value, 0)
  const dead = series.find((s) => s.key === 'dead')?.value ?? 0

  return (
    <WidgetCard
      title="Movement mix"
      description={summary ? `${summary.from} → ${summary.to}` : 'This financial year'}
      icon={TrendingUp}
      tone="info"
      viewAll={
        summary ? { to: drill.movementAnalysis({ from: summary.from, to: summary.to }) } : undefined
      }
      state={state(query, items === 0)}
      skeleton={<SkeletonRows rows={4} />}
      emptyIcon={TrendingUp}
      emptyTitle="No movement in this period"
      emptyDescription="Once documents post, items are classified fast, slow, non-moving or dead."
      footer={
        summary ? (
          <div className="flex items-center justify-between gap-2">
            <span>
              Dead after {summary.thresholds.dead_days} days idle:{' '}
              <span className={`font-semibold ${dead > 0 ? 'text-rose-600' : 'text-gray-700'}`}>
                {formatCount(dead)}
              </span>
            </span>
            <Link
              to={drill.movementAnalysis({ from: summary.from, to: summary.to, cls: 'dead' })}
              className="font-semibold text-primary hover:underline print:hidden"
            >
              Review
            </Link>
          </div>
        ) : null
      }
    >
      <BarList items={series} />
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// The items carrying the value
// ---------------------------------------------------------------------------

const TOP_ITEM_COLUMNS: MiniColumn<StockSummaryRow>[] = [
  {
    key: 'item',
    header: 'Item',
    render: (r) => (
      <span className="block min-w-0">
        <span className="block font-medium text-gray-800 truncate max-w-[13rem]" title={r.item_name ?? ''}>
          {r.item_name ?? `Item ${r.item_id}`}
        </span>
        {r.item_sku ? <span className="block text-label-xs text-gray-400 truncate">{r.item_sku}</span> : null}
      </span>
    ),
  },
  {
    key: 'closing_qty',
    header: 'On hand',
    align: 'right',
    render: (r) => (
      <span className={r.closing_qty < 0 ? 'text-red-600 font-semibold' : ''}>
        {formatQty(r.closing_qty)}
        {r.unit_symbol ? <span className="text-gray-400"> {r.unit_symbol}</span> : null}
      </span>
    ),
  },
  {
    key: 'closing_value',
    header: 'Value',
    align: 'right',
    render: (r) => <span className="font-semibold text-gray-900">{formatCurrencyCompact(r.closing_value)}</span>,
  },
]

export function TopItemsWidget({
  query,
  asOf,
  period,
}: {
  query: Loadable<StockValueSnapshot>
  asOf: string
  period: { from: string; to: string }
}) {
  const snapshot = query.data
  const rows = snapshot?.topItems ?? []

  return (
    <WidgetCard
      title="Where the value sits"
      description={rows.length ? `Top ${rows.length} items by closing value` : 'Items by closing value'}
      icon={PackageSearch}
      tone="success"
      viewAll={{ to: drill.stockValue({ asOf }) }}
      state={state(query, rows.length === 0)}
      skeleton={<SkeletonRows rows={6} />}
      emptyIcon={PackageSearch}
      emptyTitle="Nothing is carrying value"
      emptyDescription="No item has a non-zero closing balance as at this date."
      footer={
        snapshot ? (
          <div className="flex items-center justify-between gap-2">
            <span>
              {formatCount(snapshot.summary.items)} items · {formatQtyCompact(snapshot.summary.closing_qty)} units
            </span>
            <span className="font-semibold text-gray-700 tabular-nums">
              {formatCurrencyCompact(snapshot.summary.closing_value)}
            </span>
          </div>
        ) : null
      }
    >
      <MiniTable
        columns={TOP_ITEM_COLUMNS}
        rows={rows}
        rowKey={(r) => r.item_id}
        to={(r) => drill.itemLedger(r.item_id, period)}
      />
    </WidgetCard>
  )
}
