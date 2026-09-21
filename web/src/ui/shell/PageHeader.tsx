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
        // `basis-72` is a flex BASIS: on the md: row it is the title block's
        // width, but in the mobile column it would be its HEIGHT — 288px of
        // blank between the subtitle and the actions on every page that has
        // both. Hence md: on the two flex properties, not just on the direction.
        'flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start md:justify-between',
        className,
      )}
    >
      {/*
        `md:basis-72`, not a bare `basis-72`: flex-basis sizes the MAIN axis,
        and below md this container is a column — so the unqualified class was
        giving the title block an 18rem HEIGHT and leaving a blank half-screen
        between the description and the actions on every phone-width page.
      */}
      <div className="min-w-0 flex-1 md:basis-72 flex items-start gap-3">
        {backTo ? (
          // `shrink-0` and `whitespace-nowrap` are load-bearing, not polish.
          // Without them this link is the only shrinkable thing in a row that
          // also holds a fixed-width icon tile: the flex algorithm takes the
          // width out of here first, and the register header rendered "← Bac"
          // with the icon tile sitting on top of the clipped label.
          <Link
            to={backTo}
            className="mt-0.5 inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label={backLabel}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
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
        // `min-w-0` rather than `shrink-0`, for the reason BreadcrumbHeader's
        // compact row already records: a shrink-proof row cannot fall below its
        // max-content width, so a header carrying five or six buttons never
        // wraps them and scrolls the whole page sideways on a tablet instead.
        // Letting it shrink costs nothing where there is room — the row is
        // max-content anyway.
        <div className="flex items-center flex-wrap gap-2 min-w-0 print:hidden">{actions}</div>
      ) : null}
    </div>
  )
}

export default PageHeader
