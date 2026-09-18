import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { isAbortError } from '../services/api'
import { lookupApi } from '../services/lookupApi'
import type { ItemSearchRow } from '../services/lookupApi'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { AIC, cx } from '../ui/cx'
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

const GAP = 4
const MARGIN = 8

/**
 * Item typeahead for document lines: `GET /v1/items/search?with_stock=1&warehouse_id=` so every
 * suggestion shows what is on hand and available where the line will post.
 *
 * The results list is portalled to `document.body` and positioned against the
 * viewport — the same reason MenuButton is: this control lives inside a table
 * with `overflow-x-auto`, and a list positioned inside that box would be
 * clipped by it on every row but the last.
 */
export function LineItemPicker({ itemId, itemName, itemSku, warehouseId, onPick, onClear, disabled, autoFocus, invalid }: LineItemPickerProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [style, setStyle] = useState<{ top: number; left: number; width: number } | null>(null)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
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

  const place = useCallback(() => {
    const anchor = rootRef.current
    const list = listRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const height = list?.offsetHeight ?? 0
    const below = window.innerHeight - rect.bottom >= height + GAP + MARGIN
    const top = below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - height - GAP)
    setStyle({ top, left: rect.left, width: rect.width })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, rows.length])

  useEffect(() => {
    if (!open) return undefined
    const onScrollOrResize = () => place()
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [open, place])

  const pick = (row: ItemSearchRow) => {
    onPick(row)
    setOpen(false)
    setQuery('')
  }

  if (itemId !== null) {
    return (
      <div className="aic flex min-h-[2.25rem] items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
        <span className="min-w-0 truncate text-sm">
          <strong className="font-semibold text-gray-900">{itemName || `Item #${itemId}`}</strong>
          {itemSku ? <span className="text-gray-500"> · {itemSku}</span> : null}
        </span>
        {!disabled ? (
          <Button variant="ghost" size="xs" onClick={onClear} aria-label="Change item" className="shrink-0">
            Change
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="aic relative" ref={rootRef}>
      <Input
        type="text"
        leadingIcon={Search}
        value={query}
        placeholder="Search item by name, SKU or barcode…"
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        invalid={invalid}
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
      {open
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              className={cx(AIC, 'fixed z-[95] max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay print:hidden')}
              style={style ? { top: style.top, left: style.left, width: Math.max(style.width, 288) } : { top: -9999, left: -9999 }}
            >
              {rows.length === 0 ? (
                <li className="px-2.5 py-2 text-sm text-gray-500">{loading ? 'Searching…' : 'No matching items'}</li>
              ) : null}
              {rows.map((row, i) => {
                const stock = row.stock
                const low = stock ? stock.available > 0 && stock.available <= 5 : false
                const none = stock ? stock.available <= 0 : false
                return (
                  <li
                    key={row.item_id}
                    role="option"
                    aria-selected={i === active}
                    className={cx('flex cursor-pointer flex-col gap-0.5 px-2.5 py-1.5 text-sm', i === active ? 'bg-primary-light/60' : 'hover:bg-gray-50')}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(row)
                    }}
                  >
                    <span className="truncate font-medium text-gray-900">{row.print_name || row.item_name}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                      <span>{[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}</span>
                      {stock ? (
                        <span className={cx('font-medium', none ? 'text-red-600' : low ? 'text-amber-600' : 'text-gray-500')}>
                          · avail {formatQty(stock.available)}
                          {!warehouseId ? ' (all warehouses)' : ''}
                        </span>
                      ) : null}
                      {row.track_batch ? <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Batch</span> : null}
                      {row.track_serial ? <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Serial</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
