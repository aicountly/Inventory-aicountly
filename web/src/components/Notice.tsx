import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../ui/cx'

export type NoticeKind = 'error' | 'warning' | 'success' | 'info'

interface NoticeProps {
  kind?: NoticeKind
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  /** Renders a trailing close button; the caller owns whether the notice stays dismissed. */
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

const ROLE: Record<NoticeKind, 'alert' | 'status'> = {
  error: 'alert',
  warning: 'status',
  success: 'status',
  info: 'status',
}

/**
 * Tone classes live in theme/primitives.css rather than as Tailwind tints:
 * the dark-mode retrofit layer remaps the grey text utilities, which would
 * otherwise put light text on a pale banner. `currentColor` keeps the icon and
 * the title in step with the body text in both modes.
 */
const STYLE: Record<NoticeKind, { box: string; icon: LucideIcon }> = {
  error: { box: 'aic-notice-error', icon: AlertCircle },
  warning: { box: 'aic-notice-warning', icon: AlertTriangle },
  success: { box: 'aic-notice-success', icon: CheckCircle2 },
  info: { box: 'aic-notice-info', icon: Info },
}

/**
 * Inline banner. Re-skinned onto the Books design language in place, keeping
 * its props exactly, so all ~25 screens that already render one pick up the
 * new look without an edit.
 */
export function Notice({ kind = 'info', title, children, actions, onDismiss, dismissLabel = 'Dismiss', className }: NoticeProps) {
  const style = STYLE[kind]
  const Icon = style.icon
  return (
    <div
      className={cx(
        AIC,
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm',
        style.box,
        className,
      )}
      role={ROLE[kind]}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <div className="min-w-0 flex-1 leading-snug">
        {title ? <span className="mr-1.5 font-semibold">{title}</span> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
