import { useEffect, useId, useRef, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { itemsApi } from '../services/items'
import type { ItemSearchRow } from '../services/items'

export interface PickedItem {
  item_id: number
  item_name: string
  item_sku?: string | null
  unit_id?: number | null
  unit_symbol?: string | null
  track_batch?: number
  track_serial?: number
  units?: ItemSearchRow['units']
}

interface ItemPickerProps {
  value: PickedItem | null
  onChange: (item: PickedItem | null) => void
  placeholder?: string
  disabled?: boolean
  /** Hide rows that do not qualify (e.g. only serial-tracked items). */
  filter?: (row: ItemSearchRow) => boolean
  autoFocus?: boolean
  id?: string
  invalid?: boolean
}

/** Typeahead over `GET /v1/items/search` (name / alias / SKU / barcode prefix). */
export function ItemPicker({ value, onChange, placeholder = 'Search items by name, SKU or barcode…', disabled, filter, autoFocus, id, invalid }: ItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  // Callers usually pass an inline arrow; reading it through a ref keeps a new
  // identity per render from re-running the search on every render.
  const filterRef = useRef(filter)
  filterRef.current = filter

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    itemsApi
      .search(debounced.trim(), 20, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return
        const f = filterRef.current
        setRows(f ? found.filter(f) : found)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (row: ItemSearchRow) => {
    onChange({
      item_id: row.item_id,
      item_name: row.item_name,
      item_sku: row.item_sku,
      unit_id: row.unit_id,
      unit_symbol: row.unit_symbol,
      track_batch: row.track_batch,
      track_serial: row.track_serial,
      units: row.units,
    })
    setOpen(false)
    setQuery('')
  }

  if (value) {
    return (
      <div className="typeahead-selected">
        <span>
          <strong>{value.item_name}</strong>
          {value.item_sku ? <span className="muted"> · {value.item_sku}</span> : null}
        </span>
        {!disabled ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} aria-label="Change item">
            Change
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="typeahead" ref={rootRef}>
      <input
        id={id}
        type="text"
        className="input"
        value={query}
        placeholder={placeholder}
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
                {[row.item_sku, row.item_upc, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
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
