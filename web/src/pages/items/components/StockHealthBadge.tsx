import { AlertTriangle, CheckCircle2, CircleSlash, Minus, TrendingDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatQty } from '../../../utils/format'
import type { ItemListRow } from '../../../services/items'
import { getStockHealth } from '../itemsModel'
import type { StockHealth, StockHealthKey } from '../itemsModel'

/**
 * Colour is never the only signal.
 *
 * Every state carries an icon of its own shape AND a word, because a red figure
 * and a black one are the same figure to a reader with a colour vision
 * deficiency — and identical once the page is printed in mono. The tooltip adds
 * the reason ("on hand 5 is at or below the reorder level of 20"), which is the
 * part a colour could never have carried.
 */
const ICON: Record<StockHealthKey, LucideIcon> = {
  negative: TrendingDown,
  out: CircleSlash,
  low: AlertTriangle,
  healthy: CheckCircle2,
  untracked: Minus,
}

const TEXT: Record<StockHealthKey, string> = {
  negative: 'text-red-600',
  out: 'text-gray-600',
  low: 'text-amber-600',
  healthy: 'text-gray-900',
  untracked: 'text-gray-400',
}

const CHIP: Record<StockHealthKey, string> = {
  negative: 'bg-red-50 text-red-700 border-red-200',
  out: 'bg-gray-100 text-gray-600 border-gray-200',
  low: 'bg-amber-50 text-amber-700 border-amber-200',
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  untracked: 'bg-gray-50 text-gray-500 border-gray-200',
}

/**
 * The On-hand cell: the quantity, with the state's icon when it is not healthy.
 *
 * A healthy row stays plain, so the eye finds the two that are not without
 * having to read fifty that are. The whole row is never tinted — a wall of red
 * makes a page harder to read, not more urgent.
 */
export function StockQuantity({ item }: { item: ItemListRow }) {
  const health = getStockHealth(item)
  const Icon = ICON[health.key]
  const quantity = health.onHand === null ? '—' : formatQty(health.onHand)

  return (
    <Tooltip label={health.hint}>
      <span className={cx('inline-flex items-center justify-end gap-1 font-semibold tabular-nums', TEXT[health.key])}>
        {health.key !== 'healthy' && health.key !== 'untracked' ? (
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : null}
        {quantity}
        {/* The state in words, for a screen reader, never shown twice visually. */}
        <span className="sr-only"> — {health.label}</span>
      </span>
    </Tooltip>
  )
}

export interface StockHealthBadgeProps {
  health: StockHealth
  className?: string
}

/** The state spelled out — used on cards and in the drawer, where there is room. */
export function StockHealthBadge({ health, className }: StockHealthBadgeProps) {
  const Icon = ICON[health.key]
  return (
    <span
      title={health.hint}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        CHIP[health.key],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {health.label}
    </span>
  )
}
