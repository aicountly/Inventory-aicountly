import type { IconTone } from '../../ui/IconTile'
import { cx } from '../../ui/cx'
import type { RegisterVisual } from './registersHubModel'

/**
 * The decorative mark on the right of a register card.
 *
 * Inline SVG and flexed spans, on purpose: a charting library would be tens of
 * kilobytes and a render pass per card for a shape that carries no data and
 * that nobody may read a number off. There is nothing to read here — both
 * marks are `aria-hidden`, and the card says everything it means in words.
 *
 * Both are a fixed, explicitly-sized block. A `span` is inline by default, and
 * an inline box ignores width and height: the mark would then size itself from
 * an `svg` that had asked for 100% of it, and the card's text would be left
 * fighting a flex sibling of indeterminate width.
 *
 * The ink is the section's own accent (the tones dark-overrides.css already
 * covers), softened so the mark sits behind the title rather than beside it.
 */
const TONE_INK: Record<IconTone, string> = {
  primary: 'text-primary',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
  info: 'text-sky-600',
  violet: 'text-violet-600',
  slate: 'text-gray-400',
  rose: 'text-rose-600',
  teal: 'text-teal-600',
}

/** Bar heights, as percentages. A fixed silhouette, not sampled data. */
const BARS = [30, 45, 70, 100, 58, 90]

/** One box for both marks, so a card's text never depends on which it drew. */
const BOX = 'h-10 w-28 shrink-0'

export interface RegisterCardVisualProps {
  visual: RegisterVisual
  tone: IconTone
  className?: string
}

export function RegisterCardVisual({ visual, tone, className }: RegisterCardVisualProps) {
  if (visual === 'none') return null

  if (visual === 'bars') {
    return (
      <span
        aria-hidden
        className={cx('flex items-end justify-end gap-1.5', BOX, TONE_INK[tone], className)}
      >
        {BARS.map((height, i) => (
          <i
            key={`${height}-${i}`}
            className="block w-2.5 rounded-sm rounded-b-[1px] bg-current"
            style={{ height: `${height}%`, opacity: 0.35 + (height / 100) * 0.45 }}
          />
        ))}
      </span>
    )
  }

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 150 50"
      preserveAspectRatio="none"
      className={cx('block opacity-80', BOX, TONE_INK[tone], className)}
    >
      <path
        d="M2 40 C18 40,24 31,38 31 C51 31,55 11,69 12 C82 13,89 42,105 28 C119 15,128 17,148 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default RegisterCardVisual
