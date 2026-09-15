import type { ReactNode } from 'react'
import { Card } from '../Card'
import { AIC, cx } from '../cx'

export interface FilterBarProps {
  children?: ReactNode
  /** Right-aligned slot: export, column config, view switches. */
  actions?: ReactNode
  className?: string
  compact?: boolean
}

/** The pinned filter card above a list. Always `print:hidden`. */
export function FilterBar({ children, actions, className, compact = false }: FilterBarProps) {
  return (
    <Card
      padding="none"
      className={cx(
        'flex flex-wrap items-center gap-2 print:hidden shrink-0',
        compact ? 'px-3 py-2' : 'px-3 py-2.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">{children}</div>
      {actions ? <div className="flex flex-wrap items-center gap-2 ml-auto">{actions}</div> : null}
    </Card>
  )
}

export interface FilterFieldProps {
  label: ReactNode
  children: ReactNode
  className?: string
  /** Stack the label above the control instead of beside it. */
  stacked?: boolean
}

export function FilterField({ label, children, className, stacked = false }: FilterFieldProps) {
  return (
    <label
      className={cx(
        AIC,
        'text-xs text-gray-500',
        stacked ? 'flex flex-col gap-1' : 'flex items-center gap-2',
        className,
      )}
    >
      <span className="font-medium uppercase tracking-wide whitespace-nowrap">{label}</span>
      {children}
    </label>
  )
}

export default FilterBar
