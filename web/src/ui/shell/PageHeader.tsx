import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { IconTone } from '../IconTile'
import { AIC, cx } from '../cx'

/**
 * Mirrors IconTile's own palette (not imported from it — see Badge.tsx for why
 * each component keeps its own small tone map rather than sharing one).
 */
const ICON_TONE: Record<IconTone, string> = {
  primary: 'bg-primary-light text-primary',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-red-50 text-red-600',
  info: 'bg-sky-50 text-sky-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-50 text-rose-600',
  teal: 'bg-teal-50 text-teal-600',
}

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  /** Tint of the icon tile. Defaults to the brand primary, as it always has been. */
  iconTone?: IconTone
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
  iconTone = 'primary',
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
      {/* `basis-72` only applies from `md:` up: it is a preferred WIDTH for the
          row layout the comment above describes. Below `md` the container is
          `flex-col`, where a flex-basis controls the item's HEIGHT instead —
          unconditionally forcing this block to 288px tall on every phone,
          the empty band a mobile screenshot first caught this by. */}
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
          <span className={cx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5', ICON_TONE[iconTone])}>
            <Icon className="w-5 h-5" aria-hidden />
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
