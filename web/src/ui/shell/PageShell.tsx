import type { ReactNode } from 'react'
import { AIC, cx } from '../cx'

export interface PageShellProps {
  className?: string
  /** Leaves room for a sticky action bar and makes the page a flex column. */
  paddingBottom?: boolean
  /** Drops the max width — for full-width registers and dashboards. */
  fullBleed?: boolean
  compact?: boolean
  children?: ReactNode
}

/**
 * The outer wrapper of every routed page: one max width, one vertical rhythm.
 * Ported from books-react-app/web/src/components/shell/PageShell.jsx.
 */
export function PageShell({
  className,
  paddingBottom = false,
  fullBleed = false,
  compact = false,
  children,
}: PageShellProps) {
  return (
    <div
      className={cx(
        AIC,
        compact ? 'space-y-2' : 'space-y-3',
        !fullBleed && 'max-w-screen-2xl mx-auto',
        paddingBottom && 'pb-24 flex flex-col min-h-[calc(100dvh-9rem)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export default PageShell
