import type { ReactNode } from 'react'
import { AIC, cx } from '../cx'

export interface StickyActionBarProps {
  children?: ReactNode
  /** Left-hand totals (see ActionBarTotal). */
  totals?: ReactNode
  status?: ReactNode
  className?: string
  dense?: boolean
}

/**
 * The save/cancel bar pinned to the bottom of an entry form, with the running
 * totals on the left so the user never scrolls to check them.
 */
export function StickyActionBar({
  children,
  totals,
  status,
  className,
  dense = false,
}: StickyActionBarProps) {
  const isInline = Boolean(className?.includes('relative'))
  return (
    <div
      className={cx(
        AIC,
        'overflow-visible bg-white border-t border-gray-200 shadow-sticky px-3 md:px-4 -mx-3 md:-mx-5 print:hidden',
        dense ? 'py-1.5' : 'py-2.5',
        isInline ? 'relative shrink-0 mt-4' : 'sticky bottom-0 left-0 right-0 z-20 mt-auto shrink-0',
        className,
      )}
    >
      <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center flex-wrap gap-3 text-sm text-gray-700 min-w-0">
          {status ? <div className="shrink-0">{status}</div> : null}
          {totals ? <div className="flex items-center flex-wrap gap-3">{totals}</div> : null}
        </div>
        <div className="flex items-center flex-wrap gap-2 ml-auto">{children}</div>
      </div>
    </div>
  )
}

const TONE_CLS = {
  neutral: 'text-gray-900',
  primary: 'text-primary',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-600',
} as const

export interface ActionBarTotalProps {
  label: ReactNode
  value: ReactNode
  subValue?: ReactNode
  tone?: keyof typeof TONE_CLS
  className?: string
  onClick?: () => void
  title?: string
}

export function ActionBarTotal({
  label,
  value,
  subValue,
  tone = 'neutral',
  className,
  onClick,
  title,
}: ActionBarTotalProps) {
  const interactive = Boolean(onClick)
  const content = (
    <>
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
        {label}
      </span>
      <span className={cx('text-sm font-bold tabular-nums', TONE_CLS[tone])}>{value}</span>
      {subValue ? (
        <span className="text-[10px] text-gray-500 tabular-nums font-medium">{subValue}</span>
      ) : null}
    </>
  )
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cx(
          AIC,
          'flex flex-col cursor-pointer rounded-lg px-2 -mx-2 py-0.5 hover:bg-gray-50 transition-colors text-left',
          className,
        )}
      >
        {content}
      </button>
    )
  }
  return (
    <div title={title} className={cx(AIC, 'flex flex-col', className)}>
      {content}
    </div>
  )
}

export default StickyActionBar
