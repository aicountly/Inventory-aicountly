import type { ReactNode } from 'react'

interface FormFieldProps {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  help?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}

export function FormField({ label, htmlFor, required, help, error, className, children }: FormFieldProps) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field-required" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? <span className="field-error">{error}</span> : help ? <span className="field-help">{help}</span> : null}
    </div>
  )
}
