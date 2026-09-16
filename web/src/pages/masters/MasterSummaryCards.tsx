import { Clock3, Database, FileClock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip } from '../../ui/Tooltip'
import { AIC, cx } from '../../ui/cx'
import { QuickCreateMenu } from './QuickCreateMenu'

/**
 * The four figures above the grid.
 *
 * Three read-outs and one action. Each figure arrives as `number | null`: null
 * means "could not be read" and renders an em dash, never a zero — a zero is a
 * claim about the company's data, and is only printed when the API really said
 * so.
 *
 * Where a figure is derived rather than fetched, `hint` states the derivation.
 * It is shown on hover and repeated for screen readers inside the card, rather
 * than hung off a focusable info glyph: these cards are not interactive and
 * should not become tab stops.
 */

interface SummaryCardProps {
  icon: LucideIcon
  /** Tailwind classes for the icon tile — the card's only colour. */
  tone: string
  value: number | null
  label: string
  helper: string
  hint?: string
  loading?: boolean
}

function SummaryCard({ icon: Icon, tone, value, label, helper, hint, loading }: SummaryCardProps) {
  const card = (
    <div className="flex h-full w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <span className={cx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        {loading ? (
          <span className="skeleton block h-7 w-12 rounded" aria-hidden />
        ) : (
          <strong className="block text-2xl font-bold leading-tight tabular-nums text-gray-900">
            {value === null ? '—' : value}
          </strong>
        )}
        <div className="mt-0.5 truncate text-sm font-semibold text-gray-900">{label}</div>
        <small className="block truncate text-xs text-gray-500">{helper}</small>
        {hint ? <span className="sr-only">{hint}</span> : null}
      </div>
    </div>
  )

  return (
    <article className={cx(AIC, 'h-full')} aria-busy={loading || undefined}>
      {hint ? (
        <Tooltip label={hint} className="h-full w-full">
          {card}
        </Tooltip>
      ) : (
        card
      )}
    </article>
  )
}

export interface MasterSummaryCardsProps {
  /** Number of master types — counted from the definitions, never typed in. */
  masterTypes: number
  pendingReviews: number | null
  recentlyUpdated: number | null
  loading?: boolean
}

export function MasterSummaryCards({
  masterTypes,
  pendingReviews,
  recentlyUpdated,
  loading,
}: MasterSummaryCardsProps) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Master summary">
      <SummaryCard
        icon={Database}
        tone="bg-primary-light text-primary"
        value={masterTypes}
        label="Master Types"
        helper="Manage your inventory data"
      />
      <SummaryCard
        icon={Clock3}
        tone="bg-amber-50 text-amber-600"
        value={pendingReviews}
        label="Pending Reviews"
        helper="Items require attention"
        hint="Masters with nothing in them yet: essential ones that are still empty, plus optional ones never set up."
        loading={loading}
      />
      <SummaryCard
        icon={FileClock}
        tone="bg-sky-50 text-sky-600"
        value={recentlyUpdated}
        label="Recently Updated"
        helper="In the last 7 days"
        hint="Master types whose most recent record was changed within the last 7 days."
        loading={loading}
      />
      <QuickCreateMenu />
    </section>
  )
}

export default MasterSummaryCards
