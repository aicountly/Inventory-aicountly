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
   * `lg` is the register treatment: a taller card with a larger figure, for a
   * strip of five that is the first thing read on the page. The dashboard keeps
   * `sm`, where a KPI sits among charts and tables and must not shout over
   * them. Default stays `sm` so no existing caller moves.
   */
  size?: 'sm' | 'lg'
  className?: string
}

/*
 * The four class strings that set the card's height. They are shared with
 * StatCardSkeleton below, which is the only way the placeholder and the card
 * can be guaranteed the same size.
 */
const SHELL_CLASS = 'flex flex-col gap-2 min-w-[160px]'
const HEAD_ROW_CLASS = 'flex items-start justify-between gap-2'
const LABEL_CLASS = 'text-[11px] font-medium text-gray-500 uppercase tracking-wide truncate'
const VALUE_CLASS = 'mt-0.5 text-lg font-semibold tabular-nums truncate'
const DELTA_ROW_CLASS = 'flex items-center gap-1.5 text-[11px] text-gray-500 min-h-[16px]'

/* The `lg` counterparts. Kept as constants beside the originals for the same
   reason: StatCardSkeleton has to reserve exactly the box the card will fill. */
/*
 * A plain surface, not a gradient, deliberately.
 *
 * theme/dark-overrides.css repaints `.dark .bg-white`, but a gradient sets
 * `--tw-gradient-from` instead, which nothing in that sheet can reach — the
 * cards stayed white on black in dark mode while every surface around them
 * turned. Card's own `bg-white` IS remapped, so the plain surface is the one
 * that follows the theme. darkAccents.test.tsx holds this.
 */
const SHELL_LG_CLASS = 'relative flex flex-col gap-2.5 min-w-[150px] overflow-hidden'
const LABEL_LG_CLASS =
  'text-[11px] font-semibold text-gray-500 uppercase tracking-[0.015em] truncate'
const VALUE_LG_CLASS =
  'mt-1 text-[1.6rem] leading-none font-bold tracking-tight tabular-nums truncate'
const DELTA_LG_ROW_CLASS = 'flex items-center gap-1.5 text-[11px] text-gray-400 min-h-[16px]'

/**
 * The faint rotated square in the bottom-right of a large card.
 *
 * Purely ornamental, so it is `aria-hidden` and sits behind the content. It is
 * the only decoration on the card, and it is kept at ~3% opacity: a KPI strip
 * is read at a glance and anything louder competes with the figure itself.
 */
function CardFlourish() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -bottom-8 -right-6 h-24 w-24 rotate-[25deg] rounded-[2rem] bg-primary/[0.03]"
    />
  )
}
/** A line of shimmer that occupies exactly one line box of the text it replaces. */
const BAR_CLASS = 'skeleton inline-block rounded text-transparent'

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
  size = 'sm',
  className,
}: StatCardProps) {
  const lg = size === 'lg'
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

  return (
    <Card
      as={to ? Link : 'div'}
      to={to}
      aria-label={to ? `Open ${label}` : undefined}
      padding={lg ? 'md' : 'sm'}
      interactive={Boolean(to)}
      className={cx(lg ? SHELL_LG_CLASS : SHELL_CLASS, className)}
    >
      {lg ? <CardFlourish /> : null}
      <div className={cx(HEAD_ROW_CLASS, lg && 'relative')}>
        <IconTile icon={icon} tone={tone} size={lg ? 'md' : 'sm'} />
        {badge ? (
          <Badge tone={badge.tone ?? 'success'} size="xs">
            {badge.label}
          </Badge>
        ) : null}
      </div>
      <div className={cx('min-w-0', lg && 'relative')}>
        <p className={lg ? LABEL_LG_CLASS : LABEL_CLASS}>
          {label}
        </p>
        <p className={cx(lg ? VALUE_LG_CLASS : VALUE_CLASS, valueClass)}>
          {value}
        </p>
      </div>
      <div className={cx(lg ? DELTA_LG_ROW_CLASS : DELTA_ROW_CLASS, lg && 'relative')}>
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
      </div>
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
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'lg'
  className?: string
}) {
  const lg = size === 'lg'
  return (
    <Card
      aria-hidden
      padding={lg ? 'md' : 'sm'}
      className={cx(lg ? SHELL_LG_CLASS : SHELL_CLASS, className)}
    >
      <div className={HEAD_ROW_CLASS}>
        <span className={cx('skeleton', lg ? ICON_TILE_SIZE.md : ICON_TILE_SIZE.sm)} />
      </div>
      <div className="min-w-0">
        <p className={lg ? LABEL_LG_CLASS : LABEL_CLASS}>
          <span className={cx(BAR_CLASS, 'w-16')}>&nbsp;</span>
        </p>
        <p className={lg ? VALUE_LG_CLASS : VALUE_CLASS}>
          <span className={cx(BAR_CLASS, 'w-20')}>&nbsp;</span>
        </p>
      </div>
      <div className={lg ? DELTA_LG_ROW_CLASS : DELTA_ROW_CLASS}>
        <span className={cx(BAR_CLASS, 'w-12')}>&nbsp;</span>
      </div>
    </Card>
  )
}

export default StatCard
