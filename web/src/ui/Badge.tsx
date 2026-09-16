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
  | 'violet'
  | 'teal'
  | 'indigo'

export type BadgeSize = 'xs' | 'sm'

const TONE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  primary: 'bg-primary-light text-primary border-primary/20',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  beta: 'bg-violet-50 text-violet-700 border-violet-200',
  // `beta` is the same violet under a name that means "this feature is new".
  // A badge that colours an *event type* needs the colour without the claim,
  // so the palette tones are spelled out beside it rather than borrowed.
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
}

const SIZE_STYLES: Record<BadgeSize, string> = {
  xs: 'text-[10px] px-1.5 py-0.5',
  sm: 'text-[11px] px-2 py-0.5',
}

export interface BadgeProps {
  tone?: BadgeTone
  size?: BadgeSize
  /**
   * A filled dot in the badge's own colour, before the text.
   *
   * For a status a reader scans down a column rather than reads: the dot is
   * the same shape in every row, so the eye finds the odd one out by colour
   * before it reads a word. Decoration, so it is hidden from assistive
   * technology — the word beside it is the status.
   */
  dot?: boolean
  className?: string
  children?: ReactNode
}

export function Badge({ tone = 'neutral', size = 'sm', dot = false, className, children }: BadgeProps) {
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
      {dot ? (
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current"
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  )
}


export default Badge
