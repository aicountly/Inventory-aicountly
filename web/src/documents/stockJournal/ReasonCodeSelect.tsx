import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from '../../ui/Input'
import { STOCK_JOURNAL_REASONS, reasonFor } from './model'

interface ReasonCodeSelectProps {
  value: string
  onChange: (code: string) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
}

/**
 * Reason code for the adjustment.
 *
 * A combobox rather than a `<select>` because `reason_code` is an open 32-char
 * column, not an enum: the catalogue covers what a stock journal normally books,
 * and anything already on a posted document — or any code a company has agreed
 * internally — still types straight in and round-trips unchanged.
 */
export function ReasonCodeSelect({ value, onChange, id, disabled, invalid }: ReasonCodeSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const known = reasonFor(value)
  const text = open ? query : known ? known.label : value

  const matches = STOCK_JOURNAL_REASONS.filter((r) => {
    const q = query.trim().toLowerCase()
    if (!q || !open) return true
    return r.label.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
  })

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const commit = (code: string) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={cx(AIC, 'relative')} ref={rootRef}>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          className={cx(FIELD_BASE, invalid ? FIELD_INVALID : FIELD_OK, 'h-9 pl-3 pr-8 text-sm')}
          placeholder="Select reason"
          value={text}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            // Typing is committing: an unknown code is a legal reason code.
            onChange(e.target.value.toUpperCase().slice(0, 32))
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(matches.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && open && matches[active]) {
              e.preventDefault()
              commit(matches[active].code)
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Reason code"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">
              No standard reason matches. &ldquo;{value}&rdquo; will be saved as typed.
            </li>
          ) : null}
          {matches.map((r, i) => {
            const selected = value.trim().toUpperCase() === r.code
            return (
              <li key={r.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(r.code)
                  }}
                  className={cx(
                    'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
                    i === active ? 'bg-primary-light/60' : 'hover:bg-gray-50',
                  )}
                >
                  <Check className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-primary' : 'text-transparent')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-gray-900">{r.label}</span>
                    <span className="block text-[11px] text-gray-500">{r.hint}</span>
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
