import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { formatQty } from '../utils/format'

interface LineItemPickerProps {
  itemId: number | null
  itemName: string
  itemSku: string | null
  /** Availability in the dropdown is scoped to this warehouse when set. */
  warehouseId: number | null
  onPick: (row: ItemSearchRow) => void
  onClear: () => void
  disabled?: boolean
  autoFocus?: boolean
  invalid?: boolean
  /**
   * Dense grid: the chosen item shows as its name with an icon-only change
   * button. In a column narrow enough to matter, the word "Change" beside the
   * name is wider than the name gets.
   */
  compact?: boolean
}

/**
 * Item typeahead for document lines: `GET /v1/items/search?with_stock=1&warehouse_id=` so every
 * suggestion shows what is on hand and available where the line will post.
 *
 * The suggestion list is portalled to `document.body` and positioned against
 * the input, for the reason MenuButton already documents: a line editor lives
 * inside `.table-wrap`, which scrolls horizontally, and anything positioned
 * inside that box is clipped by it. A dropdown that opens below a one-row grid
 * was clipped to a couple of pixels and, on a wide line table, could not be
 * reached at all.
 */
export function LineItemPicker({ itemId, itemName, itemSku, warehouseId, onPick, onClear, disabled, autoFocus, invalid, compact = false }: LineItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const listId = useId()

  /** Under the input, or above it when the viewport has no room below. */
  const place = useCallback(() => {
    const anchor = inputRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const height = listRef.current?.offsetHeight ?? 0
    const below = window.innerHeight - rect.bottom
    const top = height > 0 && below < height + 8 && rect.top > height + 8 ? rect.top - height - 4 : rect.bottom + 4
    setBox({ top, left: rect.left, width: rect.width })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, rows.length, loading])

  useEffect(() => {
    if (!open) return undefined
    const onMove = () => place()
    window.addEventListener('resize', onMove)
    // Capture: the shell scrolls `main`, and the line table scrolls itself.
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

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
      <div className="typeahead-selected">
        <span>
          <strong>{itemName || `Item #${itemId}`}</strong>
          {itemSku ? <span className="muted"> · {itemSku}</span> : null}
        </span>
        {!disabled ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} aria-label="Change item">
            {compact ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : 'Change'}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="typeahead" ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        className="input"
        value={query}
        placeholder="Search item by name, SKU or barcode…"
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
          if (!open) return
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
            setOpen(false)
          }
        }}
      />
      {open && box
        ? createPortal(
            <ul
              ref={listRef}
              className="typeahead-list"
              id={listId}
              role="listbox"
              style={{ position: 'fixed', top: box.top, left: box.left, width: box.width, right: 'auto' }}
            >
              {rows.length === 0 ? <li className="typeahead-empty">{loading ? 'Searching…' : 'No matching items'}</li> : null}
              {rows.map((row, i) => (
                <li
                  key={row.item_id}
                  role="option"
                  aria-selected={i === active}
                  className={`typeahead-option${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(row)
                  }}
                >
                  <span>{row.item_name}</span>
                  <span className="meta">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                    {row.stock ? ` · avail ${formatQty(row.stock.available)} / on hand ${formatQty(row.stock.on_hand)}${warehouseId ? '' : ' (all warehouses)'}` : ''}
                    {row.track_batch ? ' · batch' : ''}
                    {row.track_serial ? ' · serial' : ''}
                  </span>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
