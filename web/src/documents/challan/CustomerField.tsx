import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, ChevronRight, RotateCcw, Search, UserRoundPlus, X } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { partyDirectory } from '../../services/partyApi'
import type { PartyContext, PartyOption } from '../../services/partyApi'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Spinner } from '../../ui/Spinner'
import { cx } from '../../ui/cx'
import { formatDate, formatQty } from '../../utils/format'

interface CustomerFieldProps {
  partyRef: string
  partyName: string
  onChange: (patch: { party_ref?: string; party_name?: string }) => void
  disabled?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  invalid?: boolean
  documentType: string
}

/**
 * Customer picker for the challan header.
 *
 * The suggestions are the parties this company has already raised documents for
 * (`services/partyApi`), which is Inventory's own record — Books owns the
 * customer master and no copy of it lives here. A name that has never been used
 * is typed in and kept as-is, exactly as the old free-text field allowed, so no
 * dispatch is ever blocked on a lookup.
 */
export function CustomerField({ partyRef, partyName, onChange, disabled, inputRef, invalid, documentType }: CustomerFieldProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<PartyOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [tick, setTick] = useState(0)
  const debounced = useDebounce(query, 300)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    partyDirectory
      .search(debounced, { documentType, signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError(errorMessage(err, 'Could not reach the document service.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open, documentType, tick])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const choose = (row: PartyOption) => {
    onChange({ party_name: row.party_name, party_ref: row.party_ref !== null ? String(row.party_ref) : '' })
    setOpen(false)
    setQuery('')
  }

  const keepTyped = () => {
    const typed = query.trim()
    if (!typed) return
    onChange({ party_name: typed })
    setOpen(false)
    setQuery('')
  }

  if (partyName.trim() || partyRef.trim()) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 h-8">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-900" title={partyName || `Ledger #${partyRef}`}>
          {partyName || `Ledger #${partyRef}`}
        </span>
        {!disabled ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Clear customer"
            onClick={() => {
              onChange({ party_name: '', party_ref: '' })
              setQuery('')
              window.setTimeout(() => inputRef?.current?.focus(), 0)
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative" ref={rootRef}>
      <Input
        ref={inputRef}
        type="search"
        size="sm"
        value={query}
        placeholder="Search customer by name, or type a new one…"
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Customer"
        invalid={invalid}
        leadingIcon={Search}
        onFocus={() => setOpen(true)}
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
            if (open && rows[active]) choose(rows[active])
            else keepTyped()
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Customers on this company's documents"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto scrollbar-thin rounded-lg border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {loading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
              <Spinner /> Searching documents…
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
            <li className="px-3 py-2 text-xs text-gray-500">
              {query.trim() ? 'No customer on an existing document matches that.' : 'No documents with a customer yet.'}
            </li>
          ) : null}
          {rows.map((row, i) => (
            <li key={`${row.party_ref ?? 'n'}-${row.party_name}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                  i === active ? 'bg-primary-light' : 'hover:bg-gray-50',
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(row)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900">{row.party_name}</span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {row.party_ref !== null ? `Ledger #${row.party_ref}` : 'No ledger id'}
                    {row.last_document_date ? ` · last ${formatDate(row.last_document_date)}` : ''}
                    {row.last_document_no ? ` · ${row.last_document_no}` : ''}
                  </span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" aria-hidden />
              </button>
            </li>
          ))}
          {query.trim() ? (
            <li className="mt-1 border-t border-gray-100 pt-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-primary transition-colors hover:bg-primary-light"
                onMouseDown={(e) => {
                  e.preventDefault()
                  keepTyped()
                }}
              >
                <UserRoundPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Use “{query.trim()}” as the customer name
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

interface CustomerContextCardProps {
  partyName: string
  partyRef: string
  context: PartyContext | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

/**
 * What Inventory knows about the selected customer. Stock-side only: open
 * challan quantity and document history. Outstanding, credit limit and GSTIN
 * belong to Books and are not relayed to Inventory, so they are named as
 * unavailable rather than left as an empty figure a reader would trust.
 */
export function CustomerContextCard({ partyName, partyRef, context, loading, error, onRetry }: CustomerContextCardProps) {
  const chosen = Boolean(partyName.trim() || partyRef.trim())
  const ledgerId = Number(partyRef)
  const hasLedger = Number.isFinite(ledgerId) && ledgerId > 0

  if (!chosen) {
    return (
      <div className="mt-1.5 flex min-h-[3.25rem] items-center gap-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-2.5 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200">
          <Building2 className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-gray-600">No customer selected</span>
          <span className="block text-[10px] text-gray-400">Open challans and document history appear here once one is picked.</span>
        </span>
      </div>
    )
  }

  return (
    <div className="mt-1.5 flex min-h-[3.25rem] items-center gap-2.5 rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sky-600 ring-1 ring-sky-100">
        <Building2 className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[11px] font-semibold text-gray-900">{partyName || `Ledger #${partyRef}`}</span>
          {hasLedger ? <Badge tone="info" size="xs">#{ledgerId}</Badge> : <Badge tone="warning" size="xs">No ledger id</Badge>}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-gray-600" aria-live="polite">
          {!hasLedger ? (
            'Add the Books ledger id so the invoice can settle this challan automatically.'
          ) : loading ? (
            'Checking open challans…'
          ) : error ? (
            <span className="text-red-600">{error}</span>
          ) : context ? (
            <>
              {context.open_challan_documents > 0
                ? `${formatQty(context.open_challan_qty)} open on ${context.open_challan_documents} challan${context.open_challan_documents === 1 ? '' : 's'}`
                : 'Nothing open on challan'}
              {` · ${context.documents_on_record} document${context.documents_on_record === 1 ? '' : 's'} on record`}
              {context.last_document_date ? ` · last ${formatDate(context.last_document_date)}` : ''}
            </>
          ) : (
            '—'
          )}
        </div>
      </div>
      <div className="shrink-0">
        {error && hasLedger ? (
          <Button variant="ghost" size="xs" icon={RotateCcw} onClick={onRetry}>
            Retry
          </Button>
        ) : hasLedger ? (
          <Link
            to={`/registers/pending-quantities?party_ref=${ledgerId}&kind=challan&direction=out`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 no-underline hover:underline"
          >
            View details
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  )
}
