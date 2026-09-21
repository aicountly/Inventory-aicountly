import { useEffect, useId, useRef, useState } from 'react'
import { Boxes, Hash, Layers, RotateCcw, ScanBarcode, Search } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'

/** The row whose SKU or barcode is exactly what was scanned, if any. */
export function exactMatch(rows: ItemSearchRow[], code: string): ItemSearchRow | null {
  const needle = code.trim().toLowerCase()
  if (!needle) return null
  return (
    rows.find((r) => (r.item_sku ?? '').toLowerCase() === needle || (r.item_upc ?? '').toLowerCase() === needle) ??
    (rows.length === 1 ? rows[0] : null)
  )
}

/** The line under an item's name: its group, else its category, else its SKU. */
export function itemSubtitle(row: Pick<ItemSearchRow, 'grp_name' | 'cat_name' | 'item_sku'>): string {
  return (row.grp_name || row.cat_name || row.item_sku || '').trim()
}

export interface ItemSearchInputProps {
  /** Availability in the suggestions is scoped to this warehouse when set. */
  warehouseId: number | null
  onPick: (row: ItemSearchRow) => void
  placeholder?: string
  disabled?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Scanner mode: Enter resolves the typed code to exactly one item and adds it. */
  scan?: boolean
  limit?: number
  autoFocus?: boolean
  className?: string
  /** Called when a scan finds nothing, so the caller can toast it. */
  onScanMiss?: (code: string) => void
}

/**
 * Item typeahead over `GET /v1/items/search?with_stock=1&warehouse_id=` — name,
 * alias, SKU prefix and exact barcode, with what is on hand where the line will
 * post shown beside every suggestion.
 *
 * In scan mode Enter does not pick the highlighted row: it resolves the typed
 * code and only adds when exactly one item answers to it, which is what a
 * hand scanner firing a code plus Enter into a focused box needs.
 */
export function ItemSearchInput({
  warehouseId,
  onPick,
  placeholder = 'Search item by name, SKU or barcode…',
  disabled,
  inputRef,
  scan = false,
  limit = 12,
  autoFocus,
  className,
  onScanMiss,
}: ItemSearchInputProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const debounced = useDebounce(query, 280)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    lookupApi
      .searchItems(debounced.trim(), { warehouseId, limit, signal: controller.signal })
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
  }, [debounced, open, warehouseId, limit, tick])

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
    setQuery('')
    setRows([])
    setOpen(false)
  }

  const resolveScan = async () => {
    const code = query.trim()
    if (!code) return
    setLoading(true)
    try {
      const found = await lookupApi.searchItems(code, { warehouseId, limit: 5 })
      const row = exactMatch(found, code)
      if (row) pick(row)
      else onScanMiss?.(code)
    } catch (err) {
      setError(errorMessage(err, 'Could not look that code up.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cx('relative', className)} ref={rootRef}>
      <Input
        ref={inputRef}
        type="search"
        size="sm"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={scan ? 'Scan or type a barcode' : 'Search items'}
        leadingIcon={scan ? ScanBarcode : Search}
        className={scan ? 'ring-2 ring-sky-200' : undefined}
        // Opened by typing, not by focus. After a line is added the cursor comes
        // straight back here, and a list that reopened on its own would cover
        // the row that was just added — the one thing the user wants to see.
        onFocus={() => {
          if (query.trim()) setOpen(true)
        }}
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
            if (scan) void resolveScan()
            else if (rows[active]) pick(rows[active])
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
          aria-label="Items"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto scrollbar-thin rounded-lg border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {loading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
              <Spinner /> Searching…
            </li>
          ) : null}
          {error && !loading ? (
            <li className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-red-600">
              <span className="min-w-0 truncate">{error}</span>
              <Button variant="ghost" size="xs" icon={RotateCcw} onClick={() => setTick((t) => t + 1)}>
                Retry
              </Button>
            </li>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">{query.trim() ? 'No item matches that name, SKU or barcode.' : 'Type a name, SKU or barcode to search.'}</li>
          ) : null}
          {rows.map((row, i) => {
            const subtitle = itemSubtitle(row)
            const available = row.stock?.available
            return (
              <li key={row.item_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cx('flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors', i === active ? 'bg-primary-light' : 'hover:bg-gray-50')}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(row)
                  }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-400">
                    <Boxes className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">{row.print_name || row.item_name}</span>
                    <span className="flex items-center gap-1.5 truncate text-[11px] text-gray-500">
                      {row.item_sku ? <span className="font-mono">{row.item_sku}</span> : null}
                      {subtitle && subtitle !== row.item_sku ? <span className="truncate">· {subtitle}</span> : null}
                      {Number(row.track_batch) === 1 ? <Layers className="h-3 w-3 text-amber-500" aria-label="Batch tracked" /> : null}
                      {Number(row.track_serial) === 1 ? <Hash className="h-3 w-3 text-violet-500" aria-label="Serial tracked" /> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cx('block text-xs font-semibold tabular-nums', (available ?? 0) > 0 ? 'text-emerald-700' : 'text-gray-400')}>
                      {available === undefined ? '—' : formatQty(available)}
                    </span>
                    <span className="block text-[10px] text-gray-400">{row.unit_symbol ?? 'avail'}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
