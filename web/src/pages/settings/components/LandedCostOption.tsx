import { useId } from 'react'
import { Check, Lock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../../../ui/cx'

export interface LandedCostOptionProps {
  icon: LucideIcon
  title: string
  description: string
  /** Capitalised into stock. */
  selected: boolean
  onChange?: (selected: boolean) => void
  /** Not a policy choice — always capitalised. Renders checked, disabled and labelled as such. */
  locked?: boolean
  /** The user may read the policy but not change it. */
  readOnly?: boolean
  /** A HelpHint, for the one type whose rule needs explaining. */
  hint?: ReactNode
}

/**
 * One charge type, as a tile.
 *
 * `locked` and `readOnly` both render a disabled control and they are not the same thing: locked
 * says this company has no choice about the type (a non-recoverable tax is part of the cost of
 * purchase under AS-2), read-only says this user has no permission to change any of them. Only the
 * first earns the padlock and the "always included" line, because only the first is still true for
 * an administrator.
 */
export function LandedCostOption({
  icon: Icon,
  title,
  description,
  selected,
  onChange,
  locked = false,
  readOnly = false,
  hint,
}: LandedCostOptionProps) {
  const id = useId()
  const disabled = locked || readOnly
  return (
    <label
      htmlFor={id}
      className={cx(
        AIC,
        'relative flex items-start gap-2.5 rounded-xl border p-3 transition-colors',
        selected ? 'border-primary/30 bg-primary-light/30' : 'border-gray-200 bg-white',
        disabled ? 'cursor-default' : 'cursor-pointer hover:border-primary/40 hover:bg-primary-light/20',
      )}
    >
      {/* The box is drawn rather than left to the browser: a native checkbox that is checked AND
          disabled renders grey in Chrome, so the one type that is always capitalised would read as
          the one type that is switched off. The input itself is still here, still a checkbox, still
          focusable — only its painting is ours. */}
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={selected}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span
        aria-hidden
        className={cx(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40',
          selected ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white text-transparent',
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span
        aria-hidden
        className={cx(
          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
          selected ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold leading-snug text-gray-900">
          <span className="truncate">{title}</span>
          {hint}
        </span>
        <span className="mt-1 block text-[0.6875rem] leading-relaxed text-gray-500">{description}</span>
        {locked ? (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-wide text-primary">
            <Lock className="h-3 w-3" aria-hidden />
            Always included when applicable
          </span>
        ) : null}
      </span>
    </label>
  )
}

export default LandedCostOption
