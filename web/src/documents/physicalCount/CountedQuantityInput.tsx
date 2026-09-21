import { memo, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { cx } from '../../ui/cx'

/**
 * The one cell an operator actually types in.
 *
 * Counting is the highest-frequency act on this screen — a thousand rows, one
 * figure each — so the cell is built for a keyboard and a scanner gun, not a
 * mouse:
 *
 *  - Enter commits and drops to the SAME column of the next row, which is how
 *    every stock-count sheet on paper is worked down.
 *  - Arrow Up / Down move between rows. The control is a text input with
 *    `inputMode="decimal"` rather than `type="number"` precisely so those keys
 *    are free: on a number input they would silently increment the quantity,
 *    and a count that changes because somebody scrolled is a wrong count.
 *  - Tab is left alone. It is the browser's, and taking it would break every
 *    assistive technology that relies on it.
 *
 * Navigation walks the DOM inside the table rather than lifting a focus index
 * into React state: re-rendering a thousand rows to move a cursor is the one
 * thing this screen cannot afford, and the inputs are already in document
 * order.
 */

export interface CountedQuantityInputProps {
  value: string
  onChange: (next: string) => void
  /** Reveals the row the insight rail or the scanner pointed at. */
  highlighted?: boolean
  invalid?: boolean
  disabled?: boolean
  ariaLabel: string
  /** Book quantity, announced with the field so the figure has a reference. */
  describedBy?: string
}

const SELECTOR = 'input[data-count-qty="1"]:not([disabled])'

function moveFocus(from: HTMLInputElement, delta: number): void {
  const scope = from.closest('table') ?? document
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>(SELECTOR))
  const at = inputs.indexOf(from)
  if (at === -1) return
  const next = inputs[at + delta]
  if (!next) return
  next.focus()
  next.select()
}

export const CountedQuantityInput = memo(function CountedQuantityInput({
  value,
  onChange,
  highlighted = false,
  invalid = false,
  disabled = false,
  ariaLabel,
  describedBy,
}: CountedQuantityInputProps) {
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      moveFocus(e.currentTarget, 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(e.currentTarget, 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(e.currentTarget, -1)
    }
  }, [])

  return (
    <input
      data-count-qty="1"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cx(
        'h-7 w-[4.5rem] rounded-md border bg-white px-2 text-right text-xs tabular-nums text-gray-900 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
        invalid ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-primary',
        highlighted && 'ring-2 ring-primary/40',
        disabled && 'bg-gray-50 text-gray-500',
      )}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
    />
  )
})

export default CountedQuantityInput
