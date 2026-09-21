import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Package, RotateCw, X } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'
import { Badge } from '../../ui/Badge'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../../ui/Input'
import { AIC, cx } from '../../ui/cx'

interface ItemSearchSelectProps {
  itemId: number | null
  itemName: string
  itemSku: string | null
  /** Availability in the dropdown is scoped to the warehouse the line will post to. */
  warehouseId: number | null
  onPick: (row: ItemSearchRow) => void
  onClear: () => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
}

/**
 * Item typeahead for one grid row.
 *
 * `GET /v1/items/search?with_stock=1&warehouse_id=` so every suggestion already
 * shows what is on hand where this line will post — the single most common
 * reason someone abandons a line half-typed is finding out afterwards that the
 * stock is not there.
 *
 * Debounced at 300ms with the in-flight request aborted on every keystroke, so
 * fast typing costs one request, not one per character, and a slow response can
 * never overwrite a newer one.
 *
 * The result list is portalled to `document.body` and positioned against the
 * viewport. It has to be: the grid scrolls sideways inside `overflow-x-auto`,
 * which clips on BOTH axes, so a list positioned inside that box would be cut
 * off at the row — the last row's suggestions would be unreachable entirely.
 */
export function ItemSearchSelect({ itemId, itemName, itemSku, warehouseId, onPick, onClear, disabled, invalid, autoFocus }: ItemSearchSelectProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const debounced = useDebounce(query, 300)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const listId = useId()

  const GAP = 4
  const MARGIN = 8
  const MAX_HEIGHT = 320

  const place = useCallback(() => {
    const anchor = inputRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.max(rect.width, 288)
    const height = Math.min(listRef.current?.offsetHeight ?? MAX_HEIGHT, MAX_HEIGHT)
    const below = window.innerHeight - rect.bottom >= height + GAP + MARGIN
    setBox({
      top: below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - height - GAP),
      left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN)),
      width,
    })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, rows, loading, error])

  useEffect(() => {
    if (!open) {
      setBox(null)
      return undefined
    }
    const reposition = () => place()
    window.addEventListener('resize', reposition)
    // Capture: the grid's own scroll container never bubbles a scroll event.
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 20, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError(errorMessage(err, 'Could not search items.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open, warehouseId, attempt])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (rootRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (row: ItemSearchRow) => {
    onPick(row)
    setOpen(false)
    setQuery('')
  }

  if (itemId !== null) {
    return (
      <div className={cx(AIC, 'flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50/60 px-2 py-1')}>
        <Package className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-gray-900">{itemName || `Item #${itemId}`}</span>
          {itemSku ? <span className="block truncate text-[10px] text-gray-500">{itemSku}</span> : null}
        </span>
        {!disabled ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Change item ${itemName || itemId}`}
            title="Change item"
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search item"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        className={cx(FIELD_BASE, invalid ? FIELD_INVALID : FIELD_OK, 'h-8 px-2 text-xs')}
        placeholder="Search item by name, SKU or barcode..."
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === 'ArrowDown') setOpen(true)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(rows.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && rows[active]) {
            e.preventDefault()
            pick(rows[active])
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {loading ? (
        <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" aria-hidden />
      ) : null}

      {open
        ? createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Item search results"
          className="fixed z-[80] max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay print:hidden"
          style={box ? { top: box.top, left: box.left, width: box.width } : { top: -9999, left: -9999, width: 288 }}
        >
          {error ? (
            <li className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs text-red-600">{error}</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setAttempt((a) => a + 1)
                }}
              >
                <RotateCw className="h-3 w-3" aria-hidden /> Retry
              </button>
            </li>
          ) : null}
          {!error && rows.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">
              {loading ? 'Searching…' : query.trim() ? `No item matches “${query.trim()}”.` : 'Type a name, SKU or barcode.'}
            </li>
          ) : null}
          {rows.map((row, i) => (
            <li key={row.item_id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(row)
                }}
                className={cx(
                  'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors',
                  i === active ? 'bg-primary-light/60' : 'hover:bg-gray-50',
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900">
                    {row.print_name || row.item_name}
                  </span>
                  {Number(row.track_batch) === 1 ? <Badge size="xs" tone="info">Batch</Badge> : null}
                  {Number(row.track_serial) === 1 ? <Badge size="xs" tone="violet">Serial</Badge> : null}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-gray-500">
                  {row.item_sku ? <span className="font-mono">{row.item_sku}</span> : null}
                  {row.unit_symbol ? <span>{row.unit_symbol}</span> : null}
                  {row.stock ? (
                    <span className={cx('font-semibold', row.stock.available > 0 ? 'text-emerald-700' : 'text-red-600')}>
                      {formatQty(row.stock.available)} available
                      {warehouseId ? '' : ' (all warehouses)'}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>,
        document.body,
          )
        : null}
    </div>
  )
}
