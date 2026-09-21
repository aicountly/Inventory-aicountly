import { Link } from 'react-router-dom'
import {
  Download,
  PencilLine,
  Printer,
  RefreshCw,
  ScanLine,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Skeleton } from '../../../ui/Skeleton'
import { Tooltip } from '../../../ui/Tooltip'
import { AIC, cx } from '../../../ui/cx'
import type { BatchHealth, BatchSummary } from '../../../services/batchesApi'
import { formatInt } from '../../../utils/format'
import { expiryTimelineRows, healthSegments } from './batchPresentation'

/**
 * The rail beside the table: what the filtered set looks like, when it goes
 * off, and the four things a reader does next.
 *
 * Everything here is drawn from the SAME server summary the KPI strip reads, so
 * the ring and the cards can never disagree with the figures above the table.
 * Nothing is computed from the page of rows on screen.
 *
 * On a narrow viewport the page drops the rail below the table (the grid does
 * that, not this file) — a 272px column beside an ERP table stops paying for
 * itself well before the table stops being readable.
 */

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface BatchAnalyticsRailProps {
  summary: BatchSummary | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  /** Scope sentence — the ring is a claim about a company, FY and branch. */
  scopeLabel: string
  healthLink: (health: BatchHealth | '') => string
  activeHealth: string
  onScan: () => void
  onBulkUpdate: () => void
  onPrintLabels: () => void
  onExport: () => void
  selectedCount: number
  rowCount: number
  canWrite: boolean
  canPrint: boolean
}

function CardTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-start justify-between gap-2">
      <h2 className="text-[13px] font-semibold tracking-tight text-gray-900">{children}</h2>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

function InsightsCard({
  summary,
  scopeLabel,
  healthLink,
  activeHealth,
}: Pick<BatchAnalyticsRailProps, 'summary' | 'scopeLabel' | 'healthLink' | 'activeHealth'>) {
  const segments = healthSegments(summary)
  const total = summary?.total ?? 0
  const drawn = segments.filter((s) => s.percent > 0)

  return (
    <Card padding="sm">
      <CardTitle
        aside={
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
            {summary ? `${formatInt(total)} in scope` : '—'}
          </span>
        }
      >
        Batch insights
      </CardTitle>
      <p className="-mt-1 mb-2 truncate text-[10px] text-gray-400" title={scopeLabel}>
        {scopeLabel}
      </p>

      <div className="relative mx-auto h-[128px] w-[128px]">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full -rotate-90"
          role="img"
          aria-label={
            total > 0
              ? segments.map((s) => `${s.label} ${formatInt(s.value)}`).join(', ')
              : 'No batches match these filters'
          }
        >
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth="11"
            /* The token, not a grey utility: `text-gray-100` stays near-white in
               dark mode, where this track has to recede. */
            stroke="rgb(var(--color-surface-3))"
          />
          {drawn.map((s) => {
            const dash = (s.percent / 100) * CIRCUMFERENCE
            return (
              <circle
                key={s.key}
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                strokeWidth="11"
                strokeLinecap="butt"
                stroke="currentColor"
                className={cx(s.arcClass, 'transition-[stroke-dasharray] duration-500 motion-reduce:transition-none')}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-((s.offset / 100) * CIRCUMFERENCE)}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <strong className="text-[22px] font-bold leading-none tabular-nums text-gray-900">
            {formatInt(total)}
          </strong>
          <span className="mt-1 text-[10px] text-gray-500">
            {total === 1 ? 'Batch' : 'Batches'}
          </span>
        </div>
      </div>

      <ul className="mt-3 space-y-0.5" role="list">
        {segments.map((s) => {
          const selected = activeHealth === s.key
          return (
            <li key={s.key}>
              <Link
                to={healthLink(selected ? '' : s.key)}
                aria-current={selected ? 'true' : undefined}
                className={cx(
                  'grid grid-cols-[0.5rem_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[11px] no-underline transition-colors',
                  selected ? 'bg-primary-light text-primary' : 'text-gray-500 hover:bg-gray-50',
                )}
              >
                <span className={cx('h-2 w-2 rounded-full', s.dotClass)} aria-hidden />
                <span className="truncate">{s.label}</span>
                <strong className="tabular-nums font-semibold text-gray-900">
                  {formatInt(s.value)}
                  <span className="ml-1 font-normal text-gray-400">
                    ({total > 0 ? Math.round(s.percent) : 0}%)
                  </span>
                </strong>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function ExpiryTimelineCard({ summary }: { summary: BatchSummary | null }) {
  const rows = expiryTimelineRows(summary?.expiry_buckets ?? null)
  const dated = rows.reduce((acc, r) => (r.key === 'no_expiry' ? acc : acc + r.count), 0)

  return (
    <Card padding="sm">
      <CardTitle>Expiry timeline</CardTitle>
      {rows.length === 0 || dated === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          No batch in this selection carries an expiry date.
        </p>
      ) : (
        <>
          <ul className="space-y-2.5" role="list">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate text-gray-500">{r.label}</span>
                  <strong className="tabular-nums font-semibold text-gray-900">
                    {formatInt(r.count)}
                  </strong>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <span
                    className={cx(
                      'block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
                      r.barClass,
                    )}
                    style={{ width: `${r.scale}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {/* Said out loud because the bars are scaled against the biggest
              bucket, not against the total: without this the eye reads the
              longest bar as "most of the stock". */}
          <p className="mt-2.5 text-[10px] leading-snug text-gray-400">
            Bars compare each band with the largest one. Counts are exact.
          </p>
        </>
      )}
    </Card>
  )
}

interface QuickAction {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  /** Why it is off. Shown on hover and read out — never a dead control. */
  reason?: string
}

function QuickActionsCard({
  onScan,
  onBulkUpdate,
  onPrintLabels,
  onExport,
  selectedCount,
  rowCount,
  canWrite,
  canPrint,
}: Pick<
  BatchAnalyticsRailProps,
  'onScan' | 'onBulkUpdate' | 'onPrintLabels' | 'onExport' | 'selectedCount' | 'rowCount' | 'canWrite' | 'canPrint'
>) {
  const nothingSelected = selectedCount === 0
  const actions: QuickAction[] = [
    {
      key: 'scan',
      label: 'Scan batch',
      icon: ScanLine,
      onSelect: onScan,
    },
    {
      key: 'bulk',
      // Named for what it does, not for a category. The bulk bar above the
      // table offers every status; this is the one a reader reaches for.
      label: selectedCount > 0 ? `Close ${formatInt(selectedCount)} selected` : 'Close selected batches',
      icon: PencilLine,
      onSelect: onBulkUpdate,
      disabled: !canWrite || nothingSelected,
      reason: !canWrite
        ? 'You do not have permission to change batches in this company.'
        : nothingSelected
          ? 'Tick one or more batches in the table first.'
          : undefined,
    },
    {
      key: 'labels',
      label: selectedCount > 0 ? `Print labels (${formatInt(selectedCount)})` : 'Print labels',
      icon: Printer,
      onSelect: onPrintLabels,
      disabled: !canPrint || rowCount === 0,
      reason: rowCount === 0 ? 'There are no batches on this page to label.' : undefined,
    },
    {
      key: 'export',
      label: 'Export batches',
      icon: Download,
      onSelect: onExport,
      disabled: rowCount === 0,
      reason: rowCount === 0 ? 'There is nothing matching these filters to export.' : undefined,
    },
  ]

  return (
    <Card padding="sm">
      <CardTitle>Quick actions</CardTitle>
      <ul className="space-y-0.5" role="list">
        {actions.map((a) => {
          const button = (
            <button
              type="button"
              onClick={a.disabled ? undefined : a.onSelect}
              aria-disabled={a.disabled || undefined}
              className={cx(
                AIC,
                'flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-[12px] font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                // `opacity` rather than a grey: the dark-mode layer remaps the
                // grey text utilities, so a greyed label reads as enabled there.
                a.disabled
                  ? 'cursor-not-allowed text-gray-500 opacity-60'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <span
                className={cx(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-lg',
                  a.disabled ? 'bg-gray-100 text-gray-400' : 'bg-primary-light text-primary',
                )}
                aria-hidden
              >
                <a.icon className="h-4 w-4" />
              </span>
              <span className="truncate">{a.label}</span>
              {a.reason ? <span className="sr-only">. {a.reason}</span> : null}
            </button>
          )
          return (
            <li key={a.key}>
              {a.reason ? (
                <Tooltip label={a.reason} className="w-full">
                  {button}
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

export function BatchAnalyticsRail(props: BatchAnalyticsRailProps) {
  const { summary, loading, error, onRetry } = props

  if (error && !summary) {
    return (
      <aside className={cx(AIC, 'min-w-0 print:hidden')} aria-label="Batch analytics">
        <Notice
          kind="warning"
          title="Insights unavailable."
          actions={
            <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
              Retry
            </Button>
          }
        >
          The batch table is unaffected.
        </Notice>
      </aside>
    )
  }

  if (!summary) {
    return (
      <aside
        className={cx(AIC, 'grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 wide:grid-cols-1 print:hidden')}
        aria-label="Batch analytics"
        aria-busy
      >
        <Skeleton className="h-[19rem]" rounded="xl" />
        <Skeleton className="h-[13rem]" rounded="xl" />
        <Skeleton className="h-[11rem]" rounded="xl" />
      </aside>
    )
  }

  return (
    <aside
      className={cx(AIC, 'grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 wide:grid-cols-1 print:hidden')}
      aria-label="Batch analytics"
      aria-busy={loading || undefined}
    >
      <InsightsCard
        summary={summary}
        scopeLabel={props.scopeLabel}
        healthLink={props.healthLink}
        activeHealth={props.activeHealth}
      />
      <ExpiryTimelineCard summary={summary} />
      <QuickActionsCard
        onScan={props.onScan}
        onBulkUpdate={props.onBulkUpdate}
        onPrintLabels={props.onPrintLabels}
        onExport={props.onExport}
        selectedCount={props.selectedCount}
        rowCount={props.rowCount}
        canWrite={props.canWrite}
        canPrint={props.canPrint}
      />
    </aside>
  )
}

export default BatchAnalyticsRail
