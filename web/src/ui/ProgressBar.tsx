import { AIC, cx } from './cx'

export interface ProgressBarProps {
  value?: number
  max?: number
  className?: string
  barClassName?: string
  indeterminate?: boolean
  size?: 'sm' | 'md' | 'lg'
  'aria-label'?: string
}

const HEIGHT = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' } as const

export function ProgressBar({
  value = 0,
  max = 100,
  className,
  barClassName,
  indeterminate = false,
  size = 'md',
  'aria-label': ariaLabel = 'Progress',
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const height = HEIGHT[size]
  return (
    <div
      className={cx(AIC, 'w-full overflow-hidden rounded-full bg-gray-200', height, className)}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div
        className={cx(
          height,
          'rounded-full bg-primary transition-[width] duration-300 ease-out',
          indeterminate && 'w-1/3 animate-pulse',
          barClassName,
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}

export default ProgressBar
