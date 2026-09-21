import { AlertTriangle } from 'lucide-react'
import type { AvailabilityCheckResult } from '../../services/stockApi'
import { shortBy } from '../../services/stockApi'
import { formatQty } from '../../utils/format'
import { AIC, cx } from '../../ui/cx'

export type StockTone = 'ok' | 'tight' | 'short' | 'unknown'

/** At or above this share of what is available, a line is worth flagging amber. */
const TIGHT_RATIO = 0.8

export function stockTone(result: AvailabilityCheckResult | undefined): StockTone {
  if (!result) return 'unknown'
  if (!result.ok) return 'short'
  if (result.available > 0 && result.requested >= result.available * TIGHT_RATIO) return 'tight'
  return 'ok'
}

const TONE_CLS: Record<StockTone, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  tight: 'bg-amber-50 text-amber-700 border-amber-200',
  short: 'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-gray-50 text-gray-400 border-gray-200',
}

const TONE_WORD: Record<StockTone, string> = {
  ok: 'in stock',
  tight: 'tight',
  short: 'short',
  unknown: 'not checked',
}

export interface StockChipProps {
  result: AvailabilityCheckResult | undefined
  /** True while the debounced availability request for this line is in flight. */
  checking?: boolean
  /** Hides the chip entirely for a line that is not taking stock out yet. */
  idle?: boolean
}

/**
 * What is available where this line posts, and what is left after it.
 *
 * Colour is never the only carrier: the figure is the number itself, the state
 * is in the title and in screen-reader text, and a short line adds the warning
 * triangle. A reader who cannot tell emerald from amber still reads "short by
 * 3".
 */
export function StockChip({ result, checking = false, idle = false }: StockChipProps) {
  if (idle) return <span className="text-xs text-gray-300">—</span>
  if (!result) {
    return (
      <span className={cx(AIC, 'text-xs text-gray-400 tabular-nums')}>
        {checking ? 'checking…' : '—'}
      </span>
    )
  }

  const tone = stockTone(result)
  const after = result.available - result.requested
  const short = shortBy(result)
  const title = tone === 'short'
    ? `Available ${formatQty(result.available)}, requested ${formatQty(result.requested)} — short by ${formatQty(short)}`
    : `Available ${formatQty(result.available)}, ${formatQty(after)} left after this issue`

  return (
    <span className={cx(AIC, 'inline-flex flex-col items-start gap-0.5 leading-tight')} title={title}>
      <span
        className={cx(
          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-bold tabular-nums',
          TONE_CLS[tone],
        )}
      >
        {tone === 'short' ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> : null}
        {formatQty(result.available)}
        <span className="sr-only"> available, {TONE_WORD[tone]}</span>
      </span>
      {tone === 'short' ? (
        <span className="text-[10px] font-medium text-red-600 tabular-nums">short {formatQty(short)}</span>
      ) : result.requested > 0 ? (
        <span className="text-[10px] text-gray-500 tabular-nums">{formatQty(after)} after</span>
      ) : null}
    </span>
  )
}

export default StockChip
