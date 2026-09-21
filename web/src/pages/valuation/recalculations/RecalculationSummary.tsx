import {
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  CircleX,
  Clock3,
  ListChecks,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import type { IconTone } from '../../../ui/IconTile'
import { Tooltip } from '../../../ui/Tooltip'
import { formatInt } from '../../../utils/format'
import { RECALC_IN_PROGRESS } from '../../../services/valuationApi'
import type { RecalcSummary } from '../../../services/valuationApi'
import { formatCogsDelta, recalcKpis, shareOfTotal } from './recalculationModel'

/**
 * Five cards, all five counted by the server over the whole filtered register —
 * never over the page on screen. See ValuationController::recalcSummary.
 *
 * Deliberately NOT a six-up `SUMMARY_CARD_GRID`: this register shows exactly
 * five figures, and the shared strip would leave a sixth column empty on a wide
 * screen. The steps below `xl` fold to whole rows (3 + 2, then 2 + 2 + 1, then
 * one column) rather than crushing five cards into a 1024px window.
 */
const KPI_GRID =
  'grid shrink-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 print:hidden'

interface CardSpec {
  key: string
  label: string
  value: ReactNode
  hint: ReactNode
  icon: LucideIcon
  tone: IconTone
  /** What the figure counts, in a sentence, on hover and focus. */
  tooltip: string
  to?: string
  current?: number
  previous?: number
}

/** `?status=…` for a card that drills into the register it is counting. */
function statusLink(status: string): string {
  return `/valuation/recalculations?status=${encodeURIComponent(status)}`
}

export function RecalculationSummary({
  summary,
  currencyCode,
  loading,
  error,
}: {
  summary: RecalcSummary | null
  currencyCode: string
  loading: boolean
  error: Error | null
}) {
  // First load only. A refresh keeps the figures on screen: replacing a number a
  // reader is looking at with a grey bar is worse than one a second out of date.
  if (!summary && loading) {
    return (
      <div className={KPI_GRID}>
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </div>
    )
  }

  /*
   * Metrics failed but the jobs did not.
   *
   * The register below is still worth reading, so the cards keep their shape and
   * say they have no figure rather than showing a zero — "Failed 0" on a screen
   * whose failure count could not be fetched is the one thing these cards must
   * never print.
   */
  if (!summary) {
    return (
      <div className={KPI_GRID}>
        {SHELL_LABELS.map(([label, icon, tone]) => (
          <StatCard
            key={label}
            layout="metric"
            label={label}
            value="—"
            hint={error ? 'Figure unavailable' : '—'}
            icon={icon}
            tone={tone}
          />
        ))}
      </div>
    )
  }

  const k = recalcKpis(summary)
  const scopeNote = summary.ignores_status_filter
    ? ' Counted across every status, so the breakdown stays readable while the register is filtered.'
    : ''

  const cards: CardSpec[] = [
    {
      key: 'total',
      label: 'Total recalculations',
      value: formatInt(k.total),
      hint: `${formatInt(k.queuedThisMonth)} this month`,
      icon: ListChecks,
      tone: 'info',
      tooltip: `Every recalculation job matching the current filters.${scopeNote}`,
      // Real month-over-month volume from the server, so the chip is a measured
      // trend and not an estimate. Never shown for the COGS card below.
      current: k.queuedThisMonth,
      previous: k.queuedPrevMonth,
    },
    {
      key: 'completed',
      label: 'Completed',
      value: formatInt(k.completed),
      hint: k.successRate === null ? 'No job has finished yet' : `${k.successRate.toFixed(0)}% success rate`,
      icon: CircleCheck,
      tone: 'success',
      tooltip:
        'Jobs whose replay finished. The rate is completed jobs as a share of those that reached an outcome — queued and running jobs are not counted against it.',
      to: statusLink('COMPLETED'),
    },
    {
      key: 'in-progress',
      label: 'Queued / Running',
      value: formatInt(k.inProgress),
      hint: shareOfTotal(k.inProgress, k.total) ?? 'Nothing in the queue',
      icon: Clock3,
      tone: 'warning',
      tooltip: 'Jobs accepted and not yet finished. This screen polls while any of them are open.',
      to: statusLink(RECALC_IN_PROGRESS),
    },
    {
      key: 'failed',
      label: 'Failed',
      value: formatInt(k.failed),
      hint: shareOfTotal(k.failed, k.total) ?? 'None',
      icon: CircleX,
      tone: 'danger',
      tooltip: 'Jobs that stopped before writing anything. Stored valuation is unchanged for these.',
      to: statusLink('FAILED'),
    },
    {
      key: 'cogs-delta',
      label: 'Total COGS delta',
      value: formatCogsDelta(k.cogsDelta, currencyCode, { decimals: false }),
      hint: `${formatCogsDelta(k.cogsDeltaThisMonth, currencyCode, { decimals: false })} this month`,
      icon: ChartNoAxesColumnIncreasing,
      tone: 'violet',
      tooltip:
        'Change in the cost of goods sold produced by the valuation revisions these jobs published. A movement, not a score — neither direction is good or bad on its own.',
      /*
       * No `current` / `previous` here ON PURPOSE. StatCard's delta chip is
       * green when it rises and red when it falls, and a rising COGS delta is
       * not good news any more than a falling one is bad — it is a restatement
       * of cost that the P&L in Books interprets. The month's own figure is
       * printed instead, uncoloured.
       */
    },
  ]

  return (
    <div className={KPI_GRID}>
      {cards.map((card) => (
        <Tooltip key={card.key} label={card.tooltip} className="w-full">
          <StatCard
            layout="metric"
            label={card.label}
            value={card.value}
            hint={card.hint}
            icon={card.icon}
            tone={card.tone}
            to={card.to}
            current={card.current}
            previous={card.previous}
            className="w-full"
          />
        </Tooltip>
      ))}
    </div>
  )
}

/** Label, glyph and tone of each card, for the figure-unavailable shells. */
const SHELL_LABELS: [string, LucideIcon, IconTone][] = [
  ['Total recalculations', ListChecks, 'info'],
  ['Completed', CircleCheck, 'success'],
  ['Queued / Running', Clock3, 'warning'],
  ['Failed', CircleX, 'danger'],
  ['Total COGS delta', ChartNoAxesColumnIncreasing, 'violet'],
]
