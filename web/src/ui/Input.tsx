import { forwardRef } from 'react'
import type { InputHTMLAttributes, MouseEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { openNativePicker } from './openNativePicker'
import { AIC, cx } from './cx'

export type InputSize = 'sm' | 'md'

/** `size` is Omitted: the DOM attribute is a number and collides. */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize
  invalid?: boolean
  leadingIcon?: LucideIcon
  trailingIcon?: LucideIcon
  /** Applied to the wrapper when an icon is present, to the input otherwise. */
  className?: string
}

const SIZE: Record<InputSize, string> = { sm: 'h-8 text-sm', md: 'h-9 text-sm' }

export const FIELD_OK =
  'border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30'
export const FIELD_INVALID =
  'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-300/40'
export const FIELD_BASE =
  'block w-full bg-white rounded-lg border text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    size = 'sm',
    invalid = false,
    leadingIcon: LeadingIcon,
    trailingIcon: TrailingIcon,
    type = 'text',
    onClick,
    ...rest
  },
  ref,
) {
  const padCls = LeadingIcon ? 'pl-8 pr-3' : TrailingIcon ? 'pl-3 pr-8' : 'px-3'
  const stateCls = invalid ? FIELD_INVALID : FIELD_OK
  const handleClick =
    type === 'date' || type === 'month' || type === 'time'
      ? (e: MouseEvent<HTMLInputElement>) => {
          openNativePicker(e.currentTarget)
          onClick?.(e)
        }
      : onClick

  const input = (
    <input
      ref={ref}
      type={type}
      onClick={handleClick}
      aria-invalid={invalid || undefined}
      className={cx(AIC, FIELD_BASE, stateCls, SIZE[size], padCls, !LeadingIcon && !TrailingIcon && className)}
      {...rest}
    />
  )

  if (!LeadingIcon && !TrailingIcon) return input

  return (
    <div className={cx(AIC, 'relative', className)}>
      {LeadingIcon ? (
        <LeadingIcon
          className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          aria-hidden
        />
      ) : null}
      {input}
      {TrailingIcon ? (
        <TrailingIcon
          className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          aria-hidden
        />
      ) : null}
    </div>
  )
})

export default Input
