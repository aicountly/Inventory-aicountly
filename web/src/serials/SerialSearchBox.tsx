import { forwardRef, useEffect, useRef, useState } from 'react'
import { ScanLine, Search, X } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { cx } from '../ui/cx'

/**
 * The workspace's search box — typing and scanning in one control.
 *
 * Two input speeds, one field:
 *
 *  - a PERSON types three characters and pauses, so the value is debounced and
 *    the request goes out once rather than once per keystroke;
 *  - a SCANNER types the whole code in a few milliseconds and ends with Enter,
 *    so Enter searches immediately and skips the wait. A hardware barcode
 *    scanner is a keyboard as far as the browser is concerned, which is what
 *    makes this the whole of "scanner support" on a desktop.
 *
 * `onScanSubmit` also fires on Enter, so the page can jump straight into the
 * one serial that matched instead of leaving the operator to click it.
 */
export interface SerialSearchBoxProps {
  value: string
  onChange: (value: string) => void
  /** Enter, or a scanner's terminator: search now, and open a unique hit. */
  onSubmit?: (value: string) => void
  /** Opens the camera / manual scan dialog. */
  onScan?: () => void
  placeholder?: string
  delayMs?: number
  className?: string
}

export const SerialSearchBox = forwardRef<HTMLInputElement, SerialSearchBoxProps>(function SerialSearchBox(
  { value, onChange, onSubmit, onScan, placeholder = 'Search serial number, item, SKU, barcode…', delayMs = 300, className },
  ref,
) {
  const [draft, setDraft] = useState(value)
  const debounced = useDebounce(draft, delayMs)
  const committed = useRef(value)

  // An external reset (Clear filters, a chip removed) flows back into the box.
  useEffect(() => {
    setDraft(value)
    committed.current = value
  }, [value])

  useEffect(() => {
    if (debounced === committed.current) return
    committed.current = debounced
    onChange(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on the debounced value
  }, [debounced])

  return (
    <form
      role="search"
      className={cx('relative flex min-w-0 items-center', className)}
      onSubmit={(e) => {
        e.preventDefault()
        const now = draft.trim()
        committed.current = now
        onChange(now)
        onSubmit?.(now)
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label="Search serial numbers"
        className={cx(
          'block h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 text-sm text-gray-900 transition-colors placeholder:text-gray-400',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
          onScan ? 'pr-16' : 'pr-8',
        )}
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft('')
            committed.current = ''
            onChange('')
          }}
          className={cx(
            'absolute top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600',
            onScan ? 'right-10' : 'right-2',
          )}
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onScan ? (
        <button
          type="button"
          onClick={onScan}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md bg-sky-50 text-sky-600 transition-colors hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-label="Scan a barcode"
          title="Scan a barcode"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </form>
  )
})

export default SerialSearchBox
