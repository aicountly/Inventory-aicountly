import type { ReactNode } from 'react'
import { FormField as SharedFormField } from '../ui/shell/FormSectionCard'

interface FormFieldProps {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  help?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Label + control + one message line. Delegates to the shared field so the
 * forms that already use it match the ported screens; `help` is the older
 * name for `hint`.
 */
export function FormField({ label, htmlFor, required, help, error, className, children }: FormFieldProps) {
  return (
    <SharedFormField
      label={label}
      htmlFor={htmlFor}
      required={required}
      hint={help}
      error={error}
      className={className}
    >
      {children}
    </SharedFormField>
  )
}
