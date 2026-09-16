import { NavLink } from 'react-router-dom'
import { ChartNoAxesCombined, ClipboardList, Database, History, ListTree } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccess } from '../../access/AccessContext'
import type { PermissionKey } from '../../access/AccessContext'
import { P } from '../../services/access'
import { cx } from '../../ui/cx'

/**
 * The reconciliation module's five screens.
 *
 * Underline tabs rather than the pill bar the rest of the module used, because
 * these sit under the headline figures and read as sections of one page — the
 * same shape the dashboards use.
 *
 * They are real links. The URL stays the source of truth, so back, reload and
 * "copy link address" all do the obvious thing, and the two screens that keep
 * their own routes (posting status, the integration outbox) keep every existing
 * bookmark working under their new names.
 */
export interface ReconciliationTabSpec {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  permission?: PermissionKey
  /** What the tab is for — the title on hover, never the only explanation. */
  hint: string
}

export const RECONCILIATION_TABS: readonly ReconciliationTabSpec[] = [
  {
    to: '/reconciliation',
    label: 'Runs',
    icon: Database,
    end: true,
    permission: P.reconciliationRead,
    hint: 'Every comparison run and the difference it reported.',
  },
  {
    to: '/reconciliation/variance',
    label: 'Item-wise Variance',
    icon: ListTree,
    permission: P.reconciliationRead,
    hint: 'What explains the latest gap, bucket by bucket, down to the documents.',
  },
  {
    to: '/reconciliation/posting-status',
    label: 'Pending Adjustments',
    icon: ClipboardList,
    permission: P.reconciliationRead,
    hint: 'Books vouchers waiting on, or refused by, Inventory.',
  },
  {
    to: '/integration/outbox',
    label: 'Audit Trail',
    icon: History,
    permission: P.integrationRead,
    hint: 'Everything Inventory has told Books, with every delivery attempt.',
  },
  {
    to: '/reconciliation/insights',
    label: 'Insights',
    icon: ChartNoAxesCombined,
    permission: P.reconciliationRead,
    hint: 'Counts and averages over the runs already on record.',
  },
] as const

export function ReconciliationTabs({ className }: { className?: string }) {
  const { can, loading } = useAccess()
  const tabs = loading
    ? RECONCILIATION_TABS
    : RECONCILIATION_TABS.filter((tab) => !tab.permission || can(tab.permission))

  if (tabs.length <= 1) return null

  return (
    <nav
      aria-label="Reconciliation"
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

export default ReconciliationTabs
