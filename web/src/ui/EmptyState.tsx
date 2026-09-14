import { Inbox } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { AIC, cx } from './cx'

/**
 * "Nothing here, and here is why" — never a bare dash.
 *
 * Shared file: `size="sm"` and `compact` mean the same thing and both are
 * accepted, so markup ported from Books and markup written here both compile.
 */
export interface EmptyStateProps {
  icon?: LucideIcon
  title?: ReactNode
  description?: ReactNode
  /** A node renders as-is; a string becomes a primary button. */
  action?: ReactNode
  onAction?: () => void
  className?: string
  size?: 'sm' | 'md'
  /** Alias of `size="sm"`. */
  compact?: boolean
}

export function EmptyState({
  icon: Icon = Inbox,
  title = 'Nothing here yet',
  description,
  action,
  onAction,
  className,
  size = 'md',
  compact = false,
}: EmptyStateProps) {
  const small = compact || size === 'sm'
  return (
    <div
      className={cx(
        AIC,
        'flex flex-col items-center justify-center text-center',
        small ? 'py-8 px-4' : 'py-14 px-6',
        className,
      )}
    >
      <span className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-primary" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {description ? (
        <p className="text-xs text-gray-500 mt-1 max-w-sm leading-relaxed">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-4">
          {typeof action === 'string' ? <Button onClick={onAction}>{action}</Button> : action}
        </div>
      ) : null}
    </div>
  )
}

export default EmptyState
