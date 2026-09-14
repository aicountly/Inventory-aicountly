import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { cx } from './cx'

const GAP = 8
const EDGE = 8

interface Coords {
  left: number
  top: number
}

export interface TooltipProps {
  label?: ReactNode
  placement?: 'top' | 'bottom'
  className?: string
  children: ReactNode
}

/**
 * Hover/focus tooltip rendered in a body portal so it is never clipped by a
 * scrolling table body or an `overflow-hidden` card. Prefer it over the native
 * `title` attribute for icon-only row actions: native tooltips are slow to
 * appear and invisible against a tinted (hovered) row.
 */
export function Tooltip({ label, placement = 'top', className, children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const tipRef = useRef<HTMLSpanElement | null>(null)
  const [coords, setCoords] = useState<Coords | null>(null)

  const show = useCallback(() => {
    const el = anchorRef.current
    if (!el || !label) return
    const r = el.getBoundingClientRect()
    setCoords({
      left: r.left + r.width / 2,
      top: placement === 'bottom' ? r.bottom + GAP : r.top - GAP,
    })
  }, [label, placement])

  const hide = useCallback(() => setCoords(null), [])

  // Keep the bubble inside the viewport — row action icons sit at the edge.
  useLayoutEffect(() => {
    if (!coords || !tipRef.current) return
    const half = tipRef.current.getBoundingClientRect().width / 2
    const min = EDGE + half
    const max = Math.max(min, window.innerWidth - EDGE - half)
    const clamped = Math.min(Math.max(coords.left, min), max)
    if (Math.abs(clamped - coords.left) > 0.5) {
      setCoords((c) => (c ? { ...c, left: clamped } : c))
    }
  }, [coords])

  // A fixed bubble would detach from its anchor once the table scrolls.
  useEffect(() => {
    if (!coords) return undefined
    const dismiss = () => setCoords(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [coords])

  return (
    <>
      <span
        ref={anchorRef}
        className={cx('inline-flex', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={hide}
      >
        {children}
      </span>
      {coords && label
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              style={{
                position: 'fixed',
                top: coords.top,
                left: coords.left,
                transform:
                  placement === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              }}
              className="aic z-[130] pointer-events-none max-w-[260px] rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium leading-snug text-white shadow-lg print:hidden"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

export default Tooltip
