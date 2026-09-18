import { AIC, cx } from './cx'

export type SwitchSize = 'sm' | 'md'

const TRACK: Record<SwitchSize, string> = { sm: 'h-5 w-9', md: 'h-6 w-11' }
const KNOB: Record<SwitchSize, string> = { sm: 'h-4 w-4 left-0.5 top-0.5', md: 'h-5 w-5 left-0.5 top-0.5' }
const TRAVEL: Record<SwitchSize, string> = { sm: 'peer-checked:translate-x-4', md: 'peer-checked:translate-x-5' }

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: SwitchSize
  id?: string
  /** One of these is required — a switch with no name announces as "switch, on". */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  className?: string
}

/**
 * A bare on/off control.
 *
 * A real `<input type="checkbox" role="switch">` under a styled track, not a
 * div that listens for clicks: that is what puts it in the tab order, what
 * makes Space toggle it and what lets a screen reader say "switch, on". The
 * track and the knob are siblings of the input so Tailwind's `peer` variants
 * draw checked, focus and disabled without a line of JS.
 *
 * `SettingSwitch` (settings) is this control with a title and a description
 * baked in; this one is for layouts that place the label themselves — the item
 * form's tracking tiles put the switch in the tile's top-right corner.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  size = 'sm',
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: SwitchProps) {
  return (
    <span className={cx(AIC, 'relative inline-flex shrink-0', TRACK[size], className)}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-gray-300 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 peer-disabled:opacity-50 dark:bg-gray-600"
      />
      <span
        aria-hidden
        className={cx(
          'pointer-events-none absolute rounded-full bg-white shadow-sm transition-transform peer-disabled:opacity-70',
          KNOB[size],
          TRAVEL[size],
        )}
      />
    </span>
  )
}

export default Switch
