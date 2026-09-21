import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Boxes, Search, X } from 'lucide-react'
import { useDebounce } from '../../../hooks/useDebounce'
import { isAbortError } from '../../../services/api'
import { lookupApi } from '../../../services/lookupApi'
import type { ItemSearchRow } from '../../../services/lookupApi'
import { Badge } from '../../../ui/Badge'
import { Button } from '../../../ui/Button'
import { Input } from '../../../ui/Input'
import { cx } from '../../../ui/cx'
import { formatQty } from '../../../utils/format'

export interface FinishedItemValue {
  itemId: number
  name: string
  sku: string | null
}

export interface FinishedItemSelectorProps {
  id: string
  value: FinishedItemValue | null
  onPick: (row: ItemSearchRow) => void
  onClear: () => void
  disabled?: boolean
  invalid?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
}

/**
 * Finished-good typeahead over `GET /v1/items/search` — the same endpoint every other document
 * line uses, so name, alias, SKU and barcode all match exactly as they do elsewhere, and each
 * suggestion carries what is on hand.
 */
export function FinishedItemSelector({ id, value, onPick, onClear, disabled, invalid, inputRef }: FinishedItemSelectorProps) {
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
      .searchItems(debounced.trim(), { limit: 15, signal: controller.signal })
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
  }, [debounced, open])

  useEffect(() => {
    if (!open) return undefined
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const pick = (row: ItemSearchRow) => {
    onPick(row)
    setOpen(false)
    setQuery('')
  }

  if (value) {
    return (
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/70 px-2.5">
        <Boxes className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900" title={value.name}>
          {value.name}
        </span>
        {value.sku ? (
          <span className="shrink-0 truncate text-[11px] text-gray-500" title={value.sku}>
            {value.sku}
          </span>
        ) : null}
        {!disabled ? (
          <Button variant="ghost" size="xs" icon={X} onClick={onClear} aria-label="Change finished item" className="shrink-0 -mr-1.5" />
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative" ref={rootRef}>
      <Input
        id={id}
        ref={inputRef}
        value={query}
        leadingIcon={Search}
        placeholder="Search finished good by name, SKU or barcode…"
        disabled={disabled}
        invalid={invalid}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
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
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Finished goods"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">{loading ? 'Searching…' : 'No matching items'}</li>
          ) : null}
          {rows.map((row, i) => (
            <li
              key={row.item_id}
              role="option"
              aria-selected={i === active}
              className={cx('cursor-pointer px-3 py-1.5', i === active ? 'bg-primary-light' : 'hover:bg-gray-50')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(row)
              }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{row.print_name || row.item_name}</span>
                {Number(row.track_batch) === 1 ? <Badge size="xs" tone="info">Batch</Badge> : null}
                {Number(row.track_serial) === 1 ? <Badge size="xs" tone="violet">Serial</Badge> : null}
              </div>
              <div className="truncate text-[11px] text-gray-500">
                {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ') || '—'}
                {row.stock ? ` · on hand ${formatQty(row.stock.on_hand)} (all warehouses)` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default FinishedItemSelector
