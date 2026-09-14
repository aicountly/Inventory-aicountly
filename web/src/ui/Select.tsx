import { forwardRef } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from './Input'
import { AIC, cx } from './cx'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md'
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size = 'sm', invalid = false, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        AIC,
        FIELD_BASE,
        invalid ? FIELD_INVALID : FIELD_OK,
        size === 'md' ? 'h-9 text-sm' : 'h-8 text-sm',
        'px-2.5',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
})

export default Select
