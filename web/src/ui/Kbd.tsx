import type { ReactNode } from 'react'
import { AIC, cx } from './cx'

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx(AIC, 'kbd', className)}>{children}</kbd>
}

export interface KeyboardShortcutHintProps {
  /** `"ctrl+p"` renders as Ctrl + P; an array renders alternatives separated by `/`. */
  keys: string | readonly string[]
  label?: ReactNode
  className?: string
}

/**
 * The line of shortcut chips every register shows under its toolbar. Keeping
 * it a component (rather than prose) means the hints stay consistent and are
 * hidden from print in one place.
 */
export function KeyboardShortcutHint({ keys, label, className }: KeyboardShortcutHintProps) {
  const list = Array.isArray(keys) ? keys : [keys as string]
  return (
    <span
      className={cx(AIC, 'inline-flex items-center gap-1.5 text-[11px] text-gray-500 print:hidden', className)}
    >
      {list.map((k, idx) => (
        <span key={`${k}-${idx}`} className="inline-flex items-center gap-1">
          {idx > 0 ? <span className="text-gray-300">/</span> : null}
          {String(k)
            .split('+')
            .map((part, i, arr) => (
              <span key={`${part}-${i}`} className="inline-flex items-center gap-0.5">
                <Kbd>{part}</Kbd>
                {i < arr.length - 1 ? <span className="text-gray-300 px-0.5">+</span> : null}
              </span>
            ))}
        </span>
      ))}
      {label ? <span>{label}</span> : null}
    </span>
  )
}

export default Kbd
