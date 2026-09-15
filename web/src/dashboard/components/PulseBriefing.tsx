import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Sparkles } from 'lucide-react'
import { cx } from '../../ui/cx'
import { relativeTimeFromNow } from '../formatters'
import { pulseHeadline } from '../pulse'
import type { PulseFinding, PulseSeverity } from '../pulse'

/**
 * The briefing strip under the KPIs.
 *
 * Deliberately labelled "Rule-based summary": everything in it is arithmetic
 * over the figures already on the screen (see pulse.ts), and calling that an
 * AI insight would be a claim about a capability this product does not have.
 * A reader who trusts the label can trust the numbers; a reader who is told it
 * is a forecast will act on it as one.
 *
 * At most three findings, because a briefing that lists nine things is a list,
 * not a briefing — and the fourth onwards are already on the cards below.
 */
export interface PulseBriefingProps {
  findings: readonly PulseFinding[]
  /** False while every source is still in flight — the headline says so. */
  anyDataKnown: boolean
  /** When the figures behind it last landed. */
  lastSyncedAt?: number | null
  /** The page's own "show me everything" link. */
  reviewTo?: string
  reviewLabel?: string
  className?: string
}

const SEVERITY_ICON: Record<PulseSeverity, typeof AlertTriangle> = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
}

const SEVERITY_CLASS: Record<PulseSeverity, string> = {
  critical: 'text-red-600',
  warning: 'text-amber-600',
  info: 'text-sky-600',
}

export function PulseBriefing({
  findings,
  anyDataKnown,
  lastSyncedAt,
  reviewTo,
  reviewLabel = 'Review',
  className,
}: PulseBriefingProps) {
  const top = findings.slice(0, 3)
  const clear = anyDataKnown && findings.length === 0

  return (
    <section
      aria-label="Inventory briefing"
      className={cx(
        'flex flex-col gap-3 rounded-xl border p-3 md:flex-row md:items-start md:justify-between',
        clear ? 'border-emerald-200 bg-emerald-50/50' : 'border-primary/25 bg-primary-light/40',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span
          className={cx(
            'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg',
            clear ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-primary',
          )}
          aria-hidden
        >
          {clear ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            {pulseHeadline(findings, anyDataKnown)}
          </h2>

          {top.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {top.map((f) => {
                const Icon = SEVERITY_ICON[f.severity]
                return (
                  <li key={f.key} className="flex items-start gap-1.5 text-xs text-gray-700">
                    <Icon className={cx('mt-0.5 h-3 w-3 shrink-0', SEVERITY_CLASS[f.severity])} aria-hidden />
                    <span className="min-w-0">
                      {f.text}
                      {f.to ? (
                        <>
                          {' '}
                          <Link to={f.to} className="font-semibold text-primary hover:underline print:hidden">
                            {f.actionLabel ?? 'Open'}
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}

          <p className="mt-1.5 text-[11px] text-gray-500">
            {/* The provenance line. It is not a disclaimer in small print — it is
                the difference between a number someone can act on and a number
                they have to go and verify first. */}
            Rule-based summary of the figures on this page
            {findings.length > top.length ? ` · ${findings.length - top.length} more below` : ''}
            {lastSyncedAt ? ` · updated ${relativeTimeFromNow(lastSyncedAt)}` : ''}
          </p>
        </div>
      </div>

      {reviewTo ? (
        <Link
          to={reviewTo}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-primary no-underline hover:border-primary/40 print:hidden"
        >
          {reviewLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
    </section>
  )
}

export default PulseBriefing
