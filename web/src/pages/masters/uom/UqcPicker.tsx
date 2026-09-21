import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Input } from '../../../ui/Input'
import { AIC, cx } from '../../../ui/cx'
import type { UqcOption } from '../../../services/uomApi'

/**
 * The GST unit quantity code field.
 *
 * A free-text box was the old behaviour and it is the wrong control for this
 * value: there are exactly forty-four codes, a return rejects anything else,
 * and "KILOS" typed into a box is only discovered to be wrong at filing time.
 * So it is a combobox over the catalogue the API serves — type to narrow, arrow
 * to choose — that still keeps the field optional and clearable.
 *
 * It degrades rather than blocks. If the catalogue could not be read (offline,
 * or a profile the endpoint refuses) the control falls back to exactly the free
 * text box it replaced, and the form validates the shape instead of the value.
 * A field that cannot be filled because a lookup failed is worse than one that
 * is merely less helpful for a moment.
 */

export interface UqcPickerProps {
  id: string
  value: string
  onChange: (code: string) => void
  options: readonly UqcOption[]
  /** Catalogue still loading, or unavailable: fall back to free text. */
  fallback?: boolean
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
}

export function UqcPicker({
  id,
  value,
  onChange,
  options,
  fallback = false,
  invalid = false,
  describedBy,
  disabled = false,
}: UqcPickerProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = useMemo(
    () => options.find((o) => o.code === value.trim().toUpperCase()) ?? null,
    [options, value],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return options
    return options.filter((o) => o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    setActive(0)
  }, [query, open])

  // Close on a click that lands outside — a combobox left open over the rest of
  // the form swallows the next field's click.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (fallback) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="KGS"
        maxLength={16}
        invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        className="uppercase"
      />
    )
  }

  const choose = (code: string) => {
    onChange(code)
    setQuery('')
    setOpen(false)
  }

  const display = open ? query : selected ? `${selected.code} — ${selected.label}` : value

  return (
    <div ref={wrapRef} className={cx(AIC, 'relative')}>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].code}` : undefined}
        autoComplete="off"
        value={display}
        invalid={invalid}
        disabled={disabled}
        aria-describedby={describedBy}
        placeholder="Search a code — KGS, NOS, LTR…"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          // Typing past a chosen code clears it: the field must never show one
          // code while holding another.
          if (value !== '') onChange('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault()
            choose(matches[active].code)
          } else if (e.key === 'Escape' && open) {
            // Swallowed so the drawer stays open: the first Escape closes the
            // list the reader is looking at, not the form behind it.
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
            setQuery('')
          }
        }}
        className="pr-14"
      />

      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              setQuery('')
            }}
            disabled={disabled}
            aria-label="Clear GST UQC"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <span className="inline-flex h-6 w-6 items-center justify-center text-gray-400" aria-hidden>
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="GST unit quantity codes"
          className="scrollbar-thin absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">
              No code matches “{query}”. The GST schema has 44 codes; leave the field blank if none fits.
            </li>
          ) : (
            matches.map((option, index) => {
              const isActive = index === active
              const isSelected = option.code === value
              return (
                <li key={option.code}>
                  <button
                    type="button"
                    id={`${listId}-${option.code}`}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isActive || undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option.code)}
                    className={cx(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                      isActive ? 'bg-primary-light text-primary' : 'text-gray-700',
                    )}
                  >
                    <span className="w-9 shrink-0 font-semibold tabular-nums">{option.code}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-500">{option.label}</span>
                    {isSelected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}

export default UqcPicker
