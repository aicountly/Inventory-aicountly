import { Link } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { AIC, cx } from '../cx'

export interface Crumb {
  label: string
  to?: string
}

export interface BreadcrumbBarProps {
  items?: readonly Crumb[]
  /**
   * Route for a leading home affordance. Rendered as an icon rather than the
   * word "Home" so the trail reads as the screen's own address and not as one
   * more link competing with it.
   */
  homeTo?: string
  className?: string
}

export function BreadcrumbBar({ items = [], homeTo, className }: BreadcrumbBarProps) {
  if (!items.length) return null
  return (
    <nav
      aria-label="Breadcrumb"
      className={cx(AIC, 'flex items-center gap-1.5 text-xs text-gray-500 flex-wrap', className)}
    >
      {homeTo ? (
        <span className="flex items-center gap-1.5">
          <Link
            to={homeTo}
            aria-label="Dashboard"
            title="Dashboard"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:text-primary"
          >
            <Home className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </span>
      ) : null}
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        return (
          <span key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
            {idx > 0 || homeTo ? (
              <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" aria-hidden />
            ) : null}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="hover:text-primary transition-colors truncate max-w-[180px]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cx('truncate max-w-[220px]', isLast && 'text-gray-700 font-semibold')}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export default BreadcrumbBar
