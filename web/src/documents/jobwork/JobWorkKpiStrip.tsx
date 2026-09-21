import { AlertTriangle, Boxes, Coins, PackageCheck, Timer, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Notice } from '../../components/Notice'
import { StatCard, StatCardSkeleton } from '../../ui/StatCard'
import type { IconTone } from '../../ui/IconTile'
import { REGISTER_KPI_GRID } from '../../styles/designTokens'
import { formatDate, formatInt, formatMoney, formatQty } from '../../utils/format'
import type { JobWorkSummary } from '../../services/jobWorkApi'
import type { JobWorkMode } from './jobWorkModel'

interface Kpi {
  key: string
  label: string
  value: string
  hint: string
  icon: LucideIcon
  tone: IconTone
  /** Only set where a like-for-like comparative exists; StatCard draws no chip without one. */
  current?: number | null
  previous?: number | null
  invertDelta?: boolean
}

function orders(n: number): string {
  return `${formatInt(n)} job order${n === 1 ? '' : 's'}`
}

/**
 * The five figures, derived from one `/v1/job-work/summary` read.
 *
 * Exported for its own test: what the strip claims about a period, and which
 * card carries a delta chip, is a rule and not a rendering detail. A chip is
 * drawn only where the endpoint sent a real previous-period figure — a
 * comparison against a guess would be worse than no comparison.
 */
export function jobWorkKpis(summary: JobWorkSummary, mode: JobWorkMode): Kpi[] {
  const turnaround: Kpi = {
    key: 'turnaround',
    label: 'Avg. turnaround',
    value: summary.turnaround.days === null ? '—' : `${formatQty(summary.turnaround.days)} days`,
    hint:
      summary.turnaround.days === null
        ? 'Nothing settled this month'
        : `Over ${formatInt(summary.turnaround.samples)} settlement${summary.turnaround.samples === 1 ? '' : 's'}`,
    icon: Timer,
    tone: 'violet',
    current: summary.turnaround.days,
    previous: summary.turnaround_previous.days,
    // Coming back sooner is the good direction, so a fall is the green chip.
    invertDelta: true,
  }

  const open: Kpi = {
    key: 'open',
    label: 'With job workers',
    value: formatQty(summary.open.qty, '0'),
    hint: orders(summary.open.orders),
    icon: Boxes,
    tone: 'info',
  }

  const overdue: Kpi = {
    key: 'overdue',
    label: 'Overdue',
    value: formatQty(summary.overdue.qty, '0'),
    hint: summary.overdue.qty > 0 ? orders(summary.overdue.orders) : 'Nothing past its return date',
    icon: AlertTriangle,
    tone: summary.overdue.qty > 0 ? 'danger' : 'slate',
  }

  if (mode === 'in') {
    return [
      open,
      {
        key: 'received',
        label: 'Received this month',
        value: formatQty(summary.received.qty, '0'),
        hint: `${formatInt(summary.received.documents)} receipt${summary.received.documents === 1 ? '' : 's'}`,
        icon: PackageCheck,
        tone: 'success',
        current: summary.received.qty,
        previous: summary.received_previous.qty,
      },
      {
        key: 'value',
        label: 'Value received',
        value: formatMoney(summary.received.value, '0.00'),
        hint: `Since ${formatDate(summary.window.from)}`,
        icon: Coins,
        tone: 'warning',
        current: summary.received.value,
        previous: summary.received_previous.value,
      },
      {
        key: 'due',
        label: 'Due for receipt',
        value: formatQty(summary.due.qty, '0'),
        hint: summary.due.qty > 0 ? orders(summary.due.orders) : 'Nothing due yet',
        icon: AlertTriangle,
        tone: summary.overdue.qty > 0 ? 'danger' : 'teal',
      },
      turnaround,
    ]
  }

  return [
    {
      key: 'sent',
      label: 'Sent this month',
      value: formatQty(summary.sent.qty, '0'),
      hint: `${formatInt(summary.sent.documents)} challan${summary.sent.documents === 1 ? '' : 's'}`,
      icon: TrendingUp,
      tone: 'primary',
      current: summary.sent.qty,
      previous: summary.sent_previous.qty,
    },
    {
      key: 'challan_value',
      label: 'Challan value',
      value: formatMoney(summary.sent.value, '0.00'),
      hint: `Since ${formatDate(summary.window.from)}`,
      icon: Coins,
      tone: 'warning',
      current: summary.sent.value,
      previous: summary.sent_previous.value,
    },
    open,
    overdue,
    turnaround,
  ]
}

const PLACEHOLDER_COUNT = 5

export interface JobWorkKpiStripProps {
  summary: JobWorkSummary | null
  loading: boolean
  error: string | null
  mode: JobWorkMode
  onRetry: () => void
}

/**
 * The position above the form.
 *
 * A failure here is never fatal: the cards fall back to an em dash and a
 * non-blocking note, and every field, line and posting path below stays
 * exactly as usable as it was. The entry screen does not depend on knowing how
 * the month has gone.
 */
export function JobWorkKpiStrip({ summary, loading, error, mode, onRetry }: JobWorkKpiStripProps) {
  if (loading && !summary) {
    return (
      <div className={REGISTER_KPI_GRID} aria-hidden>
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </div>
    )
  }

  if (!summary) {
    return (
      <Notice
        kind="warning"
        actions={
          <button type="button" className="aic text-xs font-semibold text-primary hover:underline" onClick={onRetry}>
            Retry
          </button>
        }
      >
        {error ?? 'The job-work position is unavailable.'} You can still enter and post this document.
      </Notice>
    )
  }

  return (
    <div className={REGISTER_KPI_GRID}>
      {jobWorkKpis(summary, mode).map((kpi) => (
        <StatCard
          key={kpi.key}
          layout="metric"
          label={kpi.label}
          value={kpi.value}
          hint={kpi.hint}
          icon={kpi.icon}
          tone={kpi.tone}
          current={kpi.current}
          previous={kpi.previous}
          invertDelta={kpi.invertDelta}
        />
      ))}
    </div>
  )
}
