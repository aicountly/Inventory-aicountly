import { Link } from 'react-router-dom'
import { Activity, ArrowDownRight, ArrowUpRight, ExternalLink } from 'lucide-react'
import { useQuery } from '../../hooks/useQuery'
import { errorMessage } from '../../services/api'
import { Skeleton } from '../../ui'
import { AIC, cx } from '../../ui/cx'
import { formatCompactMoney, formatQty } from '../../utils/format'
import { fetchIssueInsights } from './materialIssueApi'

export interface MaterialIssueInsightsProps {
  warehouseId: number | null
  warehouseName: string
  /** Drives the "as at" of the stock figure and which month is counted. */
  asOf: string
  currencyCode: string
  /** Changes when the company / FY / branch does, so figures never outlive their scope. */
  scopeKey: string | number | null
}

function DeltaChip({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[10px] text-gray-400">no prior month</span>
  }
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums',
        up ? 'text-emerald-600' : 'text-red-600',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {up ? '+' : ''}
      {value}%
      <span className="sr-only"> against last month</span>
    </span>
  )
}

/**
 * Live Stock Insight.
 *
 * Every figure is a real read: the stock is the warehouse-stock report's closing
 * quantity as at the document date, the two month figures are the documents
 * register's own summary over posted material issues, and the change is against
 * the previous calendar month. Nothing here is seeded, and a read that fails
 * says so instead of showing a number it does not have.
 */
export function MaterialIssueInsights({ warehouseId, warehouseName, asOf, currencyCode, scopeKey }: MaterialIssueInsightsProps) {
  const insights = useQuery(
    (signal) => fetchIssueInsights({ warehouseId, asOf, signal }),
    [warehouseId, asOf],
    { resetKey: scopeKey },
  )

  const reportsHref = warehouseId ? `/reports/warehouse-stock?warehouse_id=${warehouseId}` : '/reports/warehouse-stock'
  const data = insights.data

  return (
    <section className={cx(AIC, 'rounded-xl border border-gray-200 bg-white p-4 shadow-card')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
            <Activity className="h-4 w-4 text-emerald-600" aria-hidden />
          </span>
          <h3 className="truncate text-sm font-semibold text-gray-900">Live stock insight</h3>
        </div>
        <Link
          to={reportsHref}
          className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          View reports
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {insights.error && !data ? (
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50/60 p-3">
          <p className="text-xs font-medium text-red-700">Stock insight could not be loaded.</p>
          <p className="mt-0.5 text-[11px] text-red-600">{errorMessage(insights.error)}</p>
          <button
            type="button"
            onClick={insights.reload}
            className="mt-2 rounded text-xs font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="space-y-2">
          <Skeleton height="h-[88px]" rounded="xl" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton height="h-[88px]" rounded="lg" />
            <Skeleton height="h-[88px]" rounded="lg" />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* A flat wash, not a gradient: dark-overrides.css remaps background
              colours but cannot reach a gradient stop, so a gradient surface
              stays bright on a dark card. */}
          <div className="rounded-xl bg-sky-50 p-4">
            <span className="text-xs text-gray-600">
              Current stock{warehouseName ? ` · ${warehouseName}` : ' · all warehouses'}
            </span>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <strong className="text-2xl font-bold tabular-nums text-gray-900">{formatQty(data.currentStock, '0')}</strong>
              <small className="text-xs text-gray-500">units</small>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex min-h-[88px] flex-col justify-center rounded-lg border border-gray-200 p-3">
              <span className="text-[10px] leading-tight text-gray-500">Items issued (this month)</span>
              <strong className="mt-1.5 text-lg font-bold tabular-nums text-gray-900">{formatQty(data.issuedLines, '0')}</strong>
              <span className="mt-1">
                <DeltaChip value={data.issuedLinesDelta} />
              </span>
            </div>
            <div className="flex min-h-[88px] flex-col justify-center rounded-lg border border-gray-200 p-3">
              <span className="text-[10px] leading-tight text-gray-500">Value of issue (this month)</span>
              <strong
                className="mt-1.5 truncate text-lg font-bold tabular-nums text-gray-900"
                title={String(data.issuedValue)}
              >
                {formatCompactMoney(data.issuedValue, currencyCode)}
              </strong>
              <span className="mt-1">
                <DeltaChip value={data.issuedValueDelta} />
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default MaterialIssueInsights
