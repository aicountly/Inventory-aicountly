import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Loader2, Package, ScanBarcode, Search } from 'lucide-react'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { useDebounce } from '../../hooks/useDebounce'
import { formatQty } from '../../utils/format'
import { resolveItemCode } from './revaluationApi'

export interface RevaluationItemSearchProps {
  /** Availability in the dropdown is read where the line will post. */
  warehouseId: number | null
  onPick: (item: ItemSearchRow) => void
  /** Item ids already on the document, so the list can say so. */
  existingItemIds: ReadonlySet<number>
  disabled?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  scanMode: boolean
  onScanModeChange: (on: boolean) => void
}

/**
 * The add-an-item box above the grid.
 *
 * Two modes over the same box. In search mode it is the typeahead every document editor uses
 * (`GET /v1/items/search?with_stock=1`), debounced and cancelled on the next keystroke. In scan
 * mode a barcode ends with Enter and resolves through `GET /v1/items/by-barcode/{code}`, which
 * matches a barcode or a SKU exactly — so a scanner adds a line without the operator touching the
 * mouse, and the box clears itself for the next scan.
 */
export function RevaluationItemSearch({ warehouseId, onPick, existingItemIds, disabled, inputRef, scanMode, onScanModeChange }: RevaluationItemSearchProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ItemSearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const ownRef = useRef<HTMLInputElement>(null)
  const boxRef = inputRef ?? ownRef
  const listId = useId()

  useEffect(() => {
    if (scanMode || !open) return undefined
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
  }, [debounced, open, warehouseId, scanMode])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const take = (item: ItemSearchRow) => {
    onPick(item)
    setQuery('')
    setRows([])
    setOpen(false)
    setScanError(null)
    boxRef.current?.focus()
  }

  const scan = async () => {
    const code = query.trim()
    if (!code || scanning) return
    setScanning(true)
    setScanError(null)
    try {
      const resolved = await resolveItemCode(code, warehouseId)
      if (resolved.item) take(resolved.item)
      else setScanError(resolved.reason ?? 'No item with that code.')
    } catch (err) {
      setScanError(errorMessage(err, 'That code could not be looked up.'))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="relative min-w-0 flex-1" ref={rootRef} data-combo-open={open ? 'true' : undefined}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          {scanning ? (
            <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" aria-hidden />
          ) : scanMode ? (
            <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden />
          ) : (
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          )}
          <input
            ref={boxRef}
            type="search"
            className="aic block h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50"
            placeholder={scanMode ? 'Scan or type a barcode / SKU, then Enter…' : 'Search item by name, SKU or barcode…'}
            value={query}
            disabled={disabled}
            autoComplete="off"
            role={scanMode ? undefined : 'combobox'}
            aria-expanded={scanMode ? undefined : open}
            aria-controls={scanMode ? undefined : listId}
            aria-autocomplete={scanMode ? undefined : 'list'}
            aria-label={scanMode ? 'Scan a barcode or SKU' : 'Search for an item to revalue'}
            onFocus={() => !scanMode && setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value)
              setScanError(null)
              if (!scanMode) setOpen(true)
            }}
            onKeyDown={(e) => {
              if (scanMode) {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void scan()
                }
                return
              }
              if (!open) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(rows.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault()
                take(rows[active])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            onScanModeChange(!scanMode)
            setOpen(false)
            setScanError(null)
            setQuery('')
            requestAnimationFrame(() => boxRef.current?.focus())
          }}
          aria-pressed={scanMode}
          title={scanMode ? 'Back to searching by name' : 'Scan barcodes instead of searching'}
          className={[
            'aic inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
            scanMode ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary-light hover:text-primary',
          ].join(' ')}
        >
          <ScanBarcode className="h-4 w-4" aria-hidden />
          Scan
        </button>
      </div>

      {scanError ? (
        <p className="mt-1 text-[11px] font-medium text-red-600" role="alert">
          {scanError}
        </p>
      ) : null}

      {!scanMode && open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching items"
          className="aic absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto scrollbar-thin rounded-xl border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-3 text-xs text-gray-500">{loading ? 'Searching…' : 'No matching items.'}</li>
          ) : null}
          {rows.map((row, index) => {
            const already = existingItemIds.has(row.item_id)
            return (
              <li
                key={row.item_id}
                role="option"
                aria-selected={index === active}
                className={['flex cursor-pointer items-center gap-2.5 px-3 py-2', index === active ? 'bg-primary-light/60' : ''].join(' ')}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  take(row)
                }}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                  <Package className="h-4 w-4 text-gray-400" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-gray-900">{row.print_name || row.item_name}</span>
                    {already ? <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 text-[9px] font-bold uppercase text-amber-700">On document</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-gray-500">
                    {[row.item_sku ? `SKU ${row.item_sku}` : null, row.hsn_sac ? `HSN ${row.hsn_sac}` : null, row.track_batch ? 'batch' : null, row.track_serial ? 'serial' : null].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold tabular-nums text-gray-900">{row.stock ? formatQty(row.stock.on_hand) : '—'}</span>
                  <span className="block text-[10px] text-gray-400">{row.unit_symbol ?? 'on hand'}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export default RevaluationItemSearch
