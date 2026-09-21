import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { AIC, cx } from '../../ui/cx'

interface DirectionSelectProps {
  value: 'in' | 'out' | null
  onChange: (direction: 'in' | 'out' | null) => void
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
}

/**
 * In / Out for one line.
 *
 * Green and red carry the meaning fastest for the people who use this screen all
 * day, but they are never the only carrier: the word is spelled out and an arrow
 * points the way, so the column still reads on a monochrome print, for a
 * colour-blind reader, and in a screen reader.
 */
export function DirectionSelect({ value, onChange, disabled, invalid, 'aria-label': ariaLabel = 'Direction' }: DirectionSelectProps) {
  const tone =
    value === 'in'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 focus:border-emerald-400 focus:ring-emerald-200'
      : value === 'out'
        ? 'border-red-200 bg-red-50 text-red-700 focus:border-red-400 focus:ring-red-200'
        : 'border-gray-200 bg-white text-gray-600 focus:border-primary focus:ring-primary/30'
  const Icon = value === 'in' ? ArrowDownLeft : value === 'out' ? ArrowUpRight : null

  return (
    <div className={cx(AIC, 'relative')}>
      {Icon ? <Icon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" aria-hidden /> : null}
      <select
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === 'in' ? 'in' : e.target.value === 'out' ? 'out' : null)}
        className={cx(
          'h-8 w-full appearance-none rounded-lg border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 disabled:opacity-60',
          Icon ? 'pl-7 pr-2' : 'px-2',
          invalid ? 'border-red-300 bg-red-50 text-red-700' : tone,
        )}
      >
        <option value="">—</option>
        <option value="in">In</option>
        <option value="out">Out</option>
      </select>
    </div>
  )
}
