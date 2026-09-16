import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '../access/AccessContext'
import { AIC, cx } from '../ui/cx'

export interface RegisterRowAction {
  key: string
  label: string
  /** Where it goes. Omit and `onSelect` runs instead. */
  to?: string
  onSelect?: () => void
  icon?: LucideIcon
  /** Hidden unless the signed-in member holds this. */
  permission?: PermissionKey
  /** Why it cannot be used on this row, or null when it can. */
  disabledReason?: string | null
}

const MENU_WIDTH = 208

/**
 * The row's own actions, behind a kebab at the right edge.
 *
 * Every register already opens a row on click and on Enter, but nothing on
 * screen said so — a reader with a mouse had no way to discover that a stock
 * balance leads to that item's ledger. This is that affordance, and only that:
 * the register declares actions it already supports, the engine hides any the
 * member has no permission for, and nothing here invents a new one.
 *
 * Portalled to the body like the export menu, because the table body scrolls
 * inside a `overflow-auto` box that would otherwise clip it.
 */
export function RegisterRowMenu({
  actions,
  label,
}: {
  actions: readonly RegisterRowAction[]
  label: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top: r.bottom + 4, left })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        anchorRef.current?.focus()
      }
    }
    // Any scroll moves the row the menu is pinned to, so it closes rather than
    // hovering over an unrelated line.
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (!actions.length) return null

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className={cx(
        AIC,
        'fixed z-50 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-overlay print:hidden',
      )}
      style={{ width: MENU_WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((action) => {
        const Icon = action.icon
        const body = (
          <>
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden /> : null}
            <span className="truncate">{action.label}</span>
          </>
        )
        const cls =
          'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-gray-700 no-underline hover:bg-primary-light/50 focus-visible:bg-primary-light/50 focus-visible:outline-none'
        if (action.disabledReason) {
          return (
            <span
              key={action.key}
              role="menuitem"
              aria-disabled
              title={action.disabledReason}
              className={cx(cls, 'cursor-not-allowed text-gray-400')}
            >
              {body}
            </span>
          )
        }
        if (action.to) {
          return (
            <Link
              key={action.key}
              role="menuitem"
              to={action.to}
              className={cls}
              onClick={() => setOpen(false)}
            >
              {body}
            </Link>
          )
        }
        return (
          <button
            key={action.key}
            type="button"
            role="menuitem"
            className={cls}
            onClick={() => {
              setOpen(false)
              action.onSelect?.()
            }}
          >
            {body}
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className={cx(
          AIC,
          'inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors',
          'hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          open && 'bg-gray-100 text-gray-700',
        )}
        // The row opens on click; the kebab must not take the reader with it.
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </>
  )
}

export default RegisterRowMenu
