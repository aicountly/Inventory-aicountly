import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'
import type { Delta } from '../valuationHealth'

/**
 * "↑ 12% vs 19 Aug 2026" under a KPI.
 *
 * Drawn only when there is a real prior figure to compare against — the caller
 * passes `null` and nothing renders. It never guesses a direction from a single
 * reading, and it never prints a percentage when the earlier figure was zero:
 * "up from nothing" is a direction, not a rate, and `Infinity%` on a finance
 * card is worse than no chip at all.
 *
 * `goodWhen` exists because more is not always better. More stock value may be
 * healthy growth; more slow-moving items never is. The caller says which way
 * good points and the colour follows, so green never quietly congratulates
 * someone on a rising problem.
 */
export interface DeltaChipProps {
  delta: Delta | null
  /** The date the earlier figure was read at. */
  comparedTo: string | null
  /** Which direction is an improvement. 'none' keeps the chip neutral. */
  goodWhen?: 'up' | 'down' | 'none'
  className?: string
}

const ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus }

export function DeltaChip({ delta, comparedTo, goodWhen = 'none', className }: DeltaChipProps) {
  if (!delta) return null
  const Icon = ICON[delta.direction]

  const tone =
    delta.direction === 'flat' || goodWhen === 'none'
      ? 'text-gray-500'
      : delta.direction === goodWhen
        ? 'text-emerald-600'
        : 'text-red-600'

  const magnitude =
    delta.percent === null
      ? delta.direction === 'flat'
        ? 'No change'
        : delta.direction === 'up'
          ? 'Up from nil'
          : 'Down to nil'
      : `${Math.abs(delta.percent).toFixed(delta.percent !== 0 && Math.abs(delta.percent) < 10 ? 1 : 0)}%`

  return (
    <span className={cx('inline-flex items-center gap-0.5 font-medium', tone, className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">
        {magnitude}
        {comparedTo ? <span className="text-gray-400"> vs {formatDate(comparedTo)}</span> : null}
      </span>
    </span>
  )
}

export default DeltaChip
