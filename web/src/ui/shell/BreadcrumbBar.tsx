import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { AIC, cx } from '../cx'

export interface Crumb {
  label: string
  to?: string
}

export function BreadcrumbBar({ items = [], className }: { items?: readonly Crumb[]; className?: string }) {
  if (!items.length) return null
  return (
    <nav
      aria-label="Breadcrumb"
      className={cx(AIC, 'flex items-center gap-1.5 text-xs text-gray-500 flex-wrap', className)}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        return (
          <span key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
            {idx > 0 ? <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" aria-hidden /> : null}
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
