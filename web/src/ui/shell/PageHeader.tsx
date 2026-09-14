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
  actions,
  backTo,
  backLabel = 'Back',
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cx(
        AIC,
        'flex flex-col gap-2 md:flex-row md:items-start md:justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex items-start gap-3">
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
      {actions ? (
        <div className="flex items-center flex-wrap gap-2 shrink-0 print:hidden">{actions}</div>
      ) : null}
    </div>
  )
}

export default PageHeader
