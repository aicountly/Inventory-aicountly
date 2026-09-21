import { Link } from 'react-router-dom'
import { ArrowRight, Info, Sparkles } from 'lucide-react'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import { relativeTimeFromNow } from '../formatters'
import { HealthScoreRing } from './HealthScoreRing'
import type { StockHealth, SuggestedAction } from '../valuationHealth'

/**
 * The panel under the page heading: one score, why it is what it is, and the
 * two or three things worth doing about it.
 *
 * **It is labelled "Stock health insight", not "AI insight."** There is no AI
 * service behind this product (pulse.ts sets out the same reasoning at length):
 * the score is arithmetic over the figures already on this page, the rule is in
 * valuationHealth.ts, and the tooltip on the heading names the six factors. A
 * reader told this is a model would act on it as one.
 *
 * Every action pill is a real finding with a real screen behind it. When
 * nothing needs attention there are no pills — an empty row of buttons that
 * lead nowhere is worse than no row at all.
 */
export interface StockHealthHeroProps {
  health: StockHealth
  actions: readonly SuggestedAction[]
  /** False while every source is still in flight — the panel says so. */
  anyDataKnown: boolean
  lastSyncedAt?: number | null
  loading?: boolean
  className?: string
}

const METHODOLOGY =
  'Stock health combines ageing, slow-moving and non-moving share, expiry exposure, value concentration and inventory exceptions. Every factor is arithmetic over the figures on this page — no forecast and no model.'

export function StockHealthHero({
  health,
  actions,
  anyDataKnown,
  lastSyncedAt,
  loading = false,
  className,
}: StockHealthHeroProps) {
  if (loading && !anyDataKnown) return <StockHealthHeroSkeleton className={className} />

  const partial = health.score !== null && health.assessed < health.total

  return (
    <section
      aria-label="Stock health"
      className={cx(
        'relative overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/50 p-4',
        // Three children, two columns below xl: the actions block takes a row of
        // its own. Without the span it lands in the `auto` column and sizes it
        // to the widest pill, which squeezes the message into a ribbon.
        'grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)] xl:items-center',
        className,
      )}
    >
      <HealthScoreRing score={health.score} tone={health.tone} />

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Stock health insight
          <Tooltip label={METHODOLOGY} placement="bottom">
            <span
              tabIndex={0}
              role="note"
              aria-label="How the stock health score is calculated"
              className="inline-flex rounded text-emerald-600 hover:text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Info className="h-3 w-3" aria-hidden />
            </span>
          </Tooltip>
        </p>

        <h2 className="mt-1 text-lg font-bold leading-tight text-gray-900">
          {anyDataKnown ? health.label : 'Stock health is still being calculated'}
        </h2>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-gray-600">
          {anyDataKnown ? health.summary : 'The figures behind the score have not finished loading.'}
        </p>

        <p className="mt-1.5 text-[11px] text-gray-500">
          {/* The provenance line, same contract as the Pulse briefing: what a
              reader has to know before acting on the number above it. */}
          Rule-based score over the figures on this page
          {partial ? ` · ${health.assessed} of ${health.total} factors could be read` : ''}
          {lastSyncedAt ? ` · updated ${relativeTimeFromNow(lastSyncedAt)}` : ''}
        </p>
      </div>

      {actions.length > 0 ? (
        <div className="col-span-full min-w-0 xl:col-span-1 xl:border-l xl:border-emerald-200 xl:pl-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Suggested actions</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {actions.map((action) => (
              <li key={action.key}>
                <Link
                  to={action.to}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-emerald-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-gray-800 no-underline shadow-sm transition-colors hover:border-emerald-400 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 print:hidden"
                >
                  {action.label}
                  <ArrowRight className="h-3 w-3 text-emerald-600" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : anyDataKnown ? (
        <p className="col-span-full min-w-0 text-xs text-gray-500 xl:col-span-1 xl:border-l xl:border-emerald-200 xl:pl-4">
          Nothing in this scope needs attention right now.
        </p>
      ) : null}
    </section>
  )
}

export function StockHealthHeroSkeleton({ className }: { className?: string }) {
  return (
    <section
      aria-hidden
      className={cx(
        'grid gap-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 md:grid-cols-[auto_minmax(0,1fr)]',
        className,
      )}
    >
      <div className="skeleton h-[88px] w-[88px] rounded-full" />
      <div className="min-w-0 space-y-2 self-center">
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-5 w-56 rounded" />
        <div className="skeleton h-3 w-full max-w-md rounded" />
      </div>
    </section>
  )
}

export default StockHealthHero
