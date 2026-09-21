import type { ReactNode } from 'react'
import { AIC, cx } from './cx'

export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  title?: string
}

export interface SegmentedControlProps<V extends string> {
  label?: ReactNode
  value: V
  onChange?: (value: V) => void
  options: readonly SegmentedOption<V>[]
  className?: string
  size?: 'sm' | 'md'
  /**
   * Names the group for assistive technology when no visible `label` is drawn.
   * A bare row of tabs otherwise announces as an unnamed tablist.
   */
  'aria-label'?: string
}

/**
 * Two-to-four mutually exclusive choices (All / Open / Closed, By voucher / By
 * line). Generic over the value union so a caller's `onChange` receives the
 * narrowed literal type, not `string`.
 */
export function SegmentedControl<V extends string>({
  label,
  value,
  onChange,
  options,
  className,
  size = 'sm',
  'aria-label': ariaLabel,
}: SegmentedControlProps<V>) {
  return (
    <div className={cx(AIC, 'inline-flex flex-col gap-1', className)}>
      {label ? (
        <span className="text-label-xs font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
      ) : null}
      <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5" role="tablist" aria-label={ariaLabel}>
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              title={opt.title}
              onClick={() => {
                if (!active) onChange?.(opt.value)
              }}
              aria-selected={active}
              className={cx(
                'rounded-md font-medium whitespace-nowrap transition-colors',
                size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
                active ? 'bg-white shadow-sm text-primary' : 'text-gray-600 hover:text-gray-800',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default SegmentedControl
