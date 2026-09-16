import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  ChevronRight,
  ListTree,
  Minus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../../ui/Card'
import { IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { Skeleton } from '../../ui/Skeleton'
import { cx } from '../../ui/cx'
import { formatDate, formatMoney, toNumber } from '../../utils/format'
import type { ReconciliationBreakdown, ReconciliationRun } from '../../services/reconciliationApi'
import {
  booksAnswered,
  bucketRows,
  changePercent,
  differencePercent,
  differenceTone,
  formatPercent,
  formatSignedPercent,
} from './reconciliationModel'

/** `₹ 24,56,319.50`. The symbol is spaced so the figure stays legible at 22px. */
function rupees(value: unknown, empty = '—'): string {
  const n = toNumber(value)
  return n === null ? empty : `₹ ${formatMoney(n)}`
}

const ACCENT: Record<IconTone, string> = {
  primary: 'bg-primary',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-400',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
}

interface KpiCardProps {
  icon: LucideIcon
  tone: IconTone
  title: string
  subtitle?: ReactNode
  value: ReactNode
  valueClassName?: string
  meta?: ReactNode
  /** Turns the card into a drill-down. */
  to?: string
  toLabel?: string
}

/**
 * One headline figure.
 *
 * White surface, one tinted rule down the edge and one tinted glyph — the tint
 * is how the four cards are told apart at a glance, never the only way a figure
 * is read: every card states its owner in words as well ("As per Inventory",
 * "As per Books").
 */
function KpiCard({ icon, tone, title, subtitle, value, valueClassName, meta, to, toLabel }: KpiCardProps) {
  const body = (
    <>
      <span className={cx('absolute inset-y-0 left-0 w-1', ACCENT[tone])} aria-hidden />
      <div className="flex items-start gap-3">
        <IconTile icon={icon} tone={tone} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gray-700">{title}</p>
          {subtitle ? <p className="mt-px text-[11px] text-gray-500">{subtitle}</p> : null}
          {/* A div, not a p: the value can be a skeleton block while the
              breakdown loads, and a <div> inside a <p> is invalid HTML. */}
          <div className={cx('mt-1.5 truncate text-xl font-bold tabular-nums tracking-tight', valueClassName ?? 'text-gray-900')}>
            {value}
          </div>
          <div className="mt-1 min-h-[16px] text-[11px] text-gray-500">{meta}</div>
        </div>
        {to ? <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" aria-hidden /> : null}
      </div>
    </>
  )

  if (to) {
    return (
      <Card
        as={Link}
        to={to}
        aria-label={toLabel ?? `Open ${title}`}
        interactive
        padding="md"
        className="relative overflow-hidden pl-4"
      >
        {body}
      </Card>
    )
  }
  return (
    <Card as="article" padding="md" className="relative overflow-hidden pl-4">
      {body}
    </Card>
  )
}

function KpiSkeleton() {
  return (
    <Card aria-hidden padding="md" className="relative overflow-hidden pl-4">
      <span className="absolute inset-y-0 left-0 w-1 bg-gray-100" />
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10" rounded="xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-24" rounded="md" />
          <Skeleton className="h-2.5 w-16" rounded="md" />
          <Skeleton className="h-5 w-32" rounded="md" />
          <Skeleton className="h-2.5 w-20" rounded="md" />
        </div>
      </div>
    </Card>
  )
}

/** `+2.4% vs previous run`, with the arrow that matches the sign. */
function ChangeChip({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span className="text-gray-400">{label}</span>
  const flat = Math.abs(pct) < 0.05
  const Icon = flat ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight
  const tone = flat ? 'text-gray-400' : pct > 0 ? 'text-emerald-600' : 'text-red-600'
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cx('inline-flex items-center gap-0.5 font-semibold', tone)}>
        <Icon className="h-3 w-3" aria-hidden />
        {flat ? '0.0%' : formatSignedPercent(pct)}
      </span>
      <span className="truncate text-gray-400">{label}</span>
    </span>
  )
}

export interface ReconciliationSummaryProps {
  /** The run the figures speak for — the latest COMPLETED one where there is one. */
  run: ReconciliationRun | null
  previous: ReconciliationRun | null
  loading: boolean
  /** The latest run's bucket breakdown; null while it loads or when absent. */
  breakdown: ReconciliationBreakdown | null
  breakdownLoading: boolean
  /** Re-asks Books through the same run endpoint. */
  onRetry?: () => void
  varianceTo: string
}

const GRID = 'grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'

/**
 * The four headline figures: what Inventory holds, what Books booked, the gap
 * between them, and what explains it.
 *
 * Two rules it will not break. A figure Books never sent is never drawn as ₹0 —
 * ₹0 is a real balance and "we could not reach Books" is not a balance at all.
 * And the fourth card counts the buckets the SERVER returned: Books publishes a
 * single Stock-in-Hand balance, not a per-item one, so there is no honest
 * "items with variance" to count and this app will not manufacture one.
 */
export function ReconciliationSummary({
  run,
  previous,
  loading,
  breakdown,
  breakdownLoading,
  onRetry,
  varianceTo,
}: ReconciliationSummaryProps) {
  if (loading && !run) {
    return (
      <div className={GRID}>
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </div>
    )
  }

  const answered = booksAnswered(run)
  const asAt = run ? formatDate(run.as_of_date) : null
  const diff = run && answered ? toNumber(run.difference) : null
  const diffTone = differenceTone(diff)
  const diffPct = differencePercent(run)
  const rows = bucketRows(breakdown)
  const unexplained = toNumber(breakdown?.buckets?.unexplained?.amount)
  const totalBuckets = breakdown?.buckets ? Object.keys(breakdown.buckets).length : null

  const diffValueClass =
    diff === null
      ? 'text-gray-400'
      : diffTone === 'good'
        ? 'text-emerald-600'
        : diffTone === 'warning'
          ? 'text-amber-600'
          : 'text-red-600'

  return (
    <div className={GRID}>
      <KpiCard
        icon={Boxes}
        tone="primary"
        title="Inventory Value"
        subtitle="As per Inventory"
        value={run ? rupees(run.inventory_closing_value) : '—'}
        meta={
          run ? (
            <ChangeChip
              pct={changePercent(run.inventory_closing_value, previous?.inventory_closing_value)}
              label={previous ? 'vs previous run' : 'no earlier run to compare'}
            />
          ) : (
            'No run yet'
          )
        }
      />

      <KpiCard
        icon={BookOpen}
        tone="info"
        title="Books Stock Ledger"
        subtitle="As per Books"
        value={
          answered ? (
            rupees(run?.books_stock_ledger_balance)
          ) : (
            <span className="text-base font-semibold text-amber-600">Books data temporarily unavailable</span>
          )
        }
        meta={
          answered ? (
            <ChangeChip
              pct={changePercent(run?.books_stock_ledger_balance, previous?.books_stock_ledger_balance)}
              label={previous ? 'vs previous run' : 'no earlier run to compare'}
            />
          ) : onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline print:hidden"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Retry
            </button>
          ) : (
            'Not reported by Books'
          )
        }
      />

      <KpiCard
        icon={TriangleAlert}
        tone={diff === null ? 'slate' : diffTone === 'good' ? 'success' : diffTone === 'warning' ? 'warning' : 'danger'}
        title="Difference"
        subtitle="Inventory − Books"
        value={diff === null ? '—' : rupees(diff)}
        valueClassName={diffValueClass}
        meta={
          diff === null
            ? 'Both sides must answer before a difference exists'
            : diffTone === 'good'
              ? 'Reconciled — the two sides agree'
              : `${formatPercent(diffPct)} of inventory value${diff > 0 ? ' · Inventory carries more' : ' · Books carries more'}`
        }
      />

      <KpiCard
        icon={ListTree}
        tone="violet"
        title="Variance drivers"
        subtitle="Buckets explaining the gap"
        value={
          breakdownLoading ? (
            <Skeleton className="h-5 w-16" rounded="md" />
          ) : breakdown ? (
            String(rows.length)
          ) : (
            '—'
          )
        }
        meta={
          breakdownLoading
            ? 'Loading the latest breakdown…'
            : breakdown
              ? `out of ${totalBuckets} buckets${unexplained !== null && Math.abs(unexplained) >= 0.005 ? ` · unexplained ₹ ${formatMoney(unexplained)}` : ' · nothing unexplained'}`
              : asAt
                ? 'Breakdown unavailable for this run'
                : 'Run a reconciliation to see what explains the gap'
        }
        to={breakdown ? varianceTo : undefined}
        toLabel="Open item-wise variance"
      />
    </div>
  )
}

export default ReconciliationSummary
