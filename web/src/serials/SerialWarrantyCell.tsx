import { cx } from '../ui/cx'
import { formatDate } from '../utils/format'
import { WARRANTY_STATE_LABEL, warrantyPhrase, warrantyState } from './warranty'
import type { WarrantyThresholds } from './warranty'

const TONE_CLASS: Record<string, string> = {
  active: 'text-emerald-600',
  upcoming: 'text-amber-600',
  urgent: 'text-red-600',
  expired: 'text-red-600',
  none: 'text-gray-400',
}

/**
 * The warranty column: the date, and what it means underneath.
 *
 * The state is carried by the WORDS, not only by the colour — "Expires in 21
 * days" reads the same to a reader who cannot tell amber from green, and the
 * `title` spells the state out for the row's tooltip.
 */
export function SerialWarrantyCell({
  until,
  today,
  thresholds,
}: {
  until: string | null | undefined
  today: string
  thresholds: WarrantyThresholds
}) {
  const state = warrantyState(until, today, thresholds)
  if (state === 'none') {
    return <span className="text-[11px] text-gray-300">Not recorded</span>
  }
  const phrase = warrantyPhrase(until, today)
  return (
    <span className="min-w-0" title={WARRANTY_STATE_LABEL[state]}>
      <span className="block whitespace-nowrap text-gray-700">{formatDate(until)}</span>
      {phrase ? (
        <span className={cx('block whitespace-nowrap text-[10px] font-semibold', TONE_CLASS[state])}>{phrase}</span>
      ) : null}
    </span>
  )
}

export default SerialWarrantyCell
