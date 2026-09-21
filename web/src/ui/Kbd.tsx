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

export interface ShortcutLegendItem {
  /** `"ctrl+r"` renders as Ctrl + R. */
  keys: string
  label: ReactNode
}

/**
 * The shortcut legend under a register's title — each chip beside the thing it
 * actually does.
 *
 * `KeyboardShortcutHint` prints every key and then every label, so the line
 * reads "/ Ctrl+R Ctrl+P Esc — Search · Refresh · Print · Back" and asks the
 * reader to pair four chips with four words by counting along both halves.
 * Pairing them is the only reason to print the line at all. The two coexist
 * because the compact header puts its hint inline with the buttons, where one
 * run of keys costs less width than four labelled pairs.
 */
export function KeyboardShortcutLegend({
  items,
  className,
}: {
  items: readonly ShortcutLegendItem[]
  className?: string
}) {
  if (!items.length) return null
  return (
    <span
      className={cx(
        AIC,
        'inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 print:hidden',
        className,
      )}
    >
      {items.map((item, idx) => (
        <span key={`${item.keys}-${idx}`} className="inline-flex items-center gap-1">
          {item.keys.split('+').map((part, i, arr) => (
            <span key={`${part}-${i}`} className="inline-flex items-center gap-0.5">
              <Kbd>{part}</Kbd>
              {i < arr.length - 1 ? <span className="px-0.5 text-gray-300">+</span> : null}
            </span>
          ))}
          <span className="ml-0.5">{item.label}</span>
        </span>
      ))}
    </span>
  )
}

export default Kbd
