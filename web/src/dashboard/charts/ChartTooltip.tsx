import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent as ReactMouseEvent } from 'react'

/**
 * Cursor-tracking tooltip for the hand-rolled SVG / DOM charts.
 *
 * There is no charting library here on purpose — the charts a stock dashboard
 * needs are a donut and a bar list, and both are a dozen lines of SVG/flexbox.
 * What they do need is a tooltip that follows the pointer *across* a shape
 * (an arc is one element but every point on it means something different), so
 * position comes from the mouse event rather than from an anchor element.
 *
 * Rendered into document.body so a card's `overflow-hidden` cannot clip it.
 */
export interface ChartTooltipState {
  x: number
  y: number
  label: string
}

export interface ChartTooltipApi {
  tooltip: ChartTooltipState | null
  showTooltip: (event: ReactMouseEvent, label: string) => void
  moveTooltip: (event: ReactMouseEvent) => void
  hideTooltip: () => void
}

export function useChartTooltip(): ChartTooltipApi {
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)

  const showTooltip = useCallback((event: ReactMouseEvent, label: string) => {
    if (!label) return
    setTooltip({ x: event.clientX, y: event.clientY, label })
  }, [])

  const moveTooltip = useCallback((event: ReactMouseEvent) => {
    const { clientX, clientY } = event
    setTooltip((t) => (t ? { ...t, x: clientX, y: clientY } : t))
  }, [])

  const hideTooltip = useCallback(() => setTooltip(null), [])

  return { tooltip, showTooltip, moveTooltip, hideTooltip }
}

const EDGE = 8
const OFFSET = 14

export function ChartTooltip({ tooltip }: { tooltip: ChartTooltipState | null }) {
  if (!tooltip) return null
  if (typeof document === 'undefined') return null
  const left = Math.min(Math.max(tooltip.x, EDGE), window.innerWidth - EDGE)
  const top = Math.max(tooltip.y - OFFSET, EDGE)
  return createPortal(
    <span
      role="tooltip"
      style={{ position: 'fixed', top, left, transform: 'translate(-50%, -100%)' }}
      className="z-[100] pointer-events-none whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium leading-snug text-white shadow-lg print:hidden"
    >
      {tooltip.label}
    </span>,
    document.body,
  )
}

export default ChartTooltip
