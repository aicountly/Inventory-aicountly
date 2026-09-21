import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Boxes, Layers, Loader2, Search, X } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../../ui/Input'
import { formatQty } from '../../utils/format'

export interface ReceiptItemPickerProps {
  itemId: number | null
  itemName: string
  itemSku: string | null
  /** Stock in the dropdown is what is on hand HERE, where the line will post. */
  warehouseId: number | null
  onPick: (row: ItemSearchRow) => void
  onClear: () => void
  disabled?: boolean
  invalid?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
}

const LIMIT = 12

/**
 * The item cell of the receipt grid.
 *
 * A typeahead rather than a select, and one that answers the question a
 * storekeeper actually has at the moment of choosing: not "which of my 4,000
 * items is this" but "is this the one, and how much of it is already here".
 * Every suggestion therefore carries the SKU, the unit, what is on hand in the
 * warehouse this line posts to, and whether the item is batch or serial
 * tracked — the three things that decide what else the row will ask for.
 *
 * `GET /v1/items/search?with_stock=1&warehouse_id=` — live, debounced, and the
 * previous request is aborted, so the list never flickers back to a stale
 * answer.
 */
export function ReceiptItemPicker({
  itemId,
  itemName,
  itemSku,
  warehouseId,
  onPick,
  onClear,
  disabled,
  invalid,
  inputRef,
}: ReceiptItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit: LIMIT, signal: controller.signal })
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
    const onDocumentMouseDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [open])

  const pick = (row: ItemSearchRow) => {
    onPick(row)
    setOpen(false)
    setQuery('')
  }

  if (itemId !== null) {
    return (
      <div className={cx(AIC, 'flex items-center gap-2 min-w-0')}>
        <span className="w-8 h-8 shrink-0 rounded-lg bg-primary-light grid place-items-center" aria-hidden>
          <Boxes className="w-4 h-4 text-primary" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-sm font-medium text-gray-900 truncate">{itemName || `Item #${itemId}`}</span>
          {itemSku ? <span className="block text-[11px] text-gray-500 truncate">{itemSku}</span> : null}
        </span>
        {!disabled ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Change item ${itemName}`}
            className="ml-auto shrink-0 w-7 h-7 grid place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search name, SKU or barcode…"
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Item"
        aria-invalid={invalid || undefined}
        className={cx(FIELD_BASE, invalid ? FIELD_INVALID : FIELD_OK, 'h-9 text-sm pl-8 pr-3')}
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
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching items"
          className="absolute z-30 left-0 top-full mt-1 w-[min(26rem,80vw)] max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-overlay py-1"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-3 text-xs text-gray-500 flex items-center gap-2">
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Searching…
                </>
              ) : (
                'No item matches that. Check the spelling, or the item may not exist yet.'
              )}
            </li>
          ) : null}
          {rows.map((row, i) => (
            <li
              key={row.item_id}
              role="option"
              aria-selected={i === active}
              className={cx(
                'px-3 py-2 cursor-pointer border-l-2',
                i === active ? 'bg-primary-light border-primary' : 'border-transparent',
              )}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(row)
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">{row.print_name || row.item_name}</span>
                {row.stock ? (
                  <span className="text-[11px] tabular-nums text-gray-600 shrink-0">
                    {formatQty(row.stock.available)} avail
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-500 mt-0.5">
                {row.item_sku ? <span className="font-medium">{row.item_sku}</span> : null}
                {row.unit_symbol ? <span>· {row.unit_symbol}</span> : null}
                {row.stock ? <span>· on hand {formatQty(row.stock.on_hand)}{warehouseId ? '' : ' (all warehouses)'}</span> : null}
                {Number(row.track_batch) === 1 ? (
                  <span className="inline-flex items-center gap-0.5 rounded px-1 bg-sky-50 text-sky-700 font-medium">
                    <Layers className="w-3 h-3" aria-hidden /> batch
                  </span>
                ) : null}
                {Number(row.track_serial) === 1 ? (
                  <span className="rounded px-1 bg-violet-50 text-violet-700 font-medium">serial</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default ReceiptItemPicker
