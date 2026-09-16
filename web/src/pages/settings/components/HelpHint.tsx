import { HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from '../../../ui/Tooltip'
import { AIC, cx } from '../../../ui/cx'

export interface HelpHintProps {
  /** What the control does, in a sentence or two. */
  label: ReactNode
  /** Named in the accessible label: "More about Valuation scope". */
  about: string
  className?: string
}

/**
 * The "why does this exist" for a technical setting.
 *
 * A real `<button>` rather than an icon with a `title`: Tooltip opens on focus as well as hover, so
 * the explanation is reachable by keyboard, and a screen reader announces the control rather than
 * a decorative glyph.
 */
export function HelpHint({ label, about, className }: HelpHintProps) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={`More about ${about}`}
        className={cx(
          AIC,
          'inline-flex items-center justify-center rounded text-gray-400 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
          className,
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  )
}

export default HelpHint
