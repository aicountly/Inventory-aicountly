import { useId } from 'react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../../../ui/cx'

export interface SettingSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  title: ReactNode
  description: ReactNode
  disabled?: boolean
  /** Rendered after the title — a HelpHint, usually. */
  hint?: ReactNode
  className?: string
}

/**
 * An on/off inventory preference.
 *
 * It is a real `<input type="checkbox" role="switch">` under a styled track, not a div that listens
 * for clicks: that is what makes Space toggle it, what puts it in the tab order, and what lets a
 * screen reader say "switch, on". The track and knob are siblings of the input so Tailwind's `peer`
 * variants can draw every state — checked, focus-visible and disabled — without a line of JS.
 */
export function SettingSwitch({ checked, onChange, title, description, disabled = false, hint, className }: SettingSwitchProps) {
  const id = useId()
  const describedBy = `${id}-desc`
  return (
    <div className={cx(AIC, 'flex items-start gap-3', className)}>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          checked={checked}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-gray-300 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 peer-disabled:opacity-50 dark:bg-gray-600"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 peer-disabled:opacity-70"
        />
      </span>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cx(
            'flex items-center gap-1.5 text-[0.8125rem] font-semibold leading-snug text-gray-900',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          <span>{title}</span>
          {hint}
        </label>
        <p id={describedBy} className="mt-1 text-[0.6875rem] leading-relaxed text-gray-500">
          {description}
        </p>
      </div>
    </div>
  )
}

export default SettingSwitch
