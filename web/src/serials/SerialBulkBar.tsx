import { MapPin, Printer, ShieldCheck, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { formatInt } from '../utils/format'

/**
 * The bar that appears when rows are ticked.
 *
 * It states the count in words before it offers anything, because every action
 * on it applies to a set the reader assembled across pages and cannot see all
 * of at once. `aria-live` announces the count as it changes, so a keyboard user
 * ticking rows hears the selection grow.
 */
export interface SerialBulkBarProps {
  count: number
  onClear: () => void
  onPrintLabels: () => void
  onMove: () => void
  onWarranty: () => void
  canWrite: boolean
  className?: string
}

export function SerialBulkBar({
  count,
  onClear,
  onPrintLabels,
  onMove,
  onWarranty,
  canWrite,
  className,
}: SerialBulkBarProps) {
  if (count === 0) return null
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-2 border-t border-primary/20 bg-primary-light/50 px-3 py-2',
        className,
      )}
    >
      <span className="text-xs font-semibold text-gray-800" aria-live="polite">
        {formatInt(count)} serial number{count === 1 ? '' : 's'} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="xs" icon={Printer} onClick={onPrintLabels}>
          Print labels
        </Button>
        {canWrite ? (
          <>
            <Button variant="secondary" size="xs" icon={MapPin} onClick={onMove}>
              Change location
            </Button>
            <Button variant="secondary" size="xs" icon={ShieldCheck} onClick={onWarranty}>
              Update warranty
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="xs" icon={X} onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  )
}

export default SerialBulkBar
