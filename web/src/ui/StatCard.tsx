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
      <div className={DELTA_ROW_CLASS}>
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
export function StatCardSkeleton({ className }: { className?: string }) {
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
