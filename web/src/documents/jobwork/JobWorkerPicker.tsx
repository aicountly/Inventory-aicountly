import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Check, ChevronDown, ExternalLink, Hash, Search, X } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'
import { formatDate, formatQty } from '../../utils/format'
import { filterJobWorkers, parseLedgerId } from './jobWorkers'
import type { JobWorkerOption } from './jobWorkers'

export interface JobWorkerValue {
  /** Books `acc_id`, as the header draft holds it (a string, possibly empty). */
  partyRef: string
  partyName: string
}

interface JobWorkerPickerProps {
  value: JobWorkerValue
  onChange: (patch: { party_ref?: string; party_name?: string }) => void
  options: JobWorkerOption[]
  loading?: boolean
  /** The directory could not be read (403); manual entry is the only route. */
  directoryUnavailable?: boolean
  disabled?: boolean
  invalid?: boolean
  id?: string
  inputRef?: RefObject<HTMLInputElement | null>
}

/**
 * Who the material is going to.
 *
 * A job worker is a Books ledger, so this never invents a master: it searches the ledgers this
 * company has already sent job work to (useJobWorkDirectory) and otherwise takes the `acc_id`
 * by hand, which is what `party_ref` has always been. Both routes write the same two payload
 * fields the API already accepts — `party_ref` and the `party_name` snapshot.
 */
export function JobWorkerPicker({
  value,
  onChange,
  options,
  loading = false,
  directoryUnavailable = false,
  disabled = false,
  invalid = false,
  id,
  inputRef,
}: JobWorkerPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [manual, setManual] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selectedRef = parseLedgerId(value.partyRef)
  const selected = useMemo(
    () => (selectedRef ? (options.find((o) => o.party_ref === selectedRef) ?? null) : null),
    [options, selectedRef],
  )

  const matches = useMemo(() => filterJobWorkers(options, query), [options, query])
  const typedLedger = parseLedgerId(query)
  const typedIsNew = typedLedger !== null && !options.some((o) => o.party_ref === typedLedger)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  const choose = (option: JobWorkerOption) => {
    onChange({ party_ref: String(option.party_ref), party_name: option.party_name ?? '' })
    setOpen(false)
    setQuery('')
  }

  const chooseLedgerId = (ref: number) => {
    // A ledger the directory has never seen: take the id, leave the name for the user. Books
    // owns the name and Inventory only ever stored a snapshot of it.
    onChange({ party_ref: String(ref) })
    setOpen(false)
    setQuery('')
    setManual(true)
  }

  const clear = () => {
    onChange({ party_ref: '', party_name: '' })
    setManual(false)
  }

  // ---- chosen ---------------------------------------------------------------------------

  if (selectedRef !== null) {
    return (
      <div className="flex flex-col gap-1.5">
        <div
          className={cx(
            'flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 min-h-[2.25rem]',
            invalid ? 'border-red-300' : 'border-gray-200',
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-light">
            <Building2 className="h-3.5 w-3.5 text-primary" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
            {value.partyName || selected?.party_name || `Ledger #${selectedRef}`}
          </span>
          <Badge tone="neutral" size="xs" className="shrink-0 normal-case tracking-normal">
            acc {selectedRef}
          </Badge>
          {!disabled ? (
            <Button variant="ghost" size="xs" icon={X} onClick={clear} aria-label="Change job worker" className="shrink-0" />
          ) : null}
        </div>

        {/* The name is a snapshot Inventory prints; Books owns the ledger itself. It stays
            editable because a document already posted must keep the name it was printed with. */}
        <Input
          id={id ? `${id}_name` : undefined}
          size="sm"
          value={value.partyName}
          disabled={disabled}
          placeholder="Job worker name as printed"
          aria-label="Job worker name as printed"
          onChange={(e) => onChange({ party_name: e.target.value })}
        />

        {selected ? (
          <p className="text-[11px] text-gray-500">
            {selected.pending_qty > 0 ? (
              <span className="font-medium text-amber-700">
                {formatQty(selected.pending_qty)} still open with this job worker
              </span>
            ) : (
              <span>Nothing open with this job worker</span>
            )}
            {selected.last_document_date ? ` · last job work ${formatDate(selected.last_document_date)}` : ''}
          </p>
        ) : manual ? (
          <p className="text-[11px] text-gray-500">
            Ledger #{selectedRef} is not in this company&rsquo;s job-work history yet. Check the id against Books before
            posting.
          </p>
        ) : null}
      </div>
    )
  }

  // ---- picking --------------------------------------------------------------------------

  const empty = !loading && matches.length === 0

  return (
    <div className="relative" ref={rootRef}>
      <Input
        id={id}
        ref={inputRef}
        size="md"
        leadingIcon={Search}
        value={query}
        disabled={disabled}
        invalid={invalid}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={loading ? 'Loading job workers…' : 'Search by name or ledger id'}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === 'ArrowDown') setOpen(true)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(matches.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter') {
            if (matches[active]) {
              e.preventDefault()
              choose(matches[active])
            } else if (typedLedger !== null) {
              e.preventDefault()
              chooseLedgerId(typedLedger)
            }
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-overlay">
          <ul className="scrollbar-thin max-h-64 overflow-y-auto py-1" id={listId} role="listbox" aria-label="Job workers">
            {loading ? <li className="px-3 py-2 text-xs text-gray-500">Loading job workers…</li> : null}

            {empty && !directoryUnavailable ? (
              <li className="px-3 py-2 text-xs text-gray-500">
                {options.length === 0
                  ? 'No job worker has been used yet. Enter the Books ledger id to start one.'
                  : 'No job worker matches that.'}
              </li>
            ) : null}

            {directoryUnavailable ? (
              <li className="px-3 py-2 text-xs text-gray-500">
                You cannot read job-work history, so the list is empty. Enter the Books ledger id instead.
              </li>
            ) : null}

            {matches.map((o, i) => (
              <li key={o.party_ref}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                    i === active ? 'bg-primary-light' : 'hover:bg-gray-50',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(o)
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {o.party_name ?? `Ledger #${o.party_ref}`}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                      acc {o.party_ref}
                      {o.last_document_date ? ` · last ${formatDate(o.last_document_date)}` : ''}
                      {o.documents > 0 ? ` · ${o.documents} document${o.documents === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  {o.pending_qty > 0 ? (
                    <Badge tone="warning" size="xs" className="shrink-0 normal-case tracking-normal">
                      {formatQty(o.pending_qty)} open
                    </Badge>
                  ) : null}
                  {selectedRef === o.party_ref ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-gray-100 bg-gray-50/70 px-2 py-1.5">
            {typedIsNew ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-primary transition-colors hover:bg-primary-light"
                onMouseDown={(e) => {
                  e.preventDefault()
                  chooseLedgerId(typedLedger)
                }}
              >
                <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Use Books ledger #{typedLedger}
              </button>
            ) : (
              <p className="px-2 py-1 text-[11px] leading-relaxed text-gray-500">
                Type a ledger id to use a job worker that is not on this list. The ledger master itself lives in Books.
              </p>
            )}
            <Link
              to="/registers/pending-quantities?kind=job_work"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 no-underline transition-colors hover:bg-gray-100 hover:text-gray-900"
              onMouseDown={() => setOpen(false)}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Open the job-work register
            </Link>
          </div>
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          aria-label="Show job workers"
          tabIndex={-1}
          disabled={disabled}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition-colors hover:text-gray-600"
          onClick={() => setOpen(true)}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export default JobWorkerPicker
