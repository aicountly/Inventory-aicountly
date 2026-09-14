import type { ReactNode } from 'react'
import { AIC, cx } from './cx'

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'beta'

export type BadgeSize = 'xs' | 'sm'

const TONE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  primary: 'bg-primary-light text-primary border-primary/20',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  beta: 'bg-violet-50 text-violet-700 border-violet-200',
}

const SIZE_STYLES: Record<BadgeSize, string> = {
  xs: 'text-[10px] px-1.5 py-0.5',
  sm: 'text-[11px] px-2 py-0.5',
}

export interface BadgeProps {
  tone?: BadgeTone
  size?: BadgeSize
  className?: string
  children?: ReactNode
}

export function Badge({ tone = 'neutral', size = 'sm', className, children }: BadgeProps) {
  return (
    <span
      className={cx(
        AIC,
        'inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide whitespace-nowrap',
        TONE_STYLES[tone],
        SIZE_STYLES[size],
        className,
      )}
    >
      {children}
    </span>
  )
}


export default Badge
