import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'

export interface ReasonCodeOption {
  code: string
  label: string
}

/**
 * Common reason codes offered as quick picks. `reason_code` is a free-text column
 * (`inv_documents.reason_code`, VARCHAR(32)) with no master/API behind it today, so this list is a
 * client-side convenience, not a value the field is restricted to — any text the user types is
 * accepted exactly as it would be for a plain input.
 */
export const REASON_CODE_SUGGESTIONS: ReasonCodeOption[] = [
  { code: 'PRODUCTION', label: 'Consumed into a production run' },
  { code: 'SAMPLE', label: 'Customer or internal sample' },
  { code: 'DAMAGE', label: 'Damaged in handling or storage' },
  { code: 'INTERNAL_USE', label: 'Internal / office use' },
  { code: 'MAINTENANCE', label: 'Machine or equipment maintenance' },
  { code: 'WASTAGE', label: 'Process loss or spoilage' },
  { code: 'SCRAP', label: 'Scrapped material' },
  { code: 'QC_TESTING', label: 'Used in quality testing' },
  { code: 'PROMOTIONAL', label: 'Marketing / promotional giveaway' },
  { code: 'OTHER', label: 'Other' },
]

interface ReasonCodeComboboxProps {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
}

export function ReasonCodeCombobox({ id, value, onChange, disabled, invalid }: ReasonCodeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const q = value.trim().toLowerCase()
  const options = q ? REASON_CODE_SUGGESTIONS.filter((o) => o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : REASON_CODE_SUGGESTIONS

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
  }

  return (
    <div className="relative" ref={rootRef}>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        invalid={invalid}
        maxLength={32}
        placeholder="e.g. DAMAGE"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase())
          setActive(0)
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
          } else if (e.key === 'Enter' && options[active]) {
            e.preventDefault()
            pick(options[active].code)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && options.length > 0 ? (
        <ul id={listId} role="listbox" className="aic absolute z-20 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-overlay">
          {options.map((o, i) => (
            <li
              key={o.code}
              role="option"
              aria-selected={i === active}
              className={cx('cursor-pointer px-3 py-1.5 text-xs', i === active ? 'bg-primary-light text-primary' : 'text-gray-700 hover:bg-gray-50')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o.code)
              }}
            >
              <span className="font-semibold">{o.code}</span>
              <span className="ml-1.5 text-gray-500">{o.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default ReasonCodeCombobox
