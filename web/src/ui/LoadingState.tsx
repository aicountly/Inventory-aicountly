import { Skeleton } from './Skeleton'
import { Spinner } from './Spinner'
import { cx } from './cx'

export type LoadingVariant = 'spinner' | 'skeleton' | 'cards'

export interface LoadingStateProps {
  variant?: LoadingVariant
  rows?: number
  label?: string
  className?: string
}

export function LoadingState({
  variant = 'spinner',
  rows = 6,
  label = 'Loading…',
  className,
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div className={cx('space-y-2', className)} role="status" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height="h-9" />
        ))}
      </div>
    )
  }
  if (variant === 'cards') {
    return (
      <div
        className={cx('grid gap-3 grid-cols-2 md:grid-cols-4', className)}
        role="status"
        aria-label={label}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height="h-24" rounded="xl" />
        ))}
      </div>
    )
  }
  return (
    <div
      className={cx('flex items-center justify-center gap-3 py-10 text-sm text-gray-500', className)}
      role="status"
    >
      <Spinner size="md" />
      <span>{label}</span>
    </div>
  )
}

export default LoadingState
