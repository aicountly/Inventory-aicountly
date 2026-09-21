import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Ellipsis, Eye, Play, RotateCcw, ScrollText } from 'lucide-react'
import { Button } from '../../../ui/Button'
import { MenuButton } from '../../../ui/MenuButton'
import type { MenuAction } from '../../../ui/MenuButton'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { SmartTable } from '../../../ui/shell/SmartTable'
import type { SmartColumn } from '../../../ui/shell/SmartTable'
import type { SortOrder } from '../../../services/api'
import type { RecalcJob } from '../../../services/valuationApi'
import { formatDate, formatDateTime, formatInt } from '../../../utils/format'
import { RecalculationLiveCell } from './RecalculationStatusBadge'
import {
  formatCogsDelta,
  hasSettledCounts,
  recalcFailure,
  recalcMode,
  recalcReference,
  recalcScope,
  rowAbilities,
  triggerLabel,
} from './recalculationModel'

/** A column heading that explains itself on hover and on keyboard focus. */
function Hint({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip label={label}>
      <span className="underline decoration-dotted decoration-gray-300 underline-offset-4">{children}</span>
    </Tooltip>
  )
}

const DASH = <span className="text-gray-300">—</span>

/*
 * The width of the frozen tick-box gutter, and therefore the left offset of the
 * reference column frozen beside it. One number for both: a gutter one pixel
 * wider than the offset shows a sliver of the scrolled columns between the two
 * frozen cells, which reads as a tear in the table. 34px is the box (14px) in
 * SmartTable's compact cell padding (10px either side); it is declared here so
 * the two cannot be changed apart.
 */
const FROZEN_GUTTER = 34
/** The same 34px as a class. Written out so Tailwind's scanner can see it. */
const FROZEN_OFFSET = 'left-[34px]'

export interface RecalculationTableProps {
  rows: RecalcJob[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  empty: ReactNode
  sort: { key: string; order: SortOrder }
  onSort: (key: string) => void
  /** Company base currency — never assumed to be INR. */
  currencyCode: string
  selected: ReadonlySet<number>
  onToggleRow: (jobId: number) => void
  onTogglePage: (checked: boolean) => void
  onOpen: (job: RecalcJob) => void
  onRun: (job: RecalcJob) => void
  onRetryJob: (job: RecalcJob) => void
  onCancel: (job: RecalcJob) => void
  canRecalculate: boolean
  /** Job ids with a request in flight, so their actions are held. */
  busy: ReadonlySet<number>
  /** Re-read every poll so live rows tick without a refetch. */
  now: number
}

export function RecalculationTable({
  rows,
  loading,
  error,
  onRetry,
  empty,
  sort,
  onSort,
  currencyCode,
  selected,
  onToggleRow,
  onTogglePage,
  onOpen,
  onRun,
  onRetryJob,
  onCancel,
  canRecalculate,
  busy,
  now,
}: RecalculationTableProps) {
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.job_id))
  const someOnPage = rows.some((r) => selected.has(r.job_id))

  const columns = useMemo<SmartColumn<RecalcJob>[]>(
    () => [
      {
        key: '__select',
        width: FROZEN_GUTTER,
        alwaysVisible: true,
        headerClassName: 'sticky left-0 z-20 print:hidden',
        cellClassName: 'sticky left-0 z-[5] bg-white group-hover/row:bg-gray-50 print:hidden',
        header: (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 align-middle accent-[rgb(var(--color-primary))]"
            checked={allOnPage}
            ref={(el) => {
              // Some rows selected, not all: the tri-state box says so instead of
              // reading as "none selected" the instant one row is ticked.
              if (el) el.indeterminate = someOnPage && !allOnPage
            }}
            onChange={(e) => onTogglePage(e.target.checked)}
            aria-label="Select every recalculation on this page"
          />
        ),
        render: (row) => (
          <input
            type="checkbox"
            className="h-3.5 w-3.5 align-middle accent-[rgb(var(--color-primary))]"
            checked={selected.has(row.job_id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleRow(row.job_id)}
            aria-label={`Select ${recalcReference(row.job_id)}`}
          />
        ),
      },
      {
        key: 'job_id',
        header: '#',
        sortKey: 'job_id',
        csvHeader: 'Job',
        headerClassName: cx('sticky z-20 shadow-[1px_0_0_0_rgb(var(--color-border))]', FROZEN_OFFSET),
        cellClassName: cx('sticky z-[5] whitespace-nowrap bg-white group-hover/row:bg-gray-50 shadow-[1px_0_0_0_rgb(var(--color-border))]', FROZEN_OFFSET),
        render: (row) => (
          <span className="font-semibold tabular-nums text-gray-900">{recalcReference(row.job_id)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortKey: 'status',
        minWidth: 124,
        render: (row) => <RecalculationLiveCell job={row} now={now} />,
      },
      {
        key: 'mode',
        header: <Hint label="Dry run reports what would change and writes nothing. A live run writes the revised valuation and publishes COGS revisions to Books.">Mode</Hint>,
        cellClassName: 'whitespace-nowrap',
        render: (row) => {
          const mode = recalcMode(row)
          return (
            <span className={cx('text-xs font-medium', mode.dryRun ? 'text-gray-500' : 'text-gray-800')}>
              {mode.label}
            </span>
          )
        },
      },
      {
        key: 'from_date',
        header: <Hint label="Costing is replayed forward from this date. Every movement on or after it is re-costed in order.">From</Hint>,
        sortKey: 'from_date',
        cellClassName: 'whitespace-nowrap',
        render: (row) => <span className="tabular-nums">{formatDate(row.from_date)}</span>,
      },
      {
        key: 'scope',
        header: <Hint label="What the job covered — one item, one warehouse, or every item in the company.">Scope</Hint>,
        minWidth: 150,
        cellClassName: 'max-w-[13rem] truncate',
        render: (row) => {
          const scope = recalcScope(row)
          if (scope.to) {
            return (
              <Link
                to={scope.to}
                className="text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {scope.label}
              </Link>
            )
          }
          return <span className={scope.type === 'all' ? 'text-gray-500' : undefined}>{scope.label}</span>
        },
      },
      {
        key: 'trigger_kind',
        header: <Hint label="What caused the job — a person, a back-dated document, a reversal, a method change.">Trigger</Hint>,
        sortKey: 'trigger_kind',
        minWidth: 150,
        cellClassName: 'max-w-[14rem] truncate',
        render: (row) => (
          <span className="inline-flex items-center gap-1">
            {triggerLabel(row.trigger_kind)}
            {row.trigger_document_id ? (
              <>
                <span className="text-gray-300">·</span>
                <Link
                  to={`/documents/${row.trigger_document_id}`}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.trigger_document_no ?? `#${row.trigger_document_id}`}
                </Link>
              </>
            ) : null}
          </span>
        ),
      },
      {
        key: 'affected_line_count',
        header: <Hint label="Document lines the replay examined.">Affected</Hint>,
        sortKey: 'affected_line_count',
        align: 'right',
        cellClassName: 'whitespace-nowrap',
        render: (row) => (hasSettledCounts(row) ? formatInt(row.affected_line_count ?? 0) : DASH),
      },
      {
        key: 'revised_line_count',
        header: <Hint label="Of those, the lines whose valuation actually changed and were revised.">Revised</Hint>,
        sortKey: 'revised_line_count',
        align: 'right',
        cellClassName: 'whitespace-nowrap',
        render: (row) => (hasSettledCounts(row) ? formatInt(row.revised_line_count ?? 0) : DASH),
      },
      {
        key: 'cogs_delta',
        header: <Hint label="Change in the cost of goods sold produced by this job's revisions. A movement in cost, not a score — neither direction is good or bad on its own.">COGS delta</Hint>,
        sortKey: 'cogs_delta',
        align: 'right',
        amount: true,
        minWidth: 124,
        cellClassName: 'whitespace-nowrap',
        /*
         * Never coloured by sign. Green here would read as "good" beside a green
         * Completed chip one column away, and a positive COGS delta is not good
         * news — it is more cost recognised. Zero is greyed because "no change"
         * is the one value a reader can safely skip.
         */
        render: (row) => {
          if (!hasSettledCounts(row)) return DASH
          const zero = !row.cogs_delta
          return (
            <span className={cx('font-semibold tabular-nums', zero ? 'text-gray-400' : 'text-gray-900')}>
              {formatCogsDelta(row.cogs_delta, currencyCode)}
            </span>
          )
        },
      },
      {
        key: 'finished_at',
        header: 'Finished',
        sortKey: 'finished_at',
        minWidth: 140,
        cellClassName: 'whitespace-nowrap',
        render: (row) => (row.finished_at ? <span className="tabular-nums">{formatDateTime(row.finished_at)}</span> : DASH),
      },
      {
        key: 'failure_reason',
        header: <Hint label="Why a job stopped. A failed job wrote nothing — the stored valuation is unchanged.">Failure</Hint>,
        minWidth: 120,
        cellClassName: 'max-w-[9rem] truncate',
        render: (row) => {
          const failure = recalcFailure(row.failure_reason)
          if (!failure) return DASH
          return (
            <Tooltip label={failure.full}>
              <span className="text-xs font-medium text-red-600">{failure.short}</span>
            </Tooltip>
          )
        },
      },
      {
        key: '__actions',
        header: '',
        align: 'right',
        width: 112,
        headerClassName: 'sticky right-0 z-20 shadow-[-1px_0_0_0_rgb(var(--color-border))] print:hidden',
        cellClassName: 'sticky right-0 z-[5] bg-white group-hover/row:bg-gray-50 shadow-[-1px_0_0_0_rgb(var(--color-border))] print:hidden',
        render: (row) => {
          const able = rowAbilities(row, canRecalculate)
          const pending = busy.has(row.job_id)
          const actions: MenuAction[] = []
          if (able.canRun) {
            actions.push({ key: 'run', label: 'Run now', icon: Play, onSelect: () => onRun(row) })
          }
          if (able.canRetry) {
            actions.push({ key: 'retry', label: 'Retry recalculation', icon: RotateCcw, onSelect: () => onRetryJob(row) })
          }
          if (able.canOpenRevisions) {
            actions.push({ key: 'revisions', label: 'View revisions', icon: ScrollText, onSelect: () => onOpen(row) })
          }
          if (able.canCancel) {
            actions.push({ key: 'cancel', label: 'Cancel job', icon: Ban, danger: true, separated: actions.length > 0, onSelect: () => onCancel(row) })
          }
          return (
            <div
              className="flex items-center justify-end gap-1.5"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <Button
                variant="secondary"
                size="xs"
                icon={Eye}
                onClick={() => onOpen(row)}
                aria-label={`View ${recalcReference(row.job_id)}`}
              >
                View
              </Button>
              {actions.length > 0 ? (
                <MenuButton
                  actions={actions}
                  // No children: MenuButton drops the aria-label when the button
                  // has visible text, and "···" is not a name anyone can act on.
                  label={`More actions for ${recalcReference(row.job_id)}`}
                  icon={Ellipsis}
                  size="xs"
                  variant="secondary"
                  buttonProps={{ disabled: pending, className: 'px-1.5' }}
                />
              ) : null}
            </div>
          )
        },
      },
    ],
    [allOnPage, someOnPage, selected, onToggleRow, onTogglePage, onOpen, onRun, onRetryJob, onCancel, canRecalculate, busy, currencyCode, now],
  )

  return (
    <SmartTable<RecalcJob>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.job_id}
      loading={loading}
      error={error ? { title: 'Unable to load valuation recalculations.', description: error.message, onRetry } : null}
      empty={empty}
      sort={sort}
      onSort={onSort}
      onRowClick={onOpen}
      activateOnSingleClick
      /*
       * The header stays put while a long register scrolls: without it the reader
       * is guessing which of three right-aligned count columns they are reading.
       *
       * The height cap is gated on `tall:` (≥800px), the same breakpoint the
       * report shells use, so the body only becomes its own scroll area on a
       * screen with room for one. Below it the table renders at its natural
       * height and the page scrolls, which beats squeezing 50 rows into four.
       */
      stickyHeader
      scrollBody
      className="tall:max-h-[calc(100dvh-24rem)]"
      minWidth={1120}
      caption="Valuation recalculation jobs"
      /*
       * `group/row` only, and deliberately NO tint on the failed rows.
       *
       * The frozen columns need an OPAQUE background or the ten scrolling
       * columns slide visibly through them, and every tint in this design system
       * — the row hover, the -50 washes — is a translucent wash over whatever is
       * behind it. A frozen cell therefore cannot wear the row's colour, so a
       * tinted failed row would read as pink in the middle and white at both
       * frozen ends, which looks like a rendering fault rather than a status.
       * The Failed chip and the red failure text carry the signal instead, which
       * is also what a monochrome print and a colour-blind reader get.
       */
      rowClassName={() => 'group/row'}
    />
  )
}
