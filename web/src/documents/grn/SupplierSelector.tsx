import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Building2, ChevronDown, Search, X } from 'lucide-react'
import { isAbortError } from '../../services/api'
import { mergeSuppliers, supplierDirectoryApi } from '../../services/supplierDirectoryApi'
import type { SupplierOption } from '../../services/supplierDirectoryApi'
import { useDebounce } from '../../hooks/useDebounce'
import { Spinner } from '../../ui/Spinner'
import { AIC, cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'

export interface SupplierSelectorProps {
  id?: string
  /** Books ledger id as typed / chosen, or ''. */
  partyRef: string
  partyName: string
  onChange: (patch: { party_ref?: string; party_name?: string }) => void
  disabled?: boolean
  invalid?: boolean
}

const FIELD =
  'flex h-9 w-full items-center gap-2 rounded-lg border bg-white px-2.5 text-sm text-gray-900 transition-colors focus-within:ring-2 focus-within:ring-primary/30'

/**
 * Who the goods came from.
 *
 * A supplier is a Books ledger, not an Inventory master (`docs/DOMAIN_OWNERSHIP.md`), so this
 * searches Books live and stores only what Inventory owns on the document: the ledger id
 * (`party_ref`) that pending quantities are matched on, and a name snapshot. Nothing is cached
 * and no supplier list is kept here.
 *
 * While the Books relay is not deployed the list falls back to the suppliers already used on
 * inward documents in this company — Inventory's own register, read live — and the name can
 * still be typed, exactly as this screen worked before. A receiving bench is never blocked by a
 * directory it cannot reach.
 */
export function SupplierSelector({ id, partyRef, partyName, onChange, disabled, invalid }: SupplierSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SupplierOption[]>([])
  const [loading, setLoading] = useState(false)
  const [directoryNote, setDirectoryNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const debounced = useDebounce(query, 300)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const chosen = partyName.trim() !== '' || partyRef.trim() !== ''

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [books, recent] = await Promise.all([
          supplierDirectoryApi.search(debounced, controller.signal),
          supplierDirectoryApi.recent(debounced, controller.signal).catch(() => [] as SupplierOption[]),
        ])
        if (controller.signal.aborted) return
        setDirectoryNote(books.available ? null : books.message)
        setRows(mergeSuppliers(books.available ? books.data : [], recent))
        setActive(0)
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError('Could not search suppliers. Type the name and ledger id instead.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [debounced, open])

  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const grouped = useMemo(() => {
    const books = rows.filter((r) => r.source === 'books')
    const recent = rows.filter((r) => r.source === 'recent')
    return { books, recent, flat: [...books, ...recent] }
  }, [rows])

  const pick = (supplier: SupplierOption) => {
    onChange({ party_name: supplier.party_name, party_ref: supplier.party_ref !== null ? String(supplier.party_ref) : '' })
    setOpen(false)
    setQuery('')
  }

  const clear = () => {
    onChange({ party_name: '', party_ref: '' })
    setOpen(false)
    setQuery('')
  }

  if (chosen && !open) {
    return (
      <div className={cx(AIC, FIELD, invalid ? 'border-red-300' : 'border-gray-200')}>
        <Building2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={partyName || `Ledger #${partyRef}`}>
          {partyName || `Ledger #${partyRef}`}
        </span>
        {!disabled ? (
          <>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              onClick={clear}
              aria-label="Clear supplier"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              onClick={() => {
                setOpen(true)
                setQuery('')
                window.setTimeout(() => inputRef.current?.focus(), 0)
              }}
              aria-label="Change supplier"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <div className={cx(FIELD, invalid ? 'border-red-300' : 'border-gray-200')}>
        <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
          placeholder="Search supplier by name or ledger id…"
          value={query}
          disabled={disabled}
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
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(grouped.flat.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const hit = grouped.flat[active]
              if (hit) pick(hit)
              // Nothing matched: keep what was typed as the printed name, which is
              // what this field has always accepted.
              else if (query.trim()) {
                onChange({ party_name: query.trim() })
                setOpen(false)
                setQuery('')
              }
            } else if (e.key === 'Escape' && open) {
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
        {loading ? <Spinner /> : null}
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Suppliers"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {grouped.books.length > 0 ? <Group label="Books ledger directory" /> : null}
          {grouped.books.map((s) => (
            <Row key={`books-${s.party_ref ?? s.party_name}`} supplier={s} active={grouped.flat.indexOf(s) === active} onPick={pick} onHover={() => setActive(grouped.flat.indexOf(s))} />
          ))}
          {grouped.recent.length > 0 ? <Group label="Recently received from" /> : null}
          {grouped.recent.map((s) => (
            <Row key={`recent-${s.party_ref ?? s.party_name}`} supplier={s} active={grouped.flat.indexOf(s) === active} onPick={pick} onHover={() => setActive(grouped.flat.indexOf(s))} />
          ))}

          {!loading && grouped.flat.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500">
              {error ?? 'No suppliers found.'}
              {query.trim() ? ' Press Enter to use what you typed as the printed name.' : ''}
            </p>
          ) : null}

          {directoryNote ? (
            <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-amber-700">
              {directoryNote} Showing suppliers already used in Inventory.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Group({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
  )
}

function Row({
  supplier,
  active,
  onPick,
  onHover,
}: {
  supplier: SupplierOption
  active: boolean
  onPick: (s: SupplierOption) => void
  onHover: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={cx(
        'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
        active ? 'bg-primary-light' : 'hover:bg-gray-50',
      )}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault()
        onPick(supplier)
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900">{supplier.party_name}</span>
        <span className="block truncate text-[11px] text-gray-500">
          {[
            supplier.party_ref !== null ? `Ledger ${supplier.party_ref}` : 'No ledger id',
            supplier.ledger_code,
            supplier.gstin,
            supplier.last_used ? `last ${formatDate(supplier.last_used)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </button>
  )
}

export default SupplierSelector
