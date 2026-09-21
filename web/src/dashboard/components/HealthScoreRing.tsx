import { useEffect, useState } from 'react'
import { cx } from '../../ui/cx'
import type { HealthTone } from '../valuationHealth'

/**
 * The stock-health score, drawn as an SVG ring.
 *
 * SVG rather than an image or a conic-gradient: the arc has to be animatable,
 * it has to survive a dark theme, and — the part that decides it — a screen
 * reader has to be able to read the figure. The number is real text in the
 * middle of the ring, and the ring itself is `aria-hidden` decoration on top of
 * it.
 *
 * `score === null` is not zero. A score that could not be computed draws an
 * empty track and an em dash, because a company whose reports all failed must
 * not be shown a 0/100 that reads as "your inventory is worthless".
 */
export interface HealthScoreRingProps {
  score: number | null
  tone?: HealthTone
  size?: number
  className?: string
}

const STROKE = 9
const TONE_STROKE: Record<HealthTone, string> = {
  success: 'stroke-emerald-500',
  warning: 'stroke-amber-500',
  danger: 'stroke-red-500',
}
const TONE_TEXT: Record<HealthTone, string> = {
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
}

/** Honours the OS setting; no motion on the server or where it is unknown. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function HealthScoreRing({ score, tone = 'success', size = 88, className }: HealthScoreRingProps) {
  const target = score === null ? 0 : Math.min(100, Math.max(0, score))

  // Sweeps from empty to the score once, on mount. Starting AT the score when
  // motion is reduced means the ring is simply correct rather than animating
  // at zero duration.
  const [drawn, setDrawn] = useState(() => (prefersReducedMotion() ? target : 0))
  useEffect(() => {
    if (prefersReducedMotion()) {
      setDrawn(target)
      return undefined
    }
    const frame = requestAnimationFrame(() => setDrawn(target))
    return () => cancelAnimationFrame(frame)
  }, [target])

  const radius = (100 - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - drawn / 100)

  return (
    <div
      className={cx('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? 'Stock health score not available' : `Stock health score ${score} out of 100`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden focusable="false">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-emerald-100"
        />
        {score === null ? null : (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cx('transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none', TONE_STROKE[tone])}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={cx('text-[26px] font-bold leading-none tabular-nums', score === null ? 'text-gray-300' : TONE_TEXT[tone])}>
          {score === null ? '—' : score}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-gray-400">/100</span>
      </div>
    </div>
  )
}

export default HealthScoreRing
