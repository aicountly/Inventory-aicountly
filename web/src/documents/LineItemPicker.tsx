import { useEffect, useId, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../ui/Input'
import { AIC, cx } from '../ui/cx'
import { formatQty } from '../utils/format'
import type { WarehouseSelectVariant } from './WarehouseSelect'

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
  /** `legacy` keeps the hand-styled typeahead; `field` draws the Books-language one. */
  variant?: WarehouseSelectVariant
  placeholder?: string
  /**
   * Show the barcode affordance (field skin only).
   *
   * It is not a camera and does not pretend to be one: a warehouse barcode reader is a keyboard
   * that types the code and presses Enter, so "scan" means put the caret in this field and wait.
   * `GET /v1/items/search` matches `item_upc` exactly whatever the search mode, so the scanned
   * code lands on its item and Enter takes it — the same path a typed SKU takes.
   */
  scan?: boolean
}

/** Class names per skin, so the two look different and behave identically. */
const SKIN = {
  legacy: {
    root: 'typeahead',
    selected: 'typeahead-selected',
    input: 'input',
    list: 'typeahead-list',
    option: 'typeahead-option',
    optionActive: 'typeahead-option active',
    empty: 'typeahead-empty',
    meta: 'meta',
  },
  field: {
    root: `${AIC} relative`,
    selected: `${AIC} flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1.5`,
    input: cx(FIELD_BASE, FIELD_OK, 'h-8 text-sm'),
    list: `${AIC} absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay scrollbar-thin`,
    option: 'flex cursor-pointer flex-col gap-0.5 px-2.5 py-1.5 text-sm text-gray-800',
    optionActive: 'flex cursor-pointer flex-col gap-0.5 bg-primary-light px-2.5 py-1.5 text-sm text-gray-900',
    empty: 'px-2.5 py-2 text-xs text-gray-500',
    meta: 'text-[11px] text-gray-500',
  },
} as const

/**
 * Item typeahead for document lines: `GET /v1/items/search?with_stock=1&warehouse_id=` so every
 * suggestion shows what is on hand and available where the line will post.
 */
export function LineItemPicker({
  itemId,
  itemName,
  itemSku,
  warehouseId,
  onPick,
  onClear,
  disabled,
  autoFocus,
  invalid,
  variant = 'legacy',
  placeholder = 'Search item by name, SKU or barcode…',
  scan = false,
}: LineItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [scanning, setScanning] = useState(false)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const skin = SKIN[variant]

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
        setFailed(false)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setFailed(true)
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
    setScanning(false)
  }

  if (itemId !== null) {
    return (
      <div className={skin.selected}>
        <span className={variant === 'field' ? 'min-w-0 truncate' : undefined}>
          <strong className={variant === 'field' ? 'text-sm font-semibold text-gray-900' : undefined}>
            {itemName || `Item #${itemId}`}
          </strong>
          {itemSku ? <span className={variant === 'field' ? 'ml-1 text-xs text-gray-500' : 'muted'}> · {itemSku}</span> : null}
        </span>
        {!disabled ? (
          variant === 'field' ? (
            <button
              type="button"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary-light"
              onClick={onClear}
            >
              Change
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} aria-label="Change item">
              Change
            </button>
          )
        ) : null}
      </div>
    )
  }

  const showScan = scan && variant === 'field'

  return (
    <div className={skin.root} ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        className={cx(skin.input, variant === 'field' && invalid && FIELD_INVALID, showScan && 'pr-9')}
        value={query}
        placeholder={scanning ? 'Scan a barcode…' : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setScanning(false)}
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
      {showScan ? (
        <button
          type="button"
          disabled={disabled}
          title="Scan a barcode into this field"
          aria-label="Scan a barcode into this field"
          aria-pressed={scanning}
          className={cx(
            'absolute right-1 top-1/2 flex h-6 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors',
            scanning ? 'bg-primary text-white' : 'bg-sky-50 text-sky-600 hover:bg-sky-100',
          )}
          onClick={() => {
            setScanning(true)
            setOpen(true)
            inputRef.current?.focus()
          }}
        >
          <ScanLine className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {open ? (
        <ul className={skin.list} id={listId} role="listbox">
          {rows.length === 0 ? (
            <li className={skin.empty}>
              {loading ? 'Searching…' : failed ? 'Unable to load items. Try again.' : 'No matching items'}
            </li>
          ) : null}
          {rows.map((row, i) => (
            <li
              key={row.item_id}
              role="option"
              aria-selected={i === active}
              className={i === active ? skin.optionActive : skin.option}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(row)
              }}
            >
              <span className={variant === 'field' ? 'truncate font-medium' : undefined}>{row.item_name}</span>
              <span className={skin.meta}>
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
