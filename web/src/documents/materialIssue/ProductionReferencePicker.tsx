import { useEffect, useId, useRef, useState } from 'react'
import { Factory } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage, isAbortError } from '../../services/api'
import { Input } from '../../ui'
import { AIC, cx } from '../../ui/cx'
import { formatDate } from '../../utils/format'
import type { DocumentListRow } from '../types'
import { searchProductionDocuments } from './materialIssueApi'

export interface ProductionReferencePickerProps {
  /** The reference number as typed or as picked. */
  value: string
  /** Set when the number came from a real production document. */
  documentId: number | null
  onChange: (next: { referenceNo: string; documentId: number | null }) => void
  disabled?: boolean
  id?: string
}

/**
 * The production document this issue feeds.
 *
 * It searches Inventory's own posted PRODUCTION documents — this product's
 * register, read live. If a separate Aicountly manufacturing product ever owns
 * work orders, it gets its own live API beside this one; Inventory does not
 * keep a copy of anybody else's work-order table.
 *
 * The field stays typeable: a reference that is not an Inventory production
 * document (a customer's order number, a paper works order) is still a valid
 * thing to write down, and refusing it would make the mode unusable.
 */
export function ProductionReferencePicker({ value, documentId, onChange, disabled, id }: ProductionReferencePickerProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DocumentListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const debounced = useDebounce(value, 300)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    searchProductionDocuments(debounced, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return
        setRows(found)
        setActive(0)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setRows([])
        setError(errorMessage(err, 'Production documents could not be read.'))
        setLoading(false)
      })
    return () => controller.abort()
  }, [debounced, open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (row: DocumentListRow) => {
    onChange({ referenceNo: row.document_no ?? `#${row.document_id}`, documentId: row.document_id })
    setOpen(false)
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <Input
        id={id}
        size="md"
        leadingIcon={Factory}
        value={value}
        placeholder="Search a posted production document…"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          // Typing past a picked document unlinks it: the id must never outlive
          // the number the user can see.
          onChange({ referenceNo: e.target.value, documentId: null })
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
      {documentId !== null ? (
        <p className="mt-1 text-[11px] font-medium text-emerald-700">Linked to production document #{documentId}.</p>
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {error ? <li className="px-3 py-2 text-xs text-red-600">{error}</li> : null}
          {!error && rows.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">{loading ? 'Searching…' : 'No posted production documents match.'}</li>
          ) : null}
          {rows.map((row, i) => (
            <li
              key={row.document_id}
              role="option"
              aria-selected={i === active}
              className={cx('cursor-pointer px-3 py-2 text-xs', i === active ? 'bg-primary-light/60' : 'hover:bg-gray-50')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(row)
              }}
            >
              <span className="block font-medium text-gray-900">{row.document_no ?? `#${row.document_id}`}</span>
              <span className="block text-gray-500">
                {formatDate(row.document_date)} · {row.line_count} line{Number(row.line_count) === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default ProductionReferencePicker
