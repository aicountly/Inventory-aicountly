import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { AIC, cx } from './cx'

export interface ErrorStateProps {
  title?: ReactNode
  description?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  className?: string
  size?: 'sm' | 'md'
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Retry',
  className,
  size = 'md',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx(
        AIC,
        'bg-white rounded-xl border border-red-100 text-center',
        size === 'sm' ? 'p-4' : 'p-6',
        className,
      )}
    >
      <span className="inline-flex w-12 h-12 rounded-2xl bg-red-50 items-center justify-center mb-3">
        <AlertTriangle className="w-6 h-6 text-red-600" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {description ? (
        <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto leading-relaxed">{description}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" icon={RefreshCw} onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default ErrorState
