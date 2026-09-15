import { forwardRef } from 'react'
import type { FormEvent } from 'react'
import { Search, X } from 'lucide-react'
import { AIC, cx } from './cx'

export interface SearchBoxProps {
  value?: string
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  size?: 'sm' | 'md'
  /** Shortcut chip pinned inside the right edge, e.g. "/" or "Ctrl K". */
  kbd?: string
  className?: string
  autoFocus?: boolean
  name?: string
  'aria-label'?: string
}

/**
 * The search field every list page focuses with `/`. Controlled: the page owns
 * the value (usually in the URL via useListParams), this only renders it.
 */
export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  {
    value = '',
    onChange,
    onSubmit,
    placeholder = 'Search…',
    size = 'sm',
    kbd,
    className,
    autoFocus = false,
    name,
    'aria-label': ariaLabel,
  },
  ref,
) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSubmit?.(value)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cx(AIC, 'relative flex items-center', className)}
      role="search"
    >
      <Search
        className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        name={name}
        value={value}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cx(
          'block w-full bg-white rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30 text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none',
          size === 'md' ? 'h-9 text-sm' : 'h-8 text-sm',
          'pl-8',
          kbd ? 'pr-14' : value ? 'pr-8' : 'pr-3',
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange?.('')}
          className={cx(
            'absolute top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600',
            kbd ? 'right-9' : 'right-2',
          )}
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : null}
      {kbd ? (
        <span className="kbd absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
          {kbd}
        </span>
      ) : null}
    </form>
  )
})

export default SearchBox
