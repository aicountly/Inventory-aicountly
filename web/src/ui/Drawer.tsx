import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useModalKeyboard } from '../keyboard/useModalKeyboard'
import { Button } from './Button'
import { cx } from './cx'

export type DrawerWidth = 'md' | 'lg' | 'xl'

const WIDTH: Record<DrawerWidth, string> = {
  md: 'w-[min(32rem,92vw)]',
  lg: 'w-[min(40rem,92vw)]',
  xl: 'w-[min(52rem,94vw)]',
}

export interface DrawerProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** Beside the title — a status chip, a record reference. */
  badge?: ReactNode
  /** Under the title, one line. */
  description?: ReactNode
  /** Pinned below the scrolling body. */
  footer?: ReactNode
  width?: DrawerWidth
  className?: string
}

/**
 * The right-hand inspector: a record opened beside the list instead of on top
 * of it.
 *
 * A drawer rather than a Modal because the two answer different questions. A
 * modal interrupts — it asks something and will not let the page continue until
 * it is answered. An inspector is read *against* the list it came from, and the
 * rows staying visible at the left edge is the point: a reader comparing two
 * audit events should not have to close one to see where the other sat.
 *
 * The behaviour is the dialog's, though, and it comes from the same hook Modal
 * uses — Escape closes, Tab is trapped inside the panel, focus lands on the
 * first real control rather than the close button and returns to whatever
 * opened the drawer. `aria-modal` promises that trap, so it is not optional.
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
  badge,
  description,
  footer,
  width = 'lg',
  className,
}: DrawerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useModalKeyboard(open, onClose, panelRef)

  useEffect(() => {
    if (!open) return undefined
    // The shell scrolls `main`, not the window (AppShell: `app-main … overflow-auto`),
    // so locking the body would leave the list rolling behind the panel.
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
      className="aic fixed inset-0 z-[90] flex justify-end bg-gray-900/40 backdrop-blur-[2px] print:hidden"
      data-keyboard-overlay="true"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cx(
          'flex h-full animate-slide-in-right flex-col border-l border-gray-200 bg-white shadow-overlay',
          WIDTH[width],
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="truncate text-base font-semibold text-gray-900">
                {title}
              </h2>
              {badge}
            </div>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs text-gray-500">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={onClose}
            aria-label="Close"
            data-modal-close=""
            className="shrink-0"
          />
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="shrink-0 border-t border-gray-200 px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  )
}

export default Drawer
