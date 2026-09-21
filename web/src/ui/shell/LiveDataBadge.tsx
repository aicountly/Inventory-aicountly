import { useEffect, useState } from 'react'
import { AIC, cx } from '../cx'
import { formatRelativeTime, relativeTimeTickMs } from '../../utils/relativeTime'

export interface LiveDataBadgeProps {
  /** Clock reading of the last successful response (useQuery's `fetchedAt`). */
  fetchedAt: number | null
  /** A request is in flight — the dot pulses and the label says so. */
  refreshing?: boolean
  /** The last request failed: what is on screen is older than it looks. */
  stale?: boolean
  className?: string
}

/** Twelve points of a calm upward drift. Decoration, not data — see below. */
const SPARK_POINTS = '0,17 8,15 16,16 24,12 32,13 40,9 48,10 56,6 64,7 72,4 80,5 88,2'

/**
 * "● Live data — Last updated just now".
 *
 * The age is computed from the real last-successful-fetch stamp and re-rendered
 * on a coarse timer, so it goes stale on screen exactly as the figures do. A
 * badge hard-wired to "just now" would be the one element on a register that
 * cannot be wrong, which is worse than not showing it.
 *
 * The sparkline is explicitly ornamental and marked `aria-hidden`: it is a
 * fixed path, not a plot of anything. Inventory sends no time series for this
 * grid, and drawing one from the rows on screen would put a trend on a
 * manager's screen that no server ever computed.
 */
export function LiveDataBadge({ fetchedAt, refreshing = false, stale = false, className }: LiveDataBadgeProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (fetchedAt == null) return undefined
    const tick = relativeTimeTickMs(fetchedAt, now)
    const id = window.setInterval(() => setNow(Date.now()), tick)
    return () => window.clearInterval(id)
  }, [fetchedAt, now])

  // Nothing has landed yet: no age to report, so no badge rather than a guess.
  if (fetchedAt == null && !refreshing) return null

  const age = formatRelativeTime(fetchedAt, now)
  const label = refreshing ? 'Refreshing…' : stale ? 'Showing last good data' : 'Live data'

  return (
    <div
      className={cx(
        AIC,
        'inline-flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 print:hidden',
        stale
          ? 'border-amber-200 bg-amber-50/60'
          : 'border-primary/15 bg-gradient-to-r from-primary-light/70 to-primary-light/25',
        className,
      )}
    >
      <span
        className={cx(
          'h-2 w-2 shrink-0 rounded-full',
          stale ? 'bg-amber-500' : 'bg-primary',
          stale ? 'ring-4 ring-amber-500/10' : 'ring-4 ring-primary/10',
          refreshing && 'animate-pulse',
        )}
        aria-hidden
      />
      <span className="min-w-0 leading-tight">
        <span
          className={cx(
            'block text-xs font-semibold',
            stale ? 'text-amber-700' : 'text-primary',
          )}
        >
          {label}
        </span>
        {/* Polite, not assertive: a freshness stamp must never interrupt a
            screen reader mid-sentence to announce that a minute passed. */}
        <span className="mt-0.5 block text-[11px] text-gray-500" aria-live="polite">
          {age ? `Last updated ${age}` : 'Loading…'}
        </span>
      </span>
      <svg
        viewBox="0 0 88 20"
        className={cx('hidden h-5 w-16 shrink-0 sm:block', stale ? 'text-amber-500/50' : 'text-primary/45')}
        fill="none"
        aria-hidden
        focusable="false"
      >
        <polyline
          points={SPARK_POINTS}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/**
 * The "● Live data" pill beside the register's title.
 *
 * The same claim as the badge above, in the smallest form that still has to be
 * true: it appears only once a response has actually landed, and it says
 * something different when the last refresh failed. A pill hard-wired into the
 * heading would assert freshness on a screen showing figures from before a
 * network outage, which is the one moment the reader most needs to be told
 * otherwise. No timestamp here — that is the badge's job, and repeating it
 * beside the title would age twice on one screen.
 */
export function LiveDataPill({
  fetchedAt,
  refreshing = false,
  stale = false,
  className,
}: Omit<LiveDataBadgeProps, 'className'> & { className?: string }) {
  if (fetchedAt == null) return null

  const label = refreshing ? 'Refreshing' : stale ? 'Last good data' : 'Live data'

  return (
    <span
      className={cx(
        AIC,
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold print:hidden',
        stale ? 'bg-amber-50 text-amber-700' : 'bg-primary-light text-primary',
        className,
      )}
    >
      <span
        className={cx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          stale ? 'bg-amber-500 ring-4 ring-amber-500/10' : 'bg-primary ring-4 ring-primary/10',
          refreshing && 'animate-pulse',
        )}
        aria-hidden
      />
      {label}
    </span>
  )
}

export default LiveDataBadge
