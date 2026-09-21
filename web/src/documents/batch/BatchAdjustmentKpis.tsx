import { ArrowDownToLine, ArrowUpFromLine, FileText, ShieldAlert, ShieldCheck, TriangleAlert, Warehouse } from 'lucide-react'
import { StatCard } from '../../ui/StatCard'
import { AIC, cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'
import type { BatchAdjustmentMetrics } from './batchAdjustmentModel'

const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const

/**
 * Six across from 1280px up, three below.
 *
 * Not the shared REGISTER_KPI_GRID: its `auto-fit` packs six cards into 1280px at about 200px
 * each, which is narrower than the labels, and a strip of six truncated captions reports nothing.
 */
const KPI_GRID = 'grid shrink-0 gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 print:hidden'

export interface BatchAdjustmentKpisProps {
  metrics: BatchAdjustmentMetrics
  warehouseName: string
  className?: string
}

/**
 * The six figures that say whether this document is safe to post, every one read off the draft on
 * screen. Nothing here is fetched and nothing is a placeholder: an empty document reads zero.
 */
export function BatchAdjustmentKpis({ metrics, warehouseName, className }: BatchAdjustmentKpisProps) {
  const risk = metrics.varianceRisk
  const riskCaption =
    risk === 'high'
      ? metrics.variance !== 0
        ? `Quantity variance ${metrics.variance > 0 ? '+' : ''}${formatQty(metrics.variance)}`
        : 'Blocking errors to clear'
      : risk === 'medium'
        ? 'Warnings to review'
        : 'No quantity variance'

  return (
    <div className={cx(AIC, KPI_GRID, className)}>
      <StatCard
        layout="metric"
        icon={FileText}
        tone="primary"
        label="Draft lines"
        value={metrics.totalLines === 0 ? '0' : String(metrics.readyLines)}
        hint={`of ${metrics.totalLines} line${metrics.totalLines === 1 ? '' : 's'}`}
      />
      <StatCard layout="metric" icon={ArrowDownToLine} tone="danger" label="Total qty out" value={formatQty(metrics.totalQtyOut, '0')} hint="units" />
      <StatCard layout="metric" icon={ArrowUpFromLine} tone="success" label="Total qty in" value={formatQty(metrics.totalQtyIn, '0')} hint="units" />
      {/* A name, not a figure: at the numeric size it truncates to "Main Wareho…" on every
          screen narrower than 1600px. */}
      <StatCard
        layout="metric"
        icon={Warehouse}
        tone="info"
        label="Warehouse"
        value={<span className="text-base leading-6">{warehouseName || 'Not set'}</span>}
        hint="Default for new lines"
      />
      <StatCard
        layout="metric"
        icon={risk === 'low' ? ShieldCheck : ShieldAlert}
        tone={risk === 'low' ? 'success' : risk === 'medium' ? 'warning' : 'danger'}
        label="Variance risk"
        value={RISK_LABEL[risk]}
        hint={riskCaption}
      />
      <StatCard
        layout="metric"
        icon={TriangleAlert}
        tone={metrics.exceptionCount > 0 ? 'warning' : 'success'}
        label="Exceptions"
        value={String(metrics.exceptionCount)}
        hint={metrics.exceptionCount > 0 ? 'Needs attention' : 'Nothing flagged'}
      />
    </div>
  )
}

export default BatchAdjustmentKpis
