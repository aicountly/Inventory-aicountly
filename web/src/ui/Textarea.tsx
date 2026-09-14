import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import { FIELD_BASE, FIELD_INVALID, FIELD_OK } from './Input'
import { AIC, cx } from './cx'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  monospace?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, rows = 3, monospace = false, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(
        AIC,
        FIELD_BASE,
        invalid ? FIELD_INVALID : FIELD_OK,
        monospace ? 'font-mono text-xs' : 'text-sm',
        'px-3 py-2 resize-y',
        className,
      )}
      {...rest}
    />
  )
})

export default Textarea
