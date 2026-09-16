import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'
import type { ButtonProps, ButtonSize, ButtonVariant } from './Button'
import { AIC, cx } from './cx'

/**
 * A button that opens a short list of actions.
 *
 * Portalled to `document.body` and positioned against the viewport, for the
 * same reason ExportActions is: a row menu lives inside a table with
 * `overflow-x-auto`, and a menu positioned inside that box is clipped by it —
 * the last item of the last row would be unreachable.
 *
 * `role="menu"` is a promise about keyboard behaviour, so it is kept: arrows
 * move between items, Home / End jump to the ends, Escape closes and returns
 * focus to the trigger, and Tab leaves the menu rather than cycling inside it.
 */

export interface MenuAction {
  key: string
  label: ReactNode
  icon?: LucideIcon
  onSelect: () => void
  /** Draws a rule above this item. */
  separated?: boolean
  danger?: boolean
  disabled?: boolean
}

export interface MenuButtonProps {
  actions: readonly MenuAction[]
  label: string
  icon?: LucideIcon
  children?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  buttonProps?: Partial<ButtonProps>
  /** Menu width in pixels. */
  width?: number
  align?: 'start' | 'end'
}

const GAP = 4
const MARGIN = 8

export function MenuButton({
  actions,
  label,
  icon,
  children,
  variant = 'ghost',
  size = 'xs',
  className,
  buttonProps,
  width = 216,
  align = 'end',
}: MenuButtonProps) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const usable = actions.filter((a) => !a.disabled)

  const close = useCallback(
    (refocus = true) => {
      setOpen(false)
      setStyle(null)
      if (refocus) triggerRef.current?.focus()
    },
    [],
  )

  const place = useCallback(() => {
    const anchor = triggerRef.current
    const menu = menuRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const height = menu?.offsetHeight ?? 0
    const below = window.innerHeight - rect.bottom >= height + GAP + MARGIN
    const top = below ? rect.bottom + GAP : rect.top - height - GAP
    const rawLeft = align === 'end' ? rect.right - width : rect.left
    setStyle({
      top: Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN)),
      left: Math.max(MARGIN, Math.min(rawLeft, window.innerWidth - width - MARGIN)),
    })
  }, [align, width])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined
    const onScrollOrResize = () => place()
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [open, place, close])

  // Focus the first item on open, so the menu is usable without a mouse.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const moveFocus = (delta: number | 'first' | 'last') => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? items.length - 1
          : (at + delta + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        icon={icon}
        aria-label={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={usable.length === 0}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={className}
        {...buttonProps}
      >
        {children}
      </Button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              className={cx(
                AIC,
                'fixed z-[95] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-overlay print:hidden',
              )}
              style={
                style
                  ? { top: style.top, left: style.left, width }
                  : { top: -9999, left: -9999, width }
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  close()
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  moveFocus(1)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  moveFocus(-1)
                } else if (e.key === 'Home') {
                  e.preventDefault()
                  moveFocus('first')
                } else if (e.key === 'End') {
                  e.preventDefault()
                  moveFocus('last')
                } else if (e.key === 'Tab') {
                  close(false)
                }
              }}
            >
              {actions.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.key}
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    onClick={() => {
                      close()
                      action.onSelect()
                    }}
                    className={cx(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                      action.separated && 'mt-1 border-t border-gray-100 pt-2',
                      action.danger
                        ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
                        : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50',
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
        : null}
    </>
  )
}

export default MenuButton
