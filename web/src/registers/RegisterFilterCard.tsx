import { Filter, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../ui/cx'

export interface RegisterFilterCardProps {
  /** The control row — a RegisterFilterBar in practice. */
  children: ReactNode
  /** One line of what these filters narrow. */
  hint?: ReactNode
  /** Company · financial year · branch. */
  scope?: ReactNode
  onReset?: () => void
  /** Only offer the reset when something is actually filtered. */
  showReset?: boolean
  className?: string
}

/**
 * The filter panel: a titled card rather than a bare strip of controls.
 *
 * The scope line lives in this header, not in a banner of its own above the
 * page. It still has to be on screen — in a multi-company, multi-branch product
 * a quantity without the company, the period and the branch it was read under
 * is not a figure, it is a rumour, and the export already stamps all three. But
 * it is a caption for the filters, so it sits with them.
 */
export function RegisterFilterCard({
  children,
  hint,
  scope,
  onReset,
  showReset = false,
  className,
}: RegisterFilterCardProps) {
  return (
    <section
      aria-label="Filters"
      className={cx(
        AIC,
        'shrink-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-card print:hidden',
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary"
            aria-hidden
          >
            <Filter className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold text-gray-900">Filters</span>
            {hint ? <span className="block text-xs text-gray-400">{hint}</span> : null}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          {scope ? (
            <span className="truncate text-xs font-semibold text-gray-500" title={typeof scope === 'string' ? scope : undefined}>
              {scope}
            </span>
          ) : null}
          {showReset && onReset ? (
            <button
              type="button"
              onClick={onReset}
              title="Clear every filter"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset filters
            </button>
          ) : null}
        </div>
      </div>

      {children}
    </section>
  )
}

export default RegisterFilterCard
