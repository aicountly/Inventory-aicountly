import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '../Card'
import type { CardPadding } from '../Card'
import { AIC, cx } from '../cx'

export interface FormSectionCardProps {
  title?: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  children?: ReactNode
  className?: string
  padding?: CardPadding
  bodyClassName?: string
}

/** A titled group of fields — the building block of every entry form. */
export function FormSectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  padding = 'md',
  bodyClassName,
}: FormSectionCardProps) {
  const hasHeader = Boolean(title || description || action || Icon)
  return (
    <Card padding={padding} className={className}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3 border-b border-gray-100 pb-3">
          {/* `basis-56` with wrap: the action row drops to a line of its own
              rather than squeezing the heading into a column of single words. */}
          <div className="flex items-start gap-3 min-w-0 flex-1 basis-56">
            {Icon ? (
              <span className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" aria-hidden />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? (
                <h3 className="text-sm font-semibold text-gray-900 truncate">{title}</h3>
              ) : null}
              {description ? <p className="text-xs text-gray-500 mt-0.5">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </Card>
  )
}

const COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
} as const

const GAPS = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' } as const

export interface FormGridProps {
  cols?: keyof typeof COLS
  gap?: keyof typeof GAPS
  className?: string
  children?: ReactNode
}

export function FormGrid({ cols = 2, gap = 'md', className, children }: FormGridProps) {
  return <div className={cx(AIC, 'grid', COLS[cols], GAPS[gap], className)}>{children}</div>
}

export interface FormFieldProps {
  label?: ReactNode
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children?: ReactNode
}

/**
 * Label + control + one message line.
 *
 * Note the name clash with the legacy `src/components/FormField.tsx`: this is
 * the Books-language one. Import it from `ui/shell`; the legacy file goes when
 * the last form that uses it is converted.
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cx(AIC, 'flex flex-col gap-1', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
        >
          {label}
          {required ? (
            <span className="text-red-500 ml-0.5" aria-hidden>
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11px] text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-gray-500">{hint}</p>
      ) : null}
    </div>
  )
}

export default FormSectionCard
