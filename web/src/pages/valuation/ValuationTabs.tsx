import { NavLink } from 'react-router-dom'
import { GitCompareArrows, History, Layers3, RefreshCw, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import type { PermissionKey } from '../../access/AccessContext'
import { P } from '../../services/access'
import { cx } from '../../ui/cx'

/**
 * The valuation module's five screens, as underline tabs.
 *
 * Rendered by the page rather than by ValuationLayout, so it can sit UNDER the
 * page title and its actions — the reader needs to know which item they are
 * looking at before they are offered four other views of it. The pill bar the
 * layout still draws for the screens that have not been rebuilt yet is the same
 * five links; when the last of them moves here, that bar goes.
 *
 * They are real links: the URL stays the source of truth, so back, reload and
 * "copy link address" all do the obvious thing.
 */
export interface ValuationTabSpec {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  permission?: PermissionKey
  /** What the tab is for — a title on hover, never the only explanation. */
  hint: string
}

export const VALUATION_TABS: readonly ValuationTabSpec[] = [
  {
    to: '/valuation',
    label: 'Stock valuation',
    icon: Wallet,
    end: true,
    permission: P.report('valuation'),
    hint: 'Closing quantity, unit cost and value per item as at a date.',
  },
  {
    to: '/valuation/cost-layers',
    label: 'Cost layers',
    icon: Layers3,
    permission: P.report('valuation'),
    hint: 'The receipt layers one item is valued from, and the issues that consumed them.',
  },
  {
    to: '/valuation/method-comparison',
    label: 'Method comparison',
    icon: GitCompareArrows,
    permission: P.report('valuation'),
    hint: 'What the same stock is worth under FIFO, LIFO and weighted average.',
  },
  {
    to: '/valuation/recalculations',
    label: 'Recalculations',
    icon: RefreshCw,
    permission: P.report('valuation'),
    hint: 'Back-dated re-costing jobs and what each of them changed.',
  },
  {
    to: '/valuation/revisions',
    label: 'Revisions',
    icon: History,
    permission: P.report('valuation'),
    hint: 'The COGS revisions Inventory published to Books.',
  },
] as const

export function ValuationTabs({ className }: { className?: string }) {
  const { can, loading } = useAccess()
  const tabs = loading ? VALUATION_TABS : VALUATION_TABS.filter((tab) => !tab.permission || can(tab.permission))

  if (tabs.length <= 1) return null

  return (
    <nav
      aria-label="Valuation"
      className={cx('flex gap-1 overflow-x-auto border-b border-gray-200 scrollbar-thin print:hidden', className)}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          title={tab.hint}
          className={({ isActive }) =>
            cx(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm no-underline transition-colors',
              isActive
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900',
            )
          }
        >
          <tab.icon className="h-4 w-4" aria-hidden />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default ValuationTabs
