import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { AIC, cx } from '../cx'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  badge?: ReactNode
  /** A line of context under the title — scope label, counts, timestamps. */
  meta?: ReactNode
  /**
   * Decoration between the title and the actions, shown only where there is
   * genuinely room for it (≥1536px). Anything a reader needs goes in `meta` or
   * `description`: this slot disappears on every laptop screen.
   */
  aside?: ReactNode
  actions?: ReactNode
  backTo?: string
  backLabel?: string
  className?: string
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  badge,
  meta,
  aside,
  actions,
  backTo,
  backLabel = 'Back',
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cx(
        AIC,
        // `flex-wrap`: the actions drop to their own line rather than squeezing
        // the title into an ellipsis. `md:` is 768px, which is exactly a
        // portrait tablet, and five header buttons beside a heading there left
        // the heading about 190px — "Inventory d…" over four lines of subtitle.
        'flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start md:justify-between',
        className,
      )}
    >
      {/* `basis-72` is a width for the `md:flex-row` case. Unprefixed it is also
          the flex basis of the column below 768px, where the main axis is
          vertical — an 18rem-tall title block with a 100px title in it, on every
          page that uses this header. It belongs to the row, so it is scoped to it. */}
      <div className="min-w-0 flex-1 md:basis-72 flex items-start gap-3">
        {backTo ? (
          <Link
            to={backTo}
            className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-primary"
            aria-label={backLabel}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>
        ) : null}
        {Icon ? (
          <span className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0 mt-0.5">
            <Icon className="w-5 h-5 text-primary" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-lg md:text-xl font-semibold text-gray-900 truncate">{title}</h1>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </div>
          {description ? <p className="text-sm text-gray-500 mt-0.5">{description}</p> : null}
          {meta ? <div className="mt-1.5">{meta}</div> : null}
        </div>
      </div>
      {aside ? (
        <div className="hidden 2xl:flex items-center min-w-0 shrink px-4 print:hidden" aria-hidden>
          {aside}
        </div>
      ) : null}
      {actions ? (
        <div className="flex items-center flex-wrap gap-2 shrink-0 print:hidden">{actions}</div>
      ) : null}
    </div>
  )
}

export default PageHeader
