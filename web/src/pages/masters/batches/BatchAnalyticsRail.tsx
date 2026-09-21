import { Link } from 'react-router-dom'
import { Download, PencilLine, Printer, RefreshCw, ScanLine } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Skeleton } from '../../../ui/Skeleton'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import type { BatchSummary } from '../../../services/masters'
import { formatInt } from '../../../utils/format'
import { BATCH_STATE_LABEL } from './batchExpiry'
import type { BatchState } from './batchExpiry'
import { donutSegments, sharePercent } from './donutGeometry'

/**
 * The analytics rail beside the table: what the filtered set is made of, when
 * it expires, and the four things a stock controller does next.
 *
 * All of it reads the same server summary the KPI cards do, so the ring, the
 * timeline and the figures above the table can never disagree. Below `wide`
 * (1400px) the page drops the rail underneath the table rather than squeezing
 * the rows — a batch table narrowed to make room for a chart is a worse screen
 * than a chart the reader has to scroll to.
 */

const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** One colour per state, as a text colour so dark mode and print both follow. */
const STATE_STROKE: Record<BatchState, string> = {
  active: 'text-primary',
  expiring_soon: 'text-amber-500',
  expired: 'text-red-500',
  inactive: 'text-slate-400',
}

const STATE_DOT: Record<BatchState, string> = {
  active: 'bg-primary',
  expiring_soon: 'bg-amber-500',
  expired: 'bg-red-500',
  inactive: 'bg-slate-400',
}

const STATE_ORDER: BatchState[] = ['active', 'expiring_soon', 'expired', 'inactive']

/** The timeline's bands, reddest first — the order a risk is read in. */
const TIMELINE: { key: keyof BatchSummary['expiry_buckets']; label: string; bar: string }[] = [
  { key: 'expired', label: 'Already expired', bar: 'bg-red-600' },
  { key: 'within_30', label: 'Within 30 days', bar: 'bg-red-500' },
  { key: 'days_31_90', label: '31 – 90 days', bar: 'bg-orange-500' },
  { key: 'days_91_180', label: '91 – 180 days', bar: 'bg-amber-500' },
  { key: 'beyond_180', label: 'Over 180 days', bar: 'bg-primary' },
  { key: 'no_expiry', label: 'No expiry date', bar: 'bg-slate-300' },
]

export interface QuickAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect?: () => void
  /** Why the action cannot be taken. Present = disabled, and the reason is shown. */
  unavailable?: string
}

export interface BatchAnalyticsRailProps {
  summary: BatchSummary | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  quickActions: readonly QuickAction[]
  /** Where a ring segment or a legend row drills to. */
  stateHref: (state: BatchState) => string
  className?: string
}

function CardTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-[13px] font-semibold text-gray-900">{children}</h2>
      {aside}
    </div>
  )
}

function BatchInsights({ summary, stateHref }: { summary: BatchSummary; stateHref: (state: BatchState) => string }) {
  const parts = STATE_ORDER.map((state) => ({ key: state, value: summary.states[state] }))
  const segments = donutSegments(parts, CIRCUMFERENCE)
  const total = summary.total

  return (
    <Card padding="md">
      <CardTitle>Batch insights</CardTitle>

      <div className="relative mx-auto h-[8.5rem] w-[8.5rem]">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={`${formatInt(total)} batches by state`}>
          <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="14" className="text-gray-100" stroke="currentColor" />
          {segments.map((segment) =>
            segment.length > 0 ? (
              <circle
                key={segment.key}
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                strokeWidth="14"
                strokeLinecap="butt"
                stroke="currentColor"
                className={STATE_STROKE[segment.key as BatchState]}
                strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
                strokeDashoffset={segment.offset}
              >
                <title>{`${BATCH_STATE_LABEL[segment.key as BatchState]}: ${formatInt(segment.value)}`}</title>
              </circle>
            ) : null,
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-gray-900">{formatInt(total)}</span>
          <span className="text-[10px] text-gray-500">{total === 1 ? 'Batch' : 'Batches'}</span>
        </div>
      </div>

      <ul className="mt-4 space-y-1">
        {segments.map((segment) => {
          const state = segment.key as BatchState
          return (
            <li key={state}>
              <Link
                to={stateHref(state)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-gray-500 no-underline transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className={cx('h-2 w-2 shrink-0 rounded-full', STATE_DOT[state])} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{BATCH_STATE_LABEL[state]}</span>
                <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                  {formatInt(segment.value)}
                  <span className="ml-1 font-normal text-gray-400">({sharePercent(segment.value, total)}%)</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function ExpiryTimeline({ summary }: { summary: BatchSummary }) {
  const buckets = summary.expiry_buckets
  // Scaled against the biggest band, not the total: four bars at 2%, 5%, 9% and
  // 84% of a total tell the reader nothing about the three that matter.
  const peak = Math.max(1, ...TIMELINE.map((band) => buckets[band.key]))

  return (
    <Card padding="md">
      <CardTitle
        aside={<span className="text-[10px] text-gray-400">by expiry date</span>}
      >
        Expiry timeline
      </CardTitle>
      <ul className="space-y-2.5">
        {TIMELINE.map((band) => {
          const value = buckets[band.key]
          return (
            <li key={band.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-500">{band.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-gray-900">{formatInt(value)}</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                role="progressbar"
                aria-label={`${band.label}: ${formatInt(value)} batches`}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={peak}
              >
                <div
                  className={cx('h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none', band.bar)}
                  // A non-zero band never renders as nothing: five expired lots
                  // against a peak of 157 is 3% of the track, and a band the
                  // reader cannot see is a risk the reader does not act on.
                  style={{ width: value === 0 ? 0 : `${Math.max(5, Math.round((value / peak) * 100))}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  if (actions.length === 0) return null
  return (
    <Card padding="md">
      <CardTitle>Quick actions</CardTitle>
      <ul className="space-y-0.5">
        {actions.map((action) => {
          const button = (
            <button
              type="button"
              disabled={Boolean(action.unavailable)}
              onClick={action.onSelect}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                action.unavailable
                  ? 'cursor-not-allowed text-gray-400'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <span
                className={cx(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                  action.unavailable ? 'bg-gray-100 text-gray-400' : 'bg-primary-light text-primary',
                )}
                aria-hidden
              >
                <action.icon className="h-3.5 w-3.5" />
              </span>
              {action.label}
            </button>
          )
          return (
            <li key={action.key}>
              {action.unavailable ? (
                <Tooltip label={action.unavailable} className="w-full">
                  {/* A disabled button fires no pointer events, so the reason
                      has to be anchored to a wrapper or it never appears. */}
                  <span className="w-full">{button}</span>
                </Tooltip>
              ) : (
                button
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function BatchAnalyticsRail({
  summary,
  loading,
  error,
  onRetry,
  quickActions,
  stateHref,
  className,
}: BatchAnalyticsRailProps) {
  return (
    <aside
      className={cx('flex flex-col gap-2 print:hidden lg:grid lg:grid-cols-3 wide:flex wide:flex-col', className)}
      aria-label="Batch analytics"
      aria-busy={loading || undefined}
    >
      {error && !summary ? (
        <Notice
          kind="warning"
          title="Insights unavailable."
          actions={
            <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
              Retry
            </Button>
          }
        >
          The batch list is unaffected.
        </Notice>
      ) : null}

      {summary ? (
        <>
          <BatchInsights summary={summary} stateHref={stateHref} />
          <ExpiryTimeline summary={summary} />
        </>
      ) : error ? null : (
        <>
          <Skeleton className="h-[19rem]" rounded="xl" />
          <Skeleton className="h-[13rem]" rounded="xl" />
        </>
      )}

      <QuickActions actions={quickActions} />
    </aside>
  )
}

export const QUICK_ACTION_ICONS = { ScanLine, PencilLine, Printer, Download }

export default BatchAnalyticsRail
