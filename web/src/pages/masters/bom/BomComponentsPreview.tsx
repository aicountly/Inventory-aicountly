import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Package } from 'lucide-react'
import type { Bom } from '../../../services/masters'
import { Tooltip } from '../../../ui/Tooltip'
import { cx } from '../../../ui/cx'
import { formatInt, formatQty } from '../../../utils/format'
import { componentChips, componentLabel } from './bomPresentation'

/**
 * The Components column: a few thumbnails, then `+N more`.
 *
 * A comma-separated list of six item names in a 250px cell truncates to
 * "Wooden seat, Metal leg, Scr…", which tells a reader nothing they could act
 * on. Chips let the eye count the parts at a glance and the `+N` button opens
 * the rest.
 *
 * The chips are BUTTONS, not decorative spans: each one has the component's
 * name and quantity as its accessible name, and pressing one opens the same
 * popover as `+N more`, so the column is fully reachable from the keyboard.
 *
 * The popover is portalled to the body. The table scrolls sideways inside an
 * `overflow-x-auto`, and a popover positioned inside that box is clipped by it
 * — on the last column it would be unreachable.
 */

const CHIP =
  'grid h-7 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

const GAP = 6
const MARGIN = 8
const WIDTH = 264

interface PopoverProps {
  row: Bom
  anchor: HTMLElement
  id: string
  onClose: () => void
}

function ComponentsPopover({ row, anchor, id, onClose }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const height = ref.current?.offsetHeight ?? 0
      const below = window.innerHeight - rect.bottom >= height + GAP + MARGIN
      setPos({
        top: below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - height - GAP),
        left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - WIDTH - MARGIN)),
      })
    }
    place()
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  const components = row.components_preview ?? []
  const shown = row.component_count ?? components.length
  const beyondPreview = Math.max(0, shown - components.length)

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={`Components of ${row.bom_name}`}
      style={pos ? { top: pos.top, left: pos.left, width: WIDTH } : { top: -9999, left: -9999, width: WIDTH }}
      className="aic fixed z-[95] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-overlay print:hidden"
    >
      <div className="border-b border-gray-100 bg-gray-50 px-3 py-2">
        <p className="text-[11px] font-semibold text-gray-900">
          {formatInt(shown)} component{shown === 1 ? '' : 's'}
        </p>
        <p className="truncate text-[10px] text-gray-500">{row.bom_name}</p>
      </div>
      <ul className="scrollbar-thin max-h-60 overflow-y-auto py-1">
        {components.map((c) => (
          <li key={`${c.item_id}-${c.item_name}`} className="flex items-center gap-2 px-3 py-1.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-gray-100 text-gray-400" aria-hidden>
              <Package className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-gray-900">
                {c.item_name ?? `#${c.item_id}`}
              </span>
              {c.item_sku ? <span className="block truncate text-[10px] text-gray-400">{c.item_sku}</span> : null}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-gray-600">
              {formatQty(c.qty)}
              {c.unit_symbol ? ` ${c.unit_symbol}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {beyondPreview > 0 ? (
        <p className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-500">
          {formatInt(beyondPreview)} more — open the bill to see all of them.
        </p>
      ) : null}
    </div>,
    document.body,
  )
}

export interface BomComponentsPreviewProps {
  row: Bom
  /** How many chips before the `+N more` button. */
  max?: number
}

export function BomComponentsPreview({ row, max = 3 }: BomComponentsPreviewProps) {
  const popoverId = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { visible, hidden, total, previewMissing } = componentChips(row, max)

  if (total === 0) {
    return <span className="text-[11px] text-gray-400">No components</span>
  }
  // The list was fetched without `with_preview`: say how many there are rather
  // than draw chips for components nobody sent.
  if (previewMissing) {
    return (
      <span className="text-[11px] tabular-nums text-gray-600">
        {formatInt(total)} component{total === 1 ? '' : 's'}
      </span>
    )
  }

  const toggle = (el: HTMLElement) => setAnchor((current) => (current === el ? null : el))

  return (
    <div className="flex items-center gap-1.5">
      {visible.map((component) => {
        const label = componentLabel(component)
        return (
          <Tooltip key={`${component.item_id}-${component.item_name}`} label={label}>
            <button
              type="button"
              aria-label={label}
              aria-haspopup="dialog"
              className={cx(CHIP, component.item_is_active === 0 && 'border-amber-300 bg-amber-50 text-amber-600')}
              onClick={(e) => toggle(e.currentTarget)}
            >
              <Package className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        )
      })}
      {hidden > 0 ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={anchor !== null}
          aria-controls={anchor !== null ? popoverId : undefined}
          onClick={(e) => toggle(e.currentTarget)}
          className="inline-flex h-7 shrink-0 items-center rounded-full border border-gray-200 bg-gray-50 px-2 text-[10px] font-medium text-gray-600 transition-colors hover:border-primary/40 hover:bg-primary-light hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          +{formatInt(hidden)} more
        </button>
      ) : null}
      {anchor ? (
        <ComponentsPopover row={row} anchor={anchor} id={popoverId} onClose={() => setAnchor(null)} />
      ) : null}
    </div>
  )
}

export default BomComponentsPreview
