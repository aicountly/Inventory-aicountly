import { useEffect, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  delayMs?: number
  autoFocus?: boolean
}

/** Text search box that reports its value after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder = 'Search…', delayMs = 350, autoFocus }: SearchInputProps) {
  const [draft, setDraft] = useState(value)
  const debounced = useDebounce(draft, delayMs)

  // External resets (e.g. "clear filters") flow back into the box.
  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (debounced !== value) onChange(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on the debounced value
  }, [debounced])

  return <input type="search" className="input search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} />
}
