import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Boxes, ScanBarcode, TriangleAlert, Warehouse } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatInt } from '../../utils/format'
import type { CountSummary } from './countModel'

/**
 * The figures across the top of the count.
 *
 * Every one of them is derived from the sheet on screen by `summarise()` — the
 * same function the posting dialog and the readiness gate read — so the header
 * cannot say 7 shortages while the dialog says 6. A figure that is not knowable
 * prints an em dash: with no cost permission there is no variance value, and
 * showing 0.00 would read as "nothing is wrong" rather than "not shown to you".
 */

interface MetricProps {
  icon: LucideIcon
  tone: IconTone
  value: ReactNode
  label: string
  /** Rows exist for this figure — clicking filters the sheet to them. */
  onClick?: () => void
  title?: string
}

function Metric({ icon, tone, value, label, onClick, title }: MetricProps) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} size="md" />
      <span className="min-w-0">
        <strong className="block truncate text-base font-semibold leading-tight tabular-nums text-gray-900">
          {value}
        </strong>
        <span className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-wide text-gray-500">
          {label}
        </span>
      </span>
    </>
  )
  const shared = 'flex min-w-0 items-center gap-2.5 px-3.5 py-3 text-left border-b border-r border-gray-100'
  if (!onClick) {
    return (
      <div className={shared} title={title}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `Show ${label.toLowerCase()}`}
      className={cx(shared, 'transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30')}
    >
      {body}
    </button>
  )
}

const RADIUS = 34
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function CountProgress({ summary }: { summary: CountSummary }) {
  const pct = Math.max(0, Math.min(100, summary.progressPct))
  const dash = (pct / 100) * CIRCUMFERENCE
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-3.5 py-3">
      <div className="relative h-[62px] w-[62px] shrink-0">
        <svg
          viewBox="0 0 80 80"
          className="h-full w-full -rotate-90"
          role="img"
          aria-label={`Count progress ${pct}%: ${summary.countedLines} of ${summary.itemsLoaded} lines counted`}
        >
          <circle cx="40" cy="40" r={RADIUS} fill="none" strokeWidth={9} stroke="rgb(var(--color-surface-3))" />
          {summary.itemsLoaded > 0 ? (
            <circle
              cx="40"
              cy="40"
              r={RADIUS}
              fill="none"
              strokeWidth={9}
              strokeLinecap="round"
              stroke="rgb(var(--color-primary))"
              className="transition-[stroke-dasharray] duration-500"
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            />
          ) : null}
        </svg>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums text-gray-900">
          {summary.itemsLoaded === 0 ? '—' : `${pct}%`}
        </span>
      </div>
      <dl className="min-w-0 text-[10px] leading-snug text-gray-500">
        <dt className="mb-1 text-[11px] font-semibold text-gray-900">Count progress</dt>
        <dd className="tabular-nums">
          <strong className="font-semibold text-gray-700">{formatInt(summary.countedLines)}</strong> counted
        </dd>
        <dd className="tabular-nums">
          <strong className="font-semibold text-gray-700">{formatInt(summary.pendingLines)}</strong> pending
        </dd>
        <dd className="tabular-nums">
          <strong className="font-semibold text-gray-700">{formatInt(summary.itemsLoaded)}</strong> total
        </dd>
      </dl>
    </div>
  )
}

export interface PhysicalCountSummaryProps {
  summary: CountSummary
  /** Formats a monetary figure in the company's own currency. */
  money: (value: number) => string
  /** False when the reader may not see cost — the variance card says so. */
  showCost: boolean
  loading?: boolean
  onFilter?: (preset: 'shortage' | 'excess' | 'serial' | 'all') => void
}

export function PhysicalCountSummary({ summary, money, showCost, loading = false, onFilter }: PhysicalCountSummaryProps) {
  if (loading) {
    return (
      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_15rem]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="border-b border-r border-gray-100 px-3.5 py-3">
              <Skeleton className="h-[42px] w-full" />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_15rem] [&>*:last-child]:border-r-0">
        <Metric
          icon={Warehouse}
          tone="info"
          value={formatInt(summary.warehousesSelected)}
          label="Warehouses selected"
          title="Distinct warehouses on the count sheet"
        />
        <Metric icon={Boxes} tone="primary" value={formatInt(summary.itemsLoaded)} label="Items loaded" />
        <Metric
          icon={TriangleAlert}
          tone={summary.varianceValue !== null && summary.varianceValue < 0 ? 'danger' : 'warning'}
          value={showCost ? (summary.varianceValue === null ? '—' : money(summary.varianceValue)) : '—'}
          label="Variance value"
          title={showCost ? 'Σ difference × unit cost' : 'You do not have permission to see inventory cost'}
        />
        <Metric
          icon={ArrowDownRight}
          tone="danger"
          value={formatInt(summary.shortageItems)}
          label="Shortage items"
          onClick={summary.shortageItems > 0 && onFilter ? () => onFilter('shortage') : undefined}
        />
        <Metric
          icon={ArrowUpRight}
          tone="success"
          value={formatInt(summary.excessItems)}
          label="Excess items"
          onClick={summary.excessItems > 0 && onFilter ? () => onFilter('excess') : undefined}
        />
        <Metric
          icon={ScanBarcode}
          tone={summary.pendingSerialChecks > 0 ? 'warning' : 'slate'}
          value={formatInt(summary.pendingSerialChecks)}
          label="Pending serial checks"
          onClick={summary.pendingSerialChecks > 0 && onFilter ? () => onFilter('serial') : undefined}
        />
        <CountProgress summary={summary} />
      </div>
    </Card>
  )
}

export default PhysicalCountSummary
