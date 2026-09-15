import { AIC, cx } from './cx'

/**
 * Shape-preserving loading placeholders.
 *
 * A screen that shows the word "Loading…" tells the user nothing and makes the
 * page jump when data lands. Compose these so the placeholder has the same
 * geometry as the real widget and the layout is stable from first paint.
 *
 * NOTE: this file is shared between the design-system port and the dashboard
 * work, so the props are a deliberate superset — `className` alone, or the
 * `height` / `rounded` shorthands. Add to it; do not narrow it.
 */
export interface SkeletonProps {
  className?: string
  /** Shorthand for a height utility, e.g. `h-9`. */
  height?: string
  rounded?: 'none' | 'md' | 'lg' | 'xl' | 'full'
}

const ROUND: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  none: '',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
}

export function Skeleton({ className, height, rounded = 'lg' }: SkeletonProps) {
  return <div aria-hidden className={cx(AIC, 'skeleton', ROUND[rounded], height, className)} />
}

/** A KPI-card sized block. */
export function SkeletonCard({ className = 'h-[110px]', height, rounded = 'xl' }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx(AIC, 'skeleton border border-gray-100', ROUND[rounded], height, className)}
    />
  )
}

/** `rows` shimmering lines — stands in for a small table. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cx(AIC, 'space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="skeleton h-3 flex-1 rounded" />
          <div className="skeleton h-3 w-14 rounded" />
        </div>
      ))}
    </div>
  )
}

export default Skeleton
