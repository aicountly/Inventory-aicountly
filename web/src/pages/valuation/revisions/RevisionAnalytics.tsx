import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { BarChart3, ClipboardCheck, PieChart } from 'lucide-react'
import { ColumnChart } from '../../../dashboard/charts/ColumnChart'
import { DonutChart } from '../../../dashboard/charts/DonutChart'
import type { SeriesItem } from '../../../dashboard/model'
import { BAR_FILL, CHART_RAMP_PRIMARY } from '../../../dashboard/visuals'
import { Card } from '../../../ui/Card'
import { Select } from '../../../ui/Select'
import { Skeleton } from '../../../ui/Skeleton'
import { cx } from '../../../ui/cx'
import { formatCompactMoney, formatDate, formatInt, formatMoney } from '../../../utils/format'
import type { RevisionSummary } from '../../../services/valuationApi'
import { TIMELINE_PERIODS, ackProgress, sourceSlices, timelineColumns } from './revisionsModel'

export interface RevisionAnalyticsProps {
  summary: RevisionSummary | null
  loading: boolean
  days: string
  onDays: (days: string) => void
  currency: string
  documentTypeLabel: (code: string | null) => string
  /** Builds the link a donut slice drills into, keeping the reader's other filters. */
  sourceLink: (documentType: string) => string
}

function AnalyticsCard({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string
  icon: typeof PieChart
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card padding="sm" className={cx('flex min-w-0 flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <span className="truncate">{title}</span>
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  )
}

function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-full min-h-[150px] items-center justify-center px-4 text-center text-xs text-gray-500">
      {children}
    </p>
  )
}

/** Acknowledgement, as a ring. One number, read from across a desk. */
function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return (
    <div className="relative h-[124px] w-[124px] shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="12" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="rgb(var(--color-primary))"
          strokeWidth="12"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="butt"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold tabular-nums text-gray-900">{percent}%</span>
        <span className="text-[10px] uppercase tracking-wider text-gray-400">applied</span>
      </div>
    </div>
  )
}

/**
 * The three questions the table cannot answer row by row: when the revisions arrived, what
 * kind of document caused them, and how far behind the acknowledgements are.
 *
 * Every figure comes from the summary endpoint, under the same filters as the table — except
 * the acknowledgement ring, which is company-wide on purpose and says so: a backlog does not
 * shrink because somebody narrowed a date range.
 */
export function RevisionAnalytics({
  summary,
  loading,
  days,
  onDays,
  currency,
  documentTypeLabel,
  sourceLink,
}: RevisionAnalyticsProps) {
  const timeline = useMemo(() => timelineColumns(summary), [summary])
  const slices = useMemo(() => sourceSlices(summary, documentTypeLabel), [summary, documentTypeLabel])
  const progress = ackProgress(summary)

  const donutItems = useMemo<SeriesItem[]>(() => {
    const max = slices.reduce((m, s) => Math.max(m, s.value), 0)
    return slices.map((s) => ({
      key: s.key,
      label: s.label,
      value: s.value,
      display: formatCompactMoney(s.value, currency),
      share: s.share,
      scale: max > 0 ? (s.value / max) * 100 : 0,
      tone: 'primary' as const,
      to: sourceLink(s.key),
      sub: `${formatInt(s.revisions)} revisions · net ${formatMoney(s.netDelta)}`,
    }))
  }, [slices, currency, sourceLink])

  const skeleton = loading && !summary

  return (
    <section
      aria-label="Valuation revision analytics"
      className="grid grid-cols-1 gap-2 print:hidden lg:grid-cols-2 xl:grid-cols-[1.35fr_1fr_1.1fr]"
    >
      <AnalyticsCard
        title="Revision timeline"
        icon={BarChart3}
        className="lg:col-span-2 xl:col-span-1"
        action={
          // With a date filter set, the filter owns the window — a period selector that
          // silently did nothing would be worse than no selector at all.
          summary?.window.explicit_range ? (
            <span className="whitespace-nowrap text-[11px] text-gray-500">
              {formatDate(summary.window.from)} – {formatDate(summary.window.to)}
            </span>
          ) : (
            <Select size="sm" value={days} onChange={(e) => onDays(e.target.value)} aria-label="Timeline period">
              {TIMELINE_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          )
        }
      >
        {skeleton ? (
          <Skeleton height="150px" />
        ) : timeline.empty ? (
          <CardEmpty>No revisions were created in this period.</CardEmpty>
        ) : (
          <ColumnChart
            categories={timeline.categories}
            series={[
              { key: 'increased', label: 'Cost increased', fill: BAR_FILL.critical, values: timeline.increased },
              { key: 'decreased', label: 'Cost decreased', fill: BAR_FILL.success, values: timeline.decreased },
            ]}
            caption="Revisions created per day, split by whether the valuation went up or down."
            unit="revisions"
            height={150}
            truncatedNote={timeline.truncated ? 'First 90 days of the selected range.' : undefined}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard title="Impact by source" icon={PieChart}>
        {skeleton ? (
          <Skeleton height="150px" />
        ) : donutItems.length === 0 ? (
          <CardEmpty>No valuation movement to split.</CardEmpty>
        ) : (
          <>
            <DonutChart
              items={donutItems}
              centerValue={formatCompactMoney(summary?.filtered.net_delta ?? 0, currency)}
              centerLabel="Net impact"
              ariaLabel="Valuation movement by source document type"
              palette={CHART_RAMP_PRIMARY}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              Slices are gross movement, so a rise and an equal fall both count as work. The middle is the net
              effect on stock value.
            </p>
          </>
        )}
      </AnalyticsCard>

      <AnalyticsCard title="Acknowledgement progress" icon={ClipboardCheck}>
        {skeleton || !progress ? (
          <Skeleton height="150px" />
        ) : (
          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <ProgressRing
              percent={progress.percent}
              label={`${progress.acknowledged} of ${progress.total} revisions acknowledged`}
            />
            <div className="min-w-0">
              <p className="text-xs text-gray-600">
                <strong className="tabular-nums text-gray-900">{formatInt(progress.acknowledged)}</strong> of{' '}
                <strong className="tabular-nums text-gray-900">{formatInt(progress.total)}</strong> revisions
                acknowledged
              </p>
              <ul className="mt-2 space-y-1 text-[11px]">
                <li className="flex items-center gap-1.5 text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                  {formatInt(progress.acknowledged)} applied in Books
                </li>
                <li className="flex items-center gap-1.5 text-gray-600">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: 'rgb(var(--color-surface-3))' }}
                    aria-hidden
                  />
                  {formatInt(progress.pending)} awaiting Books
                </li>
              </ul>
              <div
                className={cx(
                  'mt-2.5 rounded-lg border px-2.5 py-2',
                  progress.state === 'attention'
                    ? 'border-red-200 bg-red-50'
                    : progress.state === 'clear'
                      ? 'border-primary/20 bg-primary-light'
                      : 'border-emerald-200 bg-emerald-50',
                )}
              >
                <p
                  className={cx(
                    'text-[11px] font-semibold',
                    progress.state === 'attention'
                      ? 'text-red-700'
                      : progress.state === 'clear'
                        ? 'text-primary'
                        : 'text-emerald-700',
                  )}
                >
                  {progress.title}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{progress.detail}</p>
              </div>
              <p className="mt-2 text-[10px] text-gray-400">
                Company-wide in the selected branch — filters do not narrow it.
              </p>
            </div>
          </div>
        )}
      </AnalyticsCard>
    </section>
  )
}

export default RevisionAnalytics
