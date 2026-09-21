import { Boxes, CircleCheckBig, Hourglass, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react'
import { Notice } from '../../../components/Notice'
import { Button } from '../../../ui/Button'
import { StatCard, StatCardSkeleton } from '../../../ui/StatCard'
import { Tooltip } from '../../../ui/Tooltip'
import type { BatchSummary } from '../../../services/masters'
import { formatInt, formatQty } from '../../../utils/format'
import type { BatchState } from './batchExpiry'

/**
 * Five operational figures, every one of them counted by the server over the
 * whole filtered set (`GET /v1/batches/summary`).
 *
 * None of them is derived from the page of rows below. "248 batches" worked out
 * from the 50 rows on screen is a different number on page two, and a card that
 * changes when the reader pages is a card nobody trusts a second time.
 *
 * Only the first card carries a delta, and only because a real comparison
 * exists behind it: batches opened in the last window against the window before
 * it, both counted server-side. On-hand has no history on this table, so that
 * card carries a caption instead of a percentage nobody measured.
 *
 * Three of the cards are links, not buttons. The list's whole state lives in
 * the query string, so "show me the expiring ones" is an address — shareable,
 * bookmarkable, and reachable with the middle mouse button.
 */

const GRID = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 print:hidden'

export interface BatchKpiCardsProps {
  summary: BatchSummary | null
  loading: boolean
  error: Error | null
  onRetry: () => void
  /** Builds the URL a card drills into; omit to render plain cards. */
  stateHref?: (state: BatchState) => string
}

function shareOfTotal(part: number, whole: number): string {
  if (whole <= 0) return 'no batches yet'
  return `${Math.round((part / whole) * 100)}% of total`
}

export function BatchKpiCards({ summary, loading, error, onRetry, stateHref }: BatchKpiCardsProps) {
  if (error && !summary) {
    return (
      <Notice
        kind="warning"
        title="Batch totals unavailable."
        actions={
          <Button variant="secondary" size="xs" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        }
      >
        The batches below are unaffected — only the figures above them could not be counted.
      </Notice>
    )
  }

  if (!summary) {
    return (
      <div className={GRID} aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <StatCardSkeleton key={i} layout="metric" />
        ))}
      </div>
    )
  }

  const { states, expiry_window_days: windowDays } = summary
  const cards: {
    key: string
    label: string
    hint: string
    tooltip: string
    value: string
    icon: typeof Boxes
    tone: 'violet' | 'success' | 'warning' | 'danger' | 'info'
    state?: BatchState
    current?: number
    previous?: number
    invertDelta?: boolean
  }[] = [
    {
      key: 'total',
      label: 'Total batches',
      value: formatInt(summary.total),
      hint: `vs prior ${windowDays}d`,
      tooltip: 'Number of batches matching the current company, branch and financial-year context, and the filters below.',
      icon: Boxes,
      tone: 'violet',
      current: summary.created_recent,
      previous: summary.created_previous,
    },
    {
      key: 'active',
      label: 'Active batches',
      value: formatInt(states.active),
      hint: shareOfTotal(states.active, summary.total),
      tooltip: 'Batches marked active whose expiry date is still comfortably ahead — or which carry no expiry date at all.',
      icon: CircleCheckBig,
      tone: 'success',
      state: 'active',
    },
    {
      key: 'expiring',
      label: 'Expiring soon',
      value: formatInt(states.expiring_soon),
      hint: `within ${windowDays} days`,
      tooltip: `Active batches expiring within the configured warning period of ${windowDays} days.`,
      icon: Hourglass,
      tone: 'warning',
      state: 'expiring_soon',
      invertDelta: true,
    },
    {
      key: 'expired',
      label: 'Expired',
      value: formatInt(states.expired),
      hint: states.expired > 0 ? 'needs attention' : 'nothing past its date',
      tooltip: 'Batches whose expiry date has passed, and batches whose stored status is already Expired.',
      icon: TriangleAlert,
      tone: 'danger',
      state: 'expired',
      invertDelta: true,
    },
    {
      key: 'on-hand',
      label: 'Total on hand',
      value: formatQty(summary.total_on_hand, '0'),
      hint: `${formatInt(summary.with_stock)} in stock`,
      tooltip: 'Total physical quantity currently available across the matching batches, in each item’s own base unit.',
      icon: PackageCheck,
      tone: 'info',
    },
  ]

  return (
    // A named region: five bare figures in a row are meaningless to a screen
    // reader arriving at them out of context, and it gives the strip an
    // addressable identity for tests too.
    <section className={GRID} role="group" aria-label="Batch summary" aria-busy={loading || undefined}>
      {cards.map((card) => (
        <Tooltip key={card.key} label={card.tooltip} className="min-w-0">
          <StatCard
            layout="metric"
            className="w-full"
            label={card.label}
            value={card.value}
            icon={card.icon}
            tone={card.tone}
            hint={card.hint}
            current={card.current}
            previous={card.previous}
            invertDelta={card.invertDelta}
            to={card.state && stateHref ? stateHref(card.state) : undefined}
          />
        </Tooltip>
      ))}
    </section>
  )
}

export default BatchKpiCards
