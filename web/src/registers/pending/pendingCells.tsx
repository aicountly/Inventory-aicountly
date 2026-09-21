import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { cx } from '../../ui/cx'
import { formatDate, formatMoney } from '../../utils/format'
import type { PendingPriority, PendingRow, PendingStatus } from '../../services/stockApi'

/**
 * The register's own vocabulary, in one place.
 *
 * The badge, the filter option and the CSV cell for a status all have to say the
 * same word, and the ageing colour in the table has to agree with the bucket the
 * filter offers. Both are derived server-side (PendingRegisterQuery); this is
 * only how they are spelled on screen.
 */

export const PENDING_STATUS_TONE: Record<PendingStatus, BadgeTone> = {
  open: 'warning',
  partial: 'warning',
  overdue: 'danger',
  settling: 'info',
  settled: 'success',
  cancelled: 'neutral',
}

export const PENDING_STATUS_LABEL: Record<PendingStatus, string> = {
  open: 'Open',
  partial: 'Partial',
  overdue: 'Overdue',
  settling: 'Settling',
  settled: 'Settled',
  cancelled: 'Cancelled',
}

export const PENDING_STATUS_OPTIONS = (Object.keys(PENDING_STATUS_LABEL) as PendingStatus[]).map(
  (value) => ({ value, label: PENDING_STATUS_LABEL[value] }),
)

export const PENDING_PRIORITY_TONE: Record<PendingPriority, BadgeTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
}

export const PENDING_PRIORITY_LABEL: Record<PendingPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const PENDING_KIND_LABEL: Record<string, string> = {
  challan: 'Challan',
  deferred_purchase: 'Deferred purchase',
  job_work: 'Job work',
}

export function pendingKindLabel(kind: string): string {
  return PENDING_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ')
}

/**
 * Direction, as a small badge.
 *
 * `in` is stock owed to us and `out` is stock that has left, so the arrows point
 * the way the goods move rather than the way a number moves. The word is always
 * there: colour alone is not a status.
 */
export function DirectionBadge({ direction }: { direction: 'in' | 'out' }) {
  const inbound = direction === 'in'
  const Icon = inbound ? ArrowDownLeft : ArrowUpRight
  return (
    <Badge tone={inbound ? 'success' : 'danger'} size="xs">
      <Icon className="h-3 w-3" aria-hidden strokeWidth={2} />
      {inbound ? 'In' : 'Out'}
    </Badge>
  )
}

/** The ageing thresholds the cell is coloured by. Mirrors PendingRegisterPolicy. */
const AGE_STEPS: { from: number; className: string; note: string }[] = [
  { from: 31, className: 'font-semibold text-red-600', note: 'Over a month open' },
  { from: 16, className: 'font-semibold text-amber-600', note: 'Open more than a fortnight' },
  { from: 8, className: 'text-gray-700', note: 'Open more than a week' },
  { from: 0, className: 'text-gray-500', note: 'Raised within the week' },
]

/**
 * How long the line has been open, and how that is trending.
 *
 * Ageing runs from the document date — how long the quantity has been
 * outstanding. Whether it is LATE is a different question, answered by the due
 * date, and the two are kept apart on purpose: a challan raised sixty days ago
 * with ninety days to run is old and perfectly in order.
 *
 * The colour is a second encoding of the number beside it, never the only one,
 * and the `title` says in words what the colour says in red.
 */
export function AgeingCell({ row }: { row: PendingRow }) {
  const days = row.ageing_days ?? 0
  const step = AGE_STEPS.find((s) => days >= s.from) ?? AGE_STEPS[AGE_STEPS.length - 1]
  const overdue = row.is_overdue
  const dueNote = row.due_date
    ? row.has_expected_date
      ? `Expected ${formatDate(row.due_date)}`
      : `No expected date recorded; measured against the company's grace period, which ended ${formatDate(row.due_date)}`
    : 'No expected date'

  return (
    <span
      className={cx('whitespace-nowrap tabular-nums', step.className)}
      title={`${step.note}. ${dueNote}.${overdue ? ` Overdue by ${row.days_overdue} days.` : ''}`}
    >
      {days} {days === 1 ? 'day' : 'days'}
      {overdue ? (
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-red-500">
          late
        </span>
      ) : null}
    </span>
  )
}

export function PendingStatusBadge({ status }: { status: PendingStatus }) {
  return (
    <Badge tone={PENDING_STATUS_TONE[status] ?? 'neutral'} size="xs" dot className="normal-case">
      {PENDING_STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/**
 * Priority, with the reason it was given.
 *
 * Derived, not entered, so the tooltip says what it was derived from — a badge a
 * reader cannot account for is one they learn to ignore.
 */
export function PriorityBadge({ row }: { row: PendingRow }) {
  // No currency symbol: the base currency is a company setting, not an
  // assumption, so the figure is stated and the unit is named in words.
  const reasons: string[] = []
  if (row.is_overdue) reasons.push(`overdue by ${row.days_overdue} days`)
  if (row.pending_value > 0) reasons.push(`${formatMoney(row.pending_value)} pending at cost`)
  reasons.push(`${row.ageing_days} days open`)

  return (
    <Badge
      tone={PENDING_PRIORITY_TONE[row.priority] ?? 'neutral'}
      size="xs"
      className="normal-case"
      // Not the only signal: the word is in the badge.
    >
      <span title={`Derived from: ${reasons.join(', ')}.`}>
        {PENDING_PRIORITY_LABEL[row.priority] ?? row.priority}
      </span>
    </Badge>
  )
}
