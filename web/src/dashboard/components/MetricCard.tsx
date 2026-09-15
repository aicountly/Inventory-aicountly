import { Link } from 'react-router-dom'
import { ArrowUpRight, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../../ui/Badge'
import type { BadgeTone } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { ICON_TILE_SIZE, IconTile } from '../../ui/IconTile'
import type { IconTone } from '../../ui/IconTile'
import { Tooltip } from '../../ui/Tooltip'
import { cx } from '../../ui/cx'
import type { MetricState } from '../aggregatesApi'

/**
 * A KPI card that can say "we don't know" four different ways.
 *
 * StatCard renders a figure. This renders a figure OR the reason there isn't
 * one, which on these dashboards is most of the work:
 *
 *   loading         the card's own shell, greyed — never a spinner, never "0"
 *   ready           the figure, with its definition one hover away
 *   empty           the query worked and there is nothing to show
 *   not_configured  the product does not model this; says so, and points at
 *                   the nearest real screen (see "Transfers in transit")
 *   unavailable     the source could not be read; offers Retry
 *   error           same, with the message
 *
 * Zero is a figure, and it renders as `0`. The one thing this component will
 * not do is show a confident number when the request behind it failed — that
 * is how a dashboard gets someone to stand down on a problem that is still
 * there.
 *
 * `definition` is not optional for a reason: every figure on these screens has
 * to be able to say what it counts. "Receipts today: 24" is unreconcilable
 * until you know it counts documents rather than lines.
 */
export interface MetricCardProps {
  label: string
  /** Already formatted for display. `null` while loading. */
  value: string | null
  /** What it counts, in the user's words. Shown in the tooltip. */
  definition: string
  state?: MetricState
  /** Present on `not_configured` — why the product has no such figure. */
  reason?: string
  /** Secondary line under the figure. */
  hint?: ReactNode
  icon?: LucideIcon
  tone?: IconTone
  badge?: { label: string; tone?: BadgeTone }
  loading?: boolean
  error?: Error | null
  onRetry?: () => void
  /** The drill-through: the register that reproduces this number. */
  to?: string
  /** Where `not_configured` sends the reader instead. */
  insteadTo?: string
  insteadLabel?: string
  emphasizeNegative?: boolean
  numeric?: number | null
  className?: string
}

const SHELL = 'flex flex-col gap-2 min-w-[160px]'
const HEAD = 'flex items-start justify-between gap-2'
const LABEL = 'text-[11px] font-medium text-gray-500 uppercase tracking-wide truncate'
const VALUE = 'mt-0.5 text-lg font-semibold tabular-nums truncate'
const FOOT = 'flex items-center gap-1.5 text-[11px] text-gray-500 min-h-[16px]'
const BAR = 'skeleton inline-block rounded text-transparent'

export function MetricCard({
  label,
  value,
  definition,
  state = 'ready',
  reason,
  hint,
  icon,
  tone = 'primary',
  badge,
  loading = false,
  error = null,
  onRetry,
  to,
  insteadTo,
  insteadLabel = 'See instead',
  emphasizeNegative = false,
  numeric = null,
  className,
}: MetricCardProps) {
  if (loading) return <MetricCardSkeleton className={className} />

  const unavailable = Boolean(error) || state === 'unavailable'
  const notConfigured = state === 'not_configured'

  // Only a real, readable figure earns the drill-through. A card that cannot
  // show its number must not offer to show the register "behind" it either.
  const linkTo = !unavailable && !notConfigured && value !== null ? to : undefined

  const body = (
    <>
      <div className={HEAD}>
        <IconTile icon={icon} tone={unavailable ? 'danger' : notConfigured ? 'slate' : tone} size="sm" />
        {badge && !unavailable && !notConfigured ? (
          <Badge tone={badge.tone ?? 'success'} size="xs">
            {badge.label}
          </Badge>
        ) : null}
        {notConfigured ? (
          <Badge tone="neutral" size="xs">
            Not tracked
          </Badge>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className={LABEL}>
          {label}
          <Tooltip label={notConfigured && reason ? reason : definition} placement="bottom">
            <span
              tabIndex={0}
              role="note"
              aria-label={`What ${label} counts`}
              className="ml-1 inline-flex align-middle text-gray-300 hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
            >
              <Info className="h-3 w-3" aria-hidden />
            </span>
          </Tooltip>
        </p>
        <p
          className={cx(
            VALUE,
            unavailable || notConfigured
              ? 'text-gray-400'
              : emphasizeNegative && typeof numeric === 'number' && numeric < 0
                ? 'text-red-600'
                : 'text-gray-900',
          )}
        >
          {unavailable ? 'Unavailable' : notConfigured ? 'Not tracked' : state === 'empty' ? 'None' : (value ?? 'Unavailable')}
        </p>
      </div>

      <div className={FOOT}>
        {unavailable ? (
          <span className="truncate text-red-600">{error ? error.message : 'Could not read this figure'}</span>
        ) : notConfigured ? (
          <span className="truncate text-gray-400">{reason ?? 'This product does not model it'}</span>
        ) : (
          <span className="truncate text-gray-400">{hint ?? definition}</span>
        )}
      </div>
    </>
  )

  return (
    <Card
      as={linkTo ? Link : 'div'}
      to={linkTo}
      aria-label={linkTo ? `Open ${label}` : undefined}
      padding="sm"
      interactive={Boolean(linkTo)}
      className={cx(SHELL, className)}
    >
      {body}
      {unavailable && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:border-primary/40 hover:text-primary print:hidden"
        >
          Retry
        </button>
      ) : null}
      {notConfigured && insteadTo ? (
        <Link
          to={insteadTo}
          className="self-start inline-flex items-center gap-1 text-[11px] font-semibold text-primary print:hidden"
        >
          {insteadLabel}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : null}
    </Card>
  )
}

/** The card's own geometry, greyed — so nothing moves when the figure lands. */
export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <Card aria-hidden padding="sm" className={cx(SHELL, className)}>
      <div className={HEAD}>
        <span className={cx('skeleton', ICON_TILE_SIZE.sm)} />
      </div>
      <div className="min-w-0">
        <p className={LABEL}>
          <span className={cx(BAR, 'w-16')}>&nbsp;</span>
        </p>
        <p className={VALUE}>
          <span className={cx(BAR, 'w-20')}>&nbsp;</span>
        </p>
      </div>
      <div className={FOOT}>
        <span className={cx(BAR, 'w-12')}>&nbsp;</span>
      </div>
    </Card>
  )
}

export default MetricCard
