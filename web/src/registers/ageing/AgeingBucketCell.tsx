import { AGE_BUCKET_TEXT } from './ageingModel'
import { cx } from '../../ui/cx'
import { formatMoney, formatQty } from '../../utils/format'
import type { AgeBucket, AgeBucketKey } from '../../services/reportsApi'

/**
 * One ageing band for one row: the quantity, and the money it is holding.
 *
 * Two lines in one column rather than ten columns across the table. At five bands a
 * separate qty and value column each meant the reader scanned ten numbers to answer
 * "where is this item's stock sitting", and the pair that belongs together was always
 * a column apart. Both figures are still exported and still sortable — the quantity
 * keeps its own column in the configurator, hidden by default.
 *
 * A band holding nothing draws a dash, not a zero: five zeroes across a row is noise
 * the eye has to filter out before it can find the band that matters.
 */
export function AgeingBucketCell({ bucket, value }: { bucket: AgeBucketKey; value?: AgeBucket }) {
  const qty = Number(value?.qty ?? 0)
  const amount = Number(value?.value ?? 0)
  if (qty === 0 && amount === 0) return <span className="text-gray-300">—</span>
  return (
    <span className="block leading-tight">
      <strong className="block text-xs font-semibold tabular-nums text-gray-900">
        {formatQty(qty)}
      </strong>
      <small className={cx('block text-[10px] tabular-nums', AGE_BUCKET_TEXT[bucket])}>
        {formatMoney(amount)}
      </small>
    </span>
  )
}

/** Two-line column header: the band, and what the two lines under it are. */
export function AgeingBucketHeader({ label }: { label: string }) {
  return (
    <span className="block leading-tight">
      {label}
      <small className="mt-0.5 block text-[9px] font-medium normal-case text-gray-400">
        Qty / Value
      </small>
    </span>
  )
}

export default AgeingBucketCell
