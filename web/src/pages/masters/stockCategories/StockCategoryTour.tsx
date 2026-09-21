import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '../../../ui/Button'

/**
 * The guided walk behind "Watch tour".
 *
 * Inventory has no onboarding framework, and this does not add one: it is a
 * portal, a rectangle and four steps, ~120 lines with no new dependency. A
 * tour library for one button on one screen would be several hundred kilobytes
 * in the bundle of every page that shares the vendor chunk.
 *
 * It points at elements the page marks with `data-tour`, so a step whose target
 * is not on screen — the AI rail on a narrow laptop, the bulk bar with nothing
 * selected — is skipped rather than drawing a highlight around nothing.
 *
 * Escape ends it, the scrim is not clickable-through, and the highlight is a
 * plain ring: no scrolling animation to fight a reader who prefers reduced
 * motion.
 */

export interface TourStep {
  /** Value of the `data-tour` attribute on the element to highlight. */
  target: string
  title: string
  body: string
}

export const STOCK_CATEGORY_TOUR: readonly TourStep[] = [
  {
    target: 'summary',
    title: 'The four figures',
    body: 'Counted across the whole company, not the page below — so they still read true on page 3 of 9. "Most used" names the category the greatest number of items point at.',
  },
  {
    target: 'toolbar',
    title: 'Search, filter, sort',
    body: 'Press / anywhere on this page to jump into the search box. Everything you set here goes into the address bar, so the view you are looking at is a link you can send to somebody.',
  },
  {
    target: 'table',
    title: 'The list',
    body: 'Items counts how many items carry each category — click one to open those items. Tick rows to activate, deactivate or export them together. A category in use cannot be deleted; deactivate it instead.',
  },
  {
    target: 'ai',
    title: 'Review and quick actions',
    body: 'The category review checks every category for duplicate names, clashing aliases and categories nothing uses. It is arithmetic over your own data, not a guess.',
  },
]

const PAD = 8

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function rectOf(target: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export interface StockCategoryTourProps {
  open: boolean
  steps?: readonly TourStep[]
  onClose: () => void
}

export function StockCategoryTour({ open, steps = STOCK_CATEGORY_TOUR, onClose }: StockCategoryTourProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Only the steps whose target is actually rendered at this width.
  const [visible, setVisible] = useState<TourStep[]>([])

  useLayoutEffect(() => {
    if (!open) return
    setVisible(steps.filter((s) => rectOf(s.target) !== null))
    setIndex(0)
  }, [open, steps])

  const step = visible[index]

  const measure = useCallback(() => {
    if (!step) return
    setRect(rectOf(step.target))
  }, [step])

  useLayoutEffect(() => {
    if (!open) return undefined
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])

  /*
   * Focus moves into the card, and back to whatever opened the tour when it
   * ends.
   *
   * Not only for the screen reader `aria-modal` already promises: the app's
   * Escape-to-breadcrumb-parent binding is skipped when the FOCUSED element is
   * inside an overlay, and focus left on the Watch tour button is not. Without
   * this, Escape on the last step navigates the reader off the screen the tour
   * was explaining.
   */
  useEffect(() => {
    if (!open) return undefined
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const opener = openerRef.current
    return () => opener?.focus?.()
  }, [open])

  /*
   * Keyed on the step, not on `open`: the first render after opening has no
   * card yet — the visible steps are measured in a layout effect — so focusing
   * on `open` alone would find a null ref and leave focus on the button.
   */
  const hasStep = Boolean(step)
  useEffect(() => {
    if (open && hasStep) cardRef.current?.focus()
  }, [open, hasStep])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open || !step) return null

  const last = index === visible.length - 1
  // Below the target when there is room, above it when there is not.
  const below = rect ? rect.top + rect.height + 12 + 180 < window.innerHeight : true
  const cardTop = rect ? (below ? rect.top + rect.height + 12 : Math.max(12, rect.top - 12 - 180)) : 120
  const cardLeft = rect ? Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 340)) : 24

  return createPortal(
    <div
      className="aic fixed inset-0 z-[95] print:hidden"
      /*
       * The marker KeyboardProvider looks for. Without it the page's own
       * Esc-to-breadcrumb-parent binding fires first and the tour's last step
       * navigates the reader off the screen it is explaining.
       */
      data-keyboard-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-label="Stock categories tour"
    >
      {/*
        The click-catcher. It only paints when there is no target to spotlight:
        the highlight below dims the page with its own 9999px shadow, and a
        second wash over the top would dim the one rectangle the step is
        pointing at as much as everything else.
      */}
      <div className={rect ? 'absolute inset-0' : 'absolute inset-0 bg-gray-900/45'} onClick={onClose} />

      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
          }}
          aria-hidden
        />
      ) : null}

      <div
        ref={cardRef}
        tabIndex={-1}
        className="absolute w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-gray-200 bg-white p-4 shadow-overlay focus:outline-none"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">{step.title}</p>
          <Button variant="ghost" size="xs" icon={X} onClick={onClose} aria-label="End tour" />
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{step.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-gray-400">
            {index + 1} of {visible.length}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={() => (last ? onClose() : setIndex((i) => i + 1))}>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default StockCategoryTour
