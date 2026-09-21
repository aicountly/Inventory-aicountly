import { useEffect, useId, useRef, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { cx } from '../../ui/cx'
import { useDebounce } from '../../hooks/useDebounce'
import { isAbortError } from '../../services/api'
import { documentsApi } from '../../services/documentsApi'
import type { DocumentListRow } from '../types'
import { formatDate } from '../../utils/format'

export interface ReferenceNoFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  /**
   * An inventory document type code turns this into a typeahead over real
   * documents of that type; anything else (including `OTHER`) leaves it a plain
   * text box, because there is nothing in this database to look the number up in.
   */
  documentType: string | null
  disabled?: boolean
  placeholder?: string
}

/**
 * The reference this transfer was raised against.
 *
 * When the reference type names a document type Inventory holds, the number is
 * searched against the real register (`GET /v1/inventory-documents?q=`, which
 * matches document_no) so the operator picks an existing document rather than
 * retyping a number that may not exist. Free text stays allowed: a transfer is
 * often raised against a request slip or an email that is not in any system.
 */
export function ReferenceNoField({ id, value, onChange, documentType, disabled, placeholder }: ReferenceNoFieldProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DocumentListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounce(value, 300)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const searchable = Boolean(documentType)

  useEffect(() => {
    if (!open || !searchable) return undefined
    const controller = new AbortController()
    setLoading(true)
    documentsApi
      .list({ document_type: documentType as string, q: debounced.trim() || undefined, limit: 8, sort: 'document_date', order: 'desc' }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setRows(res.data)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        // A reference is a note, not a key. If the register cannot be searched
        // the field keeps working as free text rather than blocking the entry.
        setRows([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, searchable, documentType, debounced])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (row: DocumentListRow) => {
    onChange(row.document_no ?? String(row.document_id))
    setOpen(false)
  }

  return (
    <div className="relative" ref={rootRef} data-combo-open={open && rows.length > 0 ? 'true' : undefined}>
      <div className="relative">
        <FileText className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          id={id}
          className="aic block h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50"
          value={value}
          disabled={disabled}
          maxLength={64}
          autoComplete="off"
          placeholder={placeholder ?? (searchable ? 'Search or type a number…' : 'Enter reference number')}
          role={searchable ? 'combobox' : undefined}
          aria-expanded={searchable ? open : undefined}
          aria-controls={searchable ? listId : undefined}
          aria-autocomplete={searchable ? 'list' : undefined}
          onFocus={() => searchable && setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value)
            if (searchable) setOpen(true)
          }}
          onKeyDown={(e) => {
            if (!open || !searchable) return
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
        {loading ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" aria-hidden />
        ) : null}
      </div>

      {searchable && open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching documents"
          className="absolute left-0 right-0 z-40 mt-1 max-h-60 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-gray-500">
              {loading ? 'Searching…' : 'No matching document — the number you type is kept as free text.'}
            </li>
          ) : null}
          {rows.map((row, i) => (
            <li key={row.document_id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(row)
                }}
                className={cx('flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left', i === active ? 'bg-primary-light' : 'hover:bg-gray-50')}
              >
                <span className="truncate text-sm text-gray-900">{row.document_no ?? `#${row.document_id}`}</span>
                <span className="shrink-0 text-[11px] text-gray-400">{formatDate(row.document_date)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
