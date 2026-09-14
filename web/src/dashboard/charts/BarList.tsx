import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { SeriesItem } from '../model'
import { BAR_FILL, BAR_TRACK } from '../visuals'

/**
 * Horizontal bar list — the workhorse of this dashboard.
 *
 * It reads as a table and draws as a chart: a label, the figure, and a bar
 * scaled against the largest row so the shape of the distribution is visible
 * without axes. Every row is a link into the register that produced it, which
 * is the whole point — "31-60 days: ₹3.4 L" is only useful if one click shows
 * you which items those are.
 */
export interface BarListProps {
  items: readonly SeriesItem[]
  /** Show the "% of total" column. Off for counts that do not sum meaningfully. */
  showShare?: boolean
  /** Cap the rows rendered; the rest are summarised by the caller's "view all". */
  limit?: number
  className?: string
}

export function BarList({ items, showShare = true, limit, className = '' }: BarListProps) {
  const rows = limit ? items.slice(0, limit) : items

  return (
    <ul className={`space-y-2 ${className}`.trim()}>
      {rows.map((item) => {
        const inner = (
          <>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-gray-700 font-medium flex-1 truncate" title={item.label}>
                {item.label}
              </span>
              {item.sub ? <span className="text-gray-400 tabular-nums shrink-0 hidden sm:inline">{item.sub}</span> : null}
              <span className="font-semibold text-gray-900 tabular-nums shrink-0">{item.display}</span>
              {showShare ? (
                <span className="text-label-xs text-gray-400 tabular-nums shrink-0 w-10 text-right">
                  {item.share.toFixed(0)}%
                </span>
              ) : null}
              {item.to ? (
                <ChevronRight className="w-3 h-3 text-gray-300 shrink-0 group-hover:text-primary transition-colors" />
              ) : null}
            </div>
            <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${BAR_TRACK}`}>
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${BAR_FILL[item.tone]}`}
                style={{ width: `${Math.max(item.value > 0 ? 3 : 0, item.scale)}%` }}
              />
            </div>
          </>
        )

        return (
          <li key={item.key}>
            {item.to ? (
              <Link
                to={item.to}
                className="group block rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-primary-light/40 transition-colors"
              >
                {inner}
              </Link>
            ) : (
              <div className="px-1.5 py-1 -mx-1.5">{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default BarList
