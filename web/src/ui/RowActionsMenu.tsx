import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AIC, cx } from './cx'

/**
 * The three-dot menu at the end of a table row.
 *
 * Portalled to `document.body` and positioned against the viewport for the same
 * reason `ExportActions` is: a register's table body is an `overflow-auto` box
 * inside a `tall:overflow-hidden` shell, and a menu positioned inside it would
 * be clipped by its own row — worst on the last row, where the menu is most of
 * what there is to clip.
 */
export interface RowAction {
  key: string
  label: string
  icon?: LucideIcon
  /** Internal route. Omit and `onSelect` is used instead. */
  to?: string
  onSelect?: () => void
  /** Why this action cannot be taken; renders it disabled with a tooltip. */
  disabledReason?: string | null
}

export interface RowActionsMenuProps {
  actions: readonly RowAction[]
  /** Screen-reader name: "Actions for Blue widget". */
  label: string
}

const MENU_WIDTH = 210
const GAP = 4
const MARGIN = 8

export function RowActionsMenu({ actions, label }: RowActionsMenuProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const height = menuRef.current?.offsetHeight ?? actions.length * 36 + 8
    // Flip above the trigger when the rows below it have run out of room.
    const below = rect.bottom + GAP
    const top = below + height > window.innerHeight - MARGIN ? rect.top - GAP - height : below
    const left = Math.min(
      Math.max(rect.right - MENU_WIDTH, MARGIN),
      window.innerWidth - MENU_WIDTH - MARGIN,
    )
    setStyle({ top: Math.max(MARGIN, top), left })
  }, [actions.length])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The register binds Esc to "go back"; a menu on screen is what Esc
        // means right now, so it does not travel any further.
        e.stopPropagation()
        setOpen(false)
        anchorRef.current?.focus()
      }
    }
    // Re-anchor rather than dismiss. Closing on scroll is the usual reflex for
    // a portalled menu, but the click that OPENS this one can itself scroll the
    // table body — a button on the last visible row gets nudged into view when
    // it takes focus — and the menu would vanish in the same frame it appeared.
    const reposition = () => place()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', reposition)
    // Capture phase: the scroller is the table body, not the window.
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, place])

  const run = (action: RowAction) => {
    if (action.disabledReason) return
    setOpen(false)
    if (action.to) navigate(action.to)
    else action.onSelect?.()
  }

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="fixed z-50 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-overlay print:hidden"
            style={{
              width: MENU_WIDTH,
              top: style?.top ?? -9999,
              left: style?.left ?? -9999,
            }}
          >
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  disabled={Boolean(action.disabledReason)}
                  title={action.disabledReason ?? undefined}
                  onClick={() => run(action)}
                  className={cx(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium',
                    action.disabledReason
                      ? 'cursor-not-allowed text-gray-400'
                      : 'text-gray-700 hover:bg-primary-light/50 focus-visible:bg-primary-light/50 focus-visible:outline-none',
                  )}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden /> : null}
                  <span className="truncate">{action.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          AIC,
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400',
          'transition-colors hover:bg-gray-100 hover:text-gray-700',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        )}
        // The row is a drill-through target; opening its menu is not taking it.
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {menu}
    </>
  )
}

export default RowActionsMenu
