import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from './Badge'
import type { BadgeTone } from './Badge'
import { Card } from './Card'
import { ICON_TILE_SIZE, IconTile } from './IconTile'
import type { IconTone } from './IconTile'
import { cx } from './cx'

function pctChange(current?: number | null, previous?: number | null): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null
  if (current == null || !Number.isFinite(current)) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function formatPct(p: number): string {
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`
}

export interface StatCardProps {
  label: string
  value: ReactNode
  icon?: LucideIcon
  tone?: IconTone
  /** Current period figure — only used to compute the delta chip. */
  current?: number | null
  /**
   * Previous period figure. Omit it and NO delta chip renders: that is the
   * designed fallback for an endpoint that does not send comparatives yet.
   * Never pass a guess here.
   */
  previous?: number | null
  hint?: ReactNode
  badge?: { label: string; tone?: BadgeTone }
  /** For metrics where down is good (ageing, expiries, failures). */
  invertDelta?: boolean
  /** Renders a negative value in red (negative stock, shortfalls). */
  emphasizeNegative?: boolean
  /** Makes the whole card a link — the drill-down contract. */
  to?: string
  /**
   * One extra row under the delta — a progress bar, a share, a second figure.
   *
   * Optional and unstyled on purpose: it is for a card that genuinely has a
   * fourth thing to say (22 of 24 brands are active), not a slot to be filled
   * on every card because it exists. Cards with and without it keep the same
   * top three rows, so a strip of them still lines up.
   */
  footer?: ReactNode
  /**
   * `stacked` (the default) is the dashboard tile: tile on top, then the label
   * and the figure. `metric` puts the tile beside them, which reads better in a
   * row of four wide cards over a table — the eye runs down one column of
   * figures instead of stepping around four icons.
   */
  layout?: 'stacked' | 'metric'
  /** Fixed decorative bars in the corner. See CardOrnament — not a chart. */
  ornament?: boolean
  className?: string
}

/*
 * The four class strings that set the card's height. They are shared with
 * StatCardSkeleton below, which is the only way the placeholder and the card
 * can be guaranteed the same size.
 */
const SHELL_CLASS = 'flex flex-col gap-2 min-w-[160px]'
const METRIC_SHELL_CLASS = 'flex flex-row items-start gap-3 min-w-[160px] min-h-[92px]'
const HEAD_ROW_CLASS = 'flex items-start justify-between gap-2'
const LABEL_CLASS = 'text-[11px] font-medium text-gray-500 uppercase tracking-wide truncate'
const VALUE_CLASS = 'mt-0.5 text-lg font-semibold tabular-nums truncate'
const METRIC_VALUE_CLASS = 'mt-1 text-2xl leading-none font-semibold tabular-nums truncate'
const DELTA_ROW_CLASS = 'flex items-center gap-1.5 text-[11px] text-gray-500 min-h-[16px]'
const METRIC_DELTA_ROW_CLASS = 'mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500 min-h-[16px]'
/** A line of shimmer that occupies exactly one line box of the text it replaces. */
const BAR_CLASS = 'skeleton inline-block rounded text-transparent'

/** The ornament's tint, matched to the card's own icon tile. */
const ORNAMENT_TONE: Record<IconTone, string> = {
  primary: 'text-primary',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
  info: 'text-sky-600',
  violet: 'text-violet-600',
  slate: 'text-slate-600',
  rose: 'text-rose-600',
  teal: 'text-teal-600',
}

/**
 * Four bars in the card's bottom-right corner.
 *
 * DECORATION, and deliberately fixed: these heights are hard-coded and mean
 * nothing. Inventory sends no series behind a stock bucket, and drawing one
 * from the rows on screen would put a trend on a manager's card that no server
 * ever computed — the same reason LiveDataBadge's sparkline is a constant path.
 * It is `aria-hidden`, it sits under the figure at low opacity, and it must
 * never be swapped for something data-shaped without a real series to plot.
 */
function CardOrnament({ tone }: { tone: IconTone }) {
  return (
    <svg
      viewBox="0 0 46 24"
      className={cx(
        'pointer-events-none absolute bottom-3 right-3 h-6 w-12 opacity-[0.14]',
        ORNAMENT_TONE[tone],
      )}
      aria-hidden
      focusable="false"
    >
      {[
        { x: 0, h: 11 },
        { x: 12, h: 18 },
        { x: 24, h: 13 },
        { x: 36, h: 22 },
      ].map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={24 - bar.h}
          width="6"
          height={bar.h}
          rx="2"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

/**
 * The clickable KPI card. Ported from Books so a figure means the same thing
 * in both products: tile, label, value, and either a real delta or a hint.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  current,
  previous,
  hint,
  badge,
  invertDelta = false,
  emphasizeNegative = false,
  to,
  footer,
  layout = 'stacked',
  ornament = false,
  className,
}: StatCardProps) {
  const pct = pctChange(current, previous)
  const flat = pct != null && Math.abs(pct) < 0.05
  const positive = pct == null ? null : invertDelta ? pct < 0 : pct > 0

  let deltaCls = 'text-gray-400'
  let DeltaIcon = Minus
  if (pct != null && !flat) {
    if (positive) {
      deltaCls = 'text-emerald-600'
      DeltaIcon = ArrowUpRight
    } else {
      deltaCls = 'text-red-600'
      DeltaIcon = ArrowDownRight
    }
  }

  const valueClass =
    emphasizeNegative && typeof current === 'number' && current < 0
      ? 'text-red-600'
      : 'text-gray-900'

  /*
   * Decoration yields to content.
   *
   * The ornament is pinned to the card's bottom-right corner, which is
   * exactly where `footer` renders. A card carrying both would draw bars
   * behind a real control — so a card with a footer simply does not get them.
   * Nothing is lost: the bars mean nothing by design.
   */
  const showOrnament = ornament && !footer

  const delta = (
    <>
      {pct != null ? (
        <>
          <span className={cx('inline-flex items-center gap-0.5 font-semibold', deltaCls)}>
            <DeltaIcon className="w-3 h-3" aria-hidden />
            {flat ? '0.0%' : formatPct(pct)}
          </span>
          <span className="text-gray-400 truncate">{hint ?? 'vs previous period'}</span>
        </>
      ) : (
        <span className="text-gray-400 truncate">{hint ?? '—'}</span>
      )}
    </>
  )

  if (layout === 'metric') {
    return (
      <Card
        as={to ? Link : 'div'}
        to={to}
        aria-label={to ? `Open ${label}` : undefined}
        padding="sm"
        interactive={Boolean(to)}
        className={cx(METRIC_SHELL_CLASS, showOrnament && 'relative overflow-hidden', className)}
      >
        {showOrnament ? <CardOrnament tone={tone} /> : null}
        <IconTile icon={icon} tone={tone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={LABEL_CLASS}>{label}</p>
            {badge ? (
              <Badge tone={badge.tone ?? 'success'} size="xs">
                {badge.label}
              </Badge>
            ) : null}
          </div>
          <p className={cx(METRIC_VALUE_CLASS, valueClass)}>{value}</p>
          {/* The hint truncates against the card edge, which would run it
              under the ornament. Reserve the corner the bars occupy. */}
          <div className={cx(METRIC_DELTA_ROW_CLASS, showOrnament && 'pr-12')}>{delta}</div>
          {footer ? <div className="mt-2">{footer}</div> : null}
        </div>
      </Card>
    )
  }

  return (
    <Card
      as={to ? Link : 'div'}
      to={to}
      aria-label={to ? `Open ${label}` : undefined}
      padding="sm"
      interactive={Boolean(to)}
      className={cx(SHELL_CLASS, className)}
    >
      <div className={HEAD_ROW_CLASS}>
        <IconTile icon={icon} tone={tone} size="sm" />
        {badge ? (
          <Badge tone={badge.tone ?? 'success'} size="xs">
            {badge.label}
          </Badge>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className={LABEL_CLASS}>
          {label}
        </p>
        <p className={cx(VALUE_CLASS, valueClass)}>
          {value}
        </p>
      </div>
      <div className={DELTA_ROW_CLASS}>{delta}</div>
      {footer ? <div>{footer}</div> : null}
    </Card>
  )
}

/**
 * The card's own geometry, greyed out.
 *
 * A hand-measured `h-[104px]` cannot track the card it stands in for: it was
 * measured at one root font size, against one type scale, and every later
 * padding change makes the strip jump again on load. This renders the same
 * shell, the same three rows and the same line boxes with the text made
 * transparent, so the placeholder is exactly as tall as what replaces it.
 */
export function StatCardSkeleton({
  layout = 'stacked',
  className,
}: {
  layout?: 'stacked' | 'metric'
  className?: string
}) {
  if (layout === 'metric') {
    return (
      <Card aria-hidden padding="sm" className={cx(METRIC_SHELL_CLASS, className)}>
        <span className={cx('skeleton', ICON_TILE_SIZE.lg)} />
        <div className="min-w-0 flex-1">
          <p className={LABEL_CLASS}>
            <span className={cx(BAR_CLASS, 'w-16')}>&nbsp;</span>
          </p>
          <p className={METRIC_VALUE_CLASS}>
            <span className={cx(BAR_CLASS, 'w-20')}>&nbsp;</span>
          </p>
          <div className={METRIC_DELTA_ROW_CLASS}>
            <span className={cx(BAR_CLASS, 'w-12')}>&nbsp;</span>
          </div>
        </div>
      </Card>
    )
  }
  return (
    <Card aria-hidden padding="sm" className={cx(SHELL_CLASS, className)}>
      <div className={HEAD_ROW_CLASS}>
        <span className={cx('skeleton', ICON_TILE_SIZE.sm)} />
      </div>
      <div className="min-w-0">
        <p className={LABEL_CLASS}>
          <span className={cx(BAR_CLASS, 'w-16')}>&nbsp;</span>
        </p>
        <p className={VALUE_CLASS}>
          <span className={cx(BAR_CLASS, 'w-20')}>&nbsp;</span>
        </p>
      </div>
      <div className={DELTA_ROW_CLASS}>
        <span className={cx(BAR_CLASS, 'w-12')}>&nbsp;</span>
      </div>
    </Card>
  )
}

export default StatCard
