import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cx } from '../../ui/cx'
import type { RiskLevel, RiskRow } from '../valuationHealth'

/**
 * At-risk inventory, one row per risk.
 *
 * The badge is never the only carrier of the level: it prints the word ("High")
 * beside a coloured pill, so the panel reads the same to someone who cannot
 * distinguish the colours — and the row's own sentence says what the risk
 * actually is, which is what a reader acts on.
 *
 * A row links to the register that lists what is behind it. A row without a
 * destination renders as text rather than as a link that goes nowhere.
 */
export interface RiskListProps {
  rows: readonly RiskRow[]
  className?: string
}

const LEVEL_BADGE: Record<RiskLevel, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
  critical: 'bg-red-50 text-red-700 border-red-300',
}

const LEVEL_DOT: Record<RiskLevel, string> = {
  low: 'bg-emerald-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
  critical: 'bg-red-600',
}

const LEVEL_LABEL: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export function RiskList({ rows, className }: RiskListProps) {
  return (
    <ul className={cx('divide-y divide-gray-100', className)}>
      {rows.map((row) => {
        const body = (
          <>
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[row.level])} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold leading-snug text-gray-900">{row.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{row.detail}</span>
            </span>
            <span
              className={cx(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                LEVEL_BADGE[row.level],
              )}
            >
              {LEVEL_LABEL[row.level]}
            </span>
            {row.to ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-primary" aria-hidden />
            ) : null}
          </>
        )

        return (
          <li key={row.key}>
            {row.to ? (
              <Link
                to={row.to}
                aria-label={`${row.title} — ${LEVEL_LABEL[row.level]} risk. ${row.detail}`}
                className="group -mx-2 flex items-start gap-2 rounded-lg px-2 py-2 no-underline transition-colors hover:bg-primary-light/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {body}
              </Link>
            ) : (
              <div className="-mx-2 flex items-start gap-2 px-2 py-2">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default RiskList
