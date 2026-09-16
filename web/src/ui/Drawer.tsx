import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useModalKeyboard } from '../keyboard/useModalKeyboard'
import { AIC, cx } from './cx'

/**
 * A panel that comes in from the right.
 *
 * The same contract as `Modal` — backdrop dismiss, Escape, the focus trap
 * `aria-modal` promises, focus returned on close, and the scroll lock applied
 * to `.app-main` rather than `body` because that is the element the shell
 * actually scrolls. It differs only in where it sits and how it arrives.
 *
 * Use it where a `Modal` would cover the thing being explained: a reference
 * panel read *against* the register behind it wants the register still visible,
 * which a centred dialog does not allow.
 */
export interface DrawerProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Icon shown beside the title. */
  icon?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const SIZE: Record<NonNullable<DrawerProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  icon,
  size = 'md',
}: DrawerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useModalKeyboard(open, onClose, panelRef)

  useEffect(() => {
    if (!open) return undefined
    const scroller = document.querySelector<HTMLElement>('.app-main') ?? document.body
    const previousOverflow = scroller.style.overflow
    scroller.style.overflow = 'hidden'
    return () => {
      scroller.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={cx(
        AIC,
        'fixed inset-0 z-[90] flex justify-end bg-gray-900/40 backdrop-blur-sm print:hidden',
      )}
      data-keyboard-overlay="true"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cx(
          'flex h-full w-full flex-col overflow-hidden bg-white shadow-overlay',
          // theme/primitives.css cancels this under prefers-reduced-motion,
          // so the panel still appears — it just does not travel.
          'animate-slide-in-right',
          SIZE[size],
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-keyboard-overlay="true"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-gray-900">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-0.5 text-xs text-gray-500">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            data-modal-close
            className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 bg-gray-50/40 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Drawer
