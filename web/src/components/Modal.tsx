import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cx } from '../ui/cx'

interface ModalProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Ignore Escape / backdrop while a save is in flight. */
  busy?: boolean
  description?: ReactNode
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
}

/**
 * Shared dialog.
 *
 * Re-skinned onto the Books design language in place — the behaviour is the
 * one Inventory already had and it is the better of the two: Escape to close,
 * body-scroll lock that restores the previous value, backdrop dismiss, a
 * `busy` guard so a save in flight cannot be interrupted, and focus moved to
 * the first control once per opening (never on a re-render, which would yank
 * focus away mid-typing). ConfirmDialog upgrades with it.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  busy = false,
  description,
}: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, busy, onClose])

  // Focus the first control once per opening — not on every re-render, which
  // would yank focus away while the user is typing.
  useEffect(() => {
    if (!open) return undefined
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]), select, textarea, button:not([data-modal-close])',
      )
      first?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  if (!open) return null

  return (
    <div
      className="aic fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm print:hidden"
      data-keyboard-overlay="true"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cx(
          'flex max-h-[90dvh] w-full animate-rise-in flex-col overflow-hidden rounded-2xl bg-white shadow-overlay',
          SIZE[size],
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-keyboard-overlay="true"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
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
          <button
            type="button"
            data-modal-close
            className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
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
