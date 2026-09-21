import { useEffect, useId, useRef, useState } from 'react'
import { Barcode, Layers, Search, Tag } from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { AIC, cx } from '../../ui/cx'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { formatQty } from '../../utils/format'

export interface GrnItemPickerProps {
  /** Availability in the dropdown is scoped to this warehouse when set. */
  warehouseId: number | null
  onPick: (row: ItemSearchRow) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  invalid?: boolean
  /** Rendered flush inside a table cell rather than as a bordered field. */
  bare?: boolean
  onEscape?: () => void
}

/**
 * Item typeahead for a receiving line.
 *
 * `GET /v1/items/search?with_stock=1&warehouse_id=` — the same endpoint the other document
 * editors use, so a barcode, an alias and a SKU all find the same item here as anywhere else.
 * What it adds is the receiving detail: the batch / serial flags are on the suggestion, because
 * knowing an item is serialised BEFORE choosing it is what stops a clerk entering 100 units and
 * then discovering they owe 100 serial numbers.
 *
 * An exact barcode match is committed on Enter without waiting for the list, which is how a
 * hardware scanner behaves — it types the code and presses Enter faster than any debounce.
 */
export function GrnItemPicker({
  warehouseId,
  onPick,
  placeholder = 'Search by name, SKU, barcode or scan…',
  autoFocus,
  disabled,
  invalid,
  bare = false,
  onEscape,
}: GrnItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(query, 300)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: 15, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open, warehouseId])

  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const commit = (row: ItemSearchRow) => {
    onPick(row)
    setOpen(false)
    setQuery('')
    setRows([])
  }

  const enter = async () => {
    const highlighted = rows[active]
    if (highlighted) {
      commit(highlighted)
      return
    }
    const code = query.trim()
    if (!code) return
    // The list has not caught up (a scanner is faster than the debounce): ask by barcode.
    const scanned = await lookupApi.itemByBarcode(code, { warehouseId }).catch(() => null)
    if (scanned) commit(scanned)
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <div
        className={cx(
          'flex items-center gap-1.5',
          bare
            ? 'h-8 rounded-md border border-transparent px-1.5 focus-within:border-gray-200 focus-within:bg-white'
            : cx('h-8 rounded-lg border bg-white px-2 focus-within:ring-2 focus-within:ring-primary/30', invalid ? 'border-red-300' : 'border-gray-200'),
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        <input
          type="text"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(rows.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              void enter()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              if (open) setOpen(false)
              else onEscape?.()
            }
          }}
        />
        {loading ? <Spinner size="xs" /> : null}
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Items"
          className="absolute left-0 z-30 mt-1 max-h-72 w-[min(30rem,80vw)] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-3 text-xs text-gray-500">{loading ? 'Searching…' : 'No items found. Check the code, or add the item in Masters first.'}</li>
          ) : null}
          {rows.map((row, i) => (
            <li key={row.item_id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cx('flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors', i === active ? 'bg-primary-light' : 'hover:bg-gray-50')}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(row)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900">{row.print_name || row.item_name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                    {row.item_sku ? (
                      <span className="inline-flex items-center gap-1">
                        <Tag className="h-3 w-3" aria-hidden />
                        {row.item_sku}
                      </span>
                    ) : null}
                    {row.item_upc ? (
                      <span className="inline-flex items-center gap-1">
                        <Barcode className="h-3 w-3" aria-hidden />
                        {row.item_upc}
                      </span>
                    ) : null}
                    {Number(row.track_batch) === 1 ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Layers className="h-3 w-3" aria-hidden />
                        batch
                      </span>
                    ) : null}
                    {Number(row.track_serial) === 1 ? <span className="text-violet-700">serial</span> : null}
                  </span>
                </span>
                {row.stock ? (
                  <span className="shrink-0 text-right text-[11px] tabular-nums text-gray-500">
                    <span className="block">on hand {formatQty(row.stock.on_hand)}</span>
                    <span className="block">{warehouseId ? 'here' : 'all warehouses'}</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default GrnItemPicker
