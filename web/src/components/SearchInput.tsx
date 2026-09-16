import { forwardRef, useEffect, useState } from 'react'
import { useDebounce } from '../hooks/useDebounce'
import { SearchBox } from '../ui/SearchBox'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  delayMs?: number
  autoFocus?: boolean
  className?: string
  /** Matches the SearchBox sizes, for rows of `md` controls. */
  size?: 'sm' | 'md'
  'aria-label'?: string
}

/**
 * Text search box that reports its value after the user pauses typing.
 *
 * Same contract as before (debounced, resettable from outside); it now renders
 * the shared SearchBox, and forwards a ref so a page can hand it to
 * `usePageKeyboard({ searchInputRef })` and focus it with `/`.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder = 'Search…',
    delayMs = 350,
    autoFocus,
    className,
    size = 'sm',
    'aria-label': ariaLabel,
  },
  ref,
) {
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

  return (
    <SearchBox
      ref={ref}
      value={draft}
      onChange={setDraft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={className ?? 'w-full max-w-xs'}
      size={size}
      aria-label={ariaLabel}
      kbd="/"
    />
  )
})
