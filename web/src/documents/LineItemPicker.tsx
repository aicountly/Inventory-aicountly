import { useEffect, useId, useRef, useState } from 'react'
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
}

/**
 * Item typeahead for document lines: `GET /v1/items/search?with_stock=1&warehouse_id=` so every
 * suggestion shows what is on hand and available where the line will post.
 */
export function LineItemPicker({ itemId, itemName, itemSku, warehouseId, onPick, onClear, disabled, autoFocus, invalid }: LineItemPickerProps) {
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
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
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
            Change
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="typeahead" ref={rootRef}>
      <input
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
      {open ? (
        <ul className="typeahead-list" id={listId} role="listbox">
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
        </ul>
      ) : null}
    </div>
  )
}
