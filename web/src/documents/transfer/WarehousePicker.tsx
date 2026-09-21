import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Warehouse } from 'lucide-react'
import { cx } from '../../ui/cx'
import type { FormOptionWarehouse } from '../../services/items'

export interface WarehousePickerProps {
  id: string
  value: number | null
  onChange: (id: number | null) => void
  warehouses: FormOptionWarehouse[]
  /** Cannot be chosen here, with the reason shown beside it. */
  blockedId?: number | null
  blockedReason?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  loading?: boolean
  describedBy?: string
  /** Secondary line under a warehouse name, e.g. its branch. */
  contextFor?: (warehouse: FormOptionWarehouse) => string | null
}

function matches(w: FormOptionWarehouse, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return w.warehouse_name.toLowerCase().includes(needle) || (w.warehouse_code ?? '').toLowerCase().includes(needle)
}

/**
 * Searchable warehouse select.
 *
 * A native `<select>` is fine for eight warehouses and unusable at eighty, and
 * it cannot say WHY the one the user is reaching for is unavailable. This can:
 * the destination already chosen stays in the list, greyed, with the reason
 * next to it, instead of vanishing and leaving the user hunting for it.
 *
 * Only warehouses this profile may post to are ever passed in — the list comes
 * from `useReferenceData`, which narrows `items/form-options` by
 * `allowed_warehouses` and by the selected branch. The API enforces the same.
 */
export function WarehousePicker({
  id,
  value,
  onChange,
  warehouses,
  blockedId = null,
  blockedReason = 'Already used on the other side of this transfer',
  placeholder = 'Select warehouse…',
  disabled = false,
  invalid = false,
  loading = false,
  describedBy,
  contextFor,
}: WarehousePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selected = useMemo(() => warehouses.find((w) => w.warehouse_id === value) ?? null, [warehouses, value])
  const visible = useMemo(() => warehouses.filter((w) => matches(w, query.trim())), [warehouses, query])

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    setActive(Math.max(0, warehouses.findIndex((w) => w.warehouse_id === value)))
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', onDoc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once per open
  }, [open])

  const choose = (w: FormOptionWarehouse) => {
    if (w.warehouse_id === blockedId) return
    onChange(w.warehouse_id)
    setOpen(false)
  }

  return (
    // The attribute tells the keyboard layer that focus is inside an open
    // combobox, so Alt+S does not fire while the user is filtering this list.
    <div className="relative" ref={rootRef} data-combo-open={open ? 'true' : undefined}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={cx(
          'aic flex h-9 w-full items-center gap-2 rounded-lg border bg-white px-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 disabled:bg-gray-50 disabled:text-gray-400',
          invalid
            ? 'border-red-300 focus:border-red-500 focus:ring-red-300/40'
            : 'border-gray-200 focus:border-primary focus:ring-primary/30',
        )}
      >
        <Warehouse className={cx('h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-gray-400')} aria-hidden />
        <span className={cx('min-w-0 flex-1 truncate', selected ? 'text-gray-900' : 'text-gray-400')}>
          {loading ? 'Loading warehouses…' : selected ? selected.warehouse_name : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-1 w-[max(100%,17rem)] max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-overlay">
          <div className="relative border-b border-gray-100 p-1.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              ref={inputRef}
              className="aic block h-8 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2.5 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={query}
              placeholder="Search warehouses…"
              aria-label="Search warehouses"
              aria-controls={listId}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(visible.length - 1, a + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(0, a - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const pick = visible[active]
                  if (pick) choose(pick)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
              }}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Warehouses" className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <li className="px-3 py-3 text-xs text-gray-500">
                {warehouses.length === 0
                  ? 'No warehouse is available to you in this branch.'
                  : `No warehouse matches “${query.trim()}”.`}
              </li>
            ) : null}
            {visible.map((w, i) => {
              const blocked = w.warehouse_id === blockedId
              const isSelected = w.warehouse_id === value
              const context = contextFor?.(w) ?? null
              return (
                <li key={w.warehouse_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={blocked || undefined}
                    disabled={blocked}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(w)}
                    className={cx(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                      blocked ? 'cursor-not-allowed opacity-50' : i === active ? 'bg-primary-light' : 'hover:bg-gray-50',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm text-gray-900">{w.warehouse_name}</span>
                        {Number(w.is_default) === 1 ? (
                          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500">
                            default
                          </span>
                        ) : null}
                      </span>
                      {blocked ? (
                        <span className="block truncate text-[11px] text-amber-700">{blockedReason}</span>
                      ) : w.warehouse_code || context ? (
                        <span className="block truncate text-[11px] text-gray-400">
                          {[w.warehouse_code, context].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
