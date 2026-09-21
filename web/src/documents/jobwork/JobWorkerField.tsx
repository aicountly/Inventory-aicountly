import { useEffect, useId, useRef, useState } from 'react'
import { Boxes, Check, ExternalLink, Search, X } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { jobWorkApi } from '../../services/jobWorkApi'
import type { JobWorkerRow } from '../../services/jobWorkApi'
import { Badge } from '../../ui/Badge'
import { Spinner } from '../../ui/Spinner'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../../ui/Input'
import { formatDate, formatQty } from '../../utils/format'

export interface JobWorkerValue {
  /** Books ledger id (acc_id), as typed or picked. '' when unset. */
  partyRef: string
  partyName: string
}

export interface JobWorkerFieldProps {
  value: JobWorkerValue
  onChange: (value: JobWorkerValue) => void
  disabled?: boolean
  invalid?: boolean
  inputId: string
  /** Opens the ledger in Books; omitted when the host is unknown. */
  ledgerHref?: string | null
  autoFocus?: boolean
}

/**
 * Who the material is with.
 *
 * A job worker IS a Books ledger, and Books owns that master: nothing is
 * mirrored here. What the dropdown offers is the workers THIS company has
 * already raised job work for, read from Inventory's own documents
 * (`GET /v1/job-work/workers`) with what each of them is still holding — which
 * is the list an operator actually picks from, and it costs no call into
 * another product on a keystroke.
 *
 * A worker who has never been dealt with is not in that list and must not be:
 * typing the ledger id is the way in, exactly as it was before, and the
 * document carries the id plus the name snapshot either way.
 */
export function JobWorkerField({ value, onChange, disabled, invalid, inputId, ledgerHref, autoFocus }: JobWorkerFieldProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<JobWorkerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounce(query, 250)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    jobWorkApi
      .workers(debounced.trim(), 20, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        // A selector that cannot reach its suggestions still has to let the
        // ledger id be typed — that is the path for a first-time job worker.
        setRows([])
        setLoading(false)
      })
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

  const pick = (row: JobWorkerRow) => {
    onChange({ partyRef: String(row.party_ref), partyName: row.party_name ?? '' })
    setQuery('')
    setOpen(false)
  }

  const typedId = /^\d+$/.test(query.trim()) ? query.trim() : null
  const typedIdIsNew = typedId !== null && !rows.some((r) => String(r.party_ref) === typedId)
  const options: (JobWorkerRow | 'typed')[] = typedIdIsNew ? [...rows, 'typed'] : rows

  const commitTyped = () => {
    if (typedId === null) return
    onChange({ partyRef: typedId, partyName: value.partyName })
    setQuery('')
    setOpen(false)
  }

  if (value.partyRef !== '' && !open) {
    return (
      <div className={cx(AIC, 'flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 min-h-[2rem]')}>
        <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-900" title={value.partyName || `Ledger #${value.partyRef}`}>
          {value.partyName || `Ledger #${value.partyRef}`}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-gray-500">#{value.partyRef}</span>
        {ledgerHref ? (
          <a
            href={ledgerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded p-1 text-gray-400 hover:text-primary"
            title="Open this ledger in Smart Books"
            aria-label="Open this ledger in Smart Books"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
        {!disabled ? (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-gray-400 hover:text-red-600"
            onClick={() => {
              onChange({ partyRef: '', partyName: '' })
              setOpen(true)
            }}
            aria-label="Clear job worker"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      <input
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        value={query}
        placeholder="Search job worker or type a ledger id"
        className={cx(FIELD_BASE, invalid ? FIELD_INVALID : FIELD_OK, 'h-8 pl-8 pr-3 text-sm')}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(options.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter') {
            const chosen = options[active]
            if (!chosen) return
            e.preventDefault()
            if (chosen === 'typed') commitTyped()
            else pick(chosen)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Job workers"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-[20rem] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {loading && rows.length === 0 ? (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
              <Spinner /> Searching…
            </li>
          ) : null}
          {!loading && options.length === 0 ? (
            <li className="px-3 py-3 text-xs text-gray-500">
              No job worker matches. Type the Books ledger id to use a worker you have not sent material to before.
            </li>
          ) : null}
          {options.map((row, i) => {
            if (row === 'typed') {
              return (
                <li key="typed" role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={cx(
                      'flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-xs',
                      i === active ? 'bg-primary-light text-primary' : 'text-gray-600 hover:bg-gray-50',
                    )}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commitTyped()
                    }}
                  >
                    Use Books ledger <strong className="tabular-nums">#{typedId}</strong>
                  </button>
                </li>
              )
            }
            return (
              <li key={row.party_ref} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={cx(
                    'flex w-full flex-col gap-0.5 px-3 py-2 text-left',
                    i === active ? 'bg-primary-light' : 'hover:bg-gray-50',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(row)
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                      {row.party_name || `Ledger #${row.party_ref}`}
                    </span>
                    {row.open_qty > 0 ? (
                      <Badge tone="info" size="xs">
                        <Boxes className="h-3 w-3" aria-hidden />
                        {formatQty(row.open_qty)} open
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    #{row.party_ref}
                    {row.open_orders > 0 ? ` · ${row.open_orders} open job order${row.open_orders === 1 ? '' : 's'}` : ''}
                    {row.last_received_on ? ` · last inward ${formatDate(row.last_received_on)}` : row.last_sent_on ? ` · last sent ${formatDate(row.last_sent_on)}` : ''}
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
